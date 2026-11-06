-- Add append-only stock movement history and enforce cash received on server-side cashier sales.
-- Existing business/product/transaction data is preserved.
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  product_id uuid NULL REFERENCES public.store_products(id) ON DELETE SET NULL,
  product_code text NOT NULL,
  product_name text NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('initial_stock','sale','stock_in','stock_out','stock_correction','product_edit')),
  quantity_before integer NOT NULL CHECK (quantity_before >= 0),
  quantity_after integer NOT NULL CHECK (quantity_after >= 0),
  quantity_delta integer NOT NULL,
  note text,
  source_request_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_stock_movements_delta_check CHECK (quantity_delta = quantity_after - quantity_before)
);

CREATE INDEX IF NOT EXISTS store_stock_movements_business_created_idx
  ON public.store_stock_movements (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_stock_movements_product_created_idx
  ON public.store_stock_movements (product_id, created_at DESC);

ALTER TABLE public.store_stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS store_stock_movements_owner_select ON public.store_stock_movements;
CREATE POLICY store_stock_movements_owner_select
  ON public.store_stock_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_members m
      WHERE m.business_id = store_stock_movements.business_id
        AND m.user_id = (SELECT auth.uid())
        AND m.active = true AND m.role = 'owner'
    )
    AND private.kasusaha_business_license_is_verified(business_id)
    AND private.kasusaha_business_has_feature(business_id, 'basic_stock')
  );
REVOKE ALL ON TABLE public.store_stock_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.store_stock_movements TO authenticated;

CREATE TABLE IF NOT EXISTS private.store_stock_adjustment_requests (
  business_id uuid NOT NULL,
  request_id uuid NOT NULL,
  user_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, request_id)
);

CREATE OR REPLACE FUNCTION private.log_store_product_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_before integer;
  v_after integer;
  v_type text;
  v_note text;
  v_request text;
  v_source_request_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_before := 0;
    v_after := NEW.stock_quantity;
    v_type := 'initial_stock';
    v_note := 'Stok awal saat barang dibuat';
  ELSE
    v_before := OLD.stock_quantity;
    v_after := NEW.stock_quantity;
    v_type := nullif(pg_catalog.current_setting('kasusaha.stock_movement_type', true), '');
    v_note := nullif(pg_catalog.current_setting('kasusaha.stock_movement_note', true), '');
    v_request := nullif(pg_catalog.current_setting('kasusaha.stock_movement_request_id', true), '');
    IF v_type IS NULL OR v_type NOT IN ('sale','stock_in','stock_out','stock_correction') THEN
      v_type := 'product_edit';
      v_note := coalesce(v_note, 'Perubahan stok melalui pengelolaan barang');
    END IF;
  END IF;

  IF v_before IS NOT DISTINCT FROM v_after OR v_after IS NULL OR v_after < 0 THEN
    RETURN NEW;
  END IF;

  IF v_request IS NOT NULL THEN
    BEGIN
      v_source_request_id := v_request::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_source_request_id := NULL;
    END;
  END IF;

  INSERT INTO public.store_stock_movements (
    business_id, product_id, product_code, product_name, movement_type,
    quantity_before, quantity_after, quantity_delta, note, source_request_id, created_by
  ) VALUES (
    NEW.business_id, NEW.id, NEW.product_code, NEW.product_name, v_type,
    v_before, v_after, v_after - v_before, v_note, v_source_request_id, (SELECT auth.uid())
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.log_store_product_stock_movement() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS store_products_stock_movement_audit ON public.store_products;
CREATE TRIGGER store_products_stock_movement_audit
  AFTER INSERT OR UPDATE OF stock_quantity ON public.store_products
  FOR EACH ROW EXECUTE FUNCTION private.log_store_product_stock_movement();

CREATE OR REPLACE FUNCTION public.adjust_store_product_stock(
  p_business_id uuid,
  p_product_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_product public.store_products%rowtype;
  v_role text;
  v_next bigint;
  v_hash text;
  v_existing_hash text;
  v_existing_user uuid;
  v_existing_result jsonb;
  v_result jsonb;
  v_type text;
BEGIN
  IF v_uid IS NULL OR coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Login Owner terdaftar diperlukan untuk mengubah stok.';
  END IF;
  SELECT m.role INTO v_role
  FROM public.business_members m
  WHERE m.business_id = p_business_id AND m.user_id = v_uid
    AND m.active = true AND m.role = 'owner'
  LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Hanya Owner aktif yang dapat mengubah stok.'; END IF;
  IF NOT private.kasusaha_business_license_is_verified(p_business_id)
     OR NOT private.kasusaha_business_has_feature(p_business_id, 'basic_stock') THEN
    RAISE EXCEPTION 'Lisensi atau paket belum mengizinkan pengelolaan stok.';
  END IF;
  IF p_request_id IS NULL OR p_product_id IS NULL OR p_quantity IS NULL
     OR p_movement_type IS NULL OR p_movement_type NOT IN ('in','out','set') OR p_quantity < 0
     OR (p_movement_type IN ('in','out') AND p_quantity < 1) THEN
    RAISE EXCEPTION 'Permintaan perubahan stok tidak valid.';
  END IF;

  v_hash := pg_catalog.md5(p_product_id::text || '|' || p_movement_type || '|' || p_quantity::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text || ':' || p_request_id::text, 0)
  );
  SELECT r.request_hash, r.user_id, r.result
    INTO v_existing_hash, v_existing_user, v_existing_result
  FROM private.store_stock_adjustment_requests r
  WHERE r.business_id = p_business_id AND r.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash <> v_hash OR v_existing_user <> v_uid THEN
      RAISE EXCEPTION 'ID perubahan stok sudah digunakan untuk permintaan berbeda.';
    END IF;
    RETURN v_existing_result || pg_catalog.jsonb_build_object('replayed', true);
  END IF;

  SELECT p.* INTO v_product
  FROM public.store_products p
  WHERE p.id = p_product_id AND p.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Barang tidak ditemukan pada usaha ini.'; END IF;
  -- Legacy rows may have NULL stock_quantity; treat them as zero so the RPC never reports success without changing stock.
  v_product.stock_quantity := coalesce(v_product.stock_quantity, 0);

  v_next := CASE
    WHEN p_movement_type = 'in' THEN v_product.stock_quantity::bigint + p_quantity::bigint
    WHEN p_movement_type = 'out' THEN v_product.stock_quantity::bigint - p_quantity::bigint
    ELSE p_quantity::bigint
  END;
  IF v_next < 0 THEN RAISE EXCEPTION 'Stok keluar melebihi stok tersedia (%).', v_product.stock_quantity; END IF;
  IF v_next > 2147483647 THEN RAISE EXCEPTION 'Jumlah stok melebihi batas yang didukung.'; END IF;

  v_type := CASE p_movement_type
    WHEN 'in' THEN 'stock_in'
    WHEN 'out' THEN 'stock_out'
    ELSE 'stock_correction'
  END;
  PERFORM pg_catalog.set_config('kasusaha.stock_movement_type', v_type, true);
  PERFORM pg_catalog.set_config('kasusaha.stock_movement_request_id', p_request_id::text, true);
  PERFORM pg_catalog.set_config('kasusaha.stock_movement_note',
    CASE p_movement_type WHEN 'in' THEN 'Stok masuk' WHEN 'out' THEN 'Stok keluar' ELSE 'Koreksi stok' END, true);

  UPDATE public.store_products
  SET stock_quantity = v_next::integer, updated_at = now()
  WHERE id = p_product_id AND business_id = p_business_id;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'product_id', p_product_id, 'product_name', v_product.product_name,
    'movement_type', v_type, 'quantity_before', v_product.stock_quantity,
    'quantity_after', v_next::integer, 'quantity_delta', v_next::integer - v_product.stock_quantity,
    'request_id', p_request_id
  );
  INSERT INTO private.store_stock_adjustment_requests (business_id, request_id, user_id, request_hash, result)
  VALUES (p_business_id, p_request_id, v_uid, v_hash, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.adjust_store_product_stock(uuid,uuid,text,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_store_product_stock(uuid,uuid,text,integer,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_store_quick_sale(p_business_id uuid, p_table_number text, p_lines jsonb, p_request_id uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_line jsonb;
  v_product_id uuid;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_stock integer;
  v_name text;
  v_code text;
  v_amount numeric;
  v_total numeric := 0;
  v_count integer := 0;
  v_location text;
  v_description text;
  v_request_id uuid := coalesce(p_request_id, pg_catalog.gen_random_uuid());
  v_request_hash text := md5(coalesce(p_table_number, '') || '|' || coalesce(p_lines::text, 'null'));
  v_existing_hash text;
  v_existing_result jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Silakan login terlebih dahulu.';
  END IF;
  IF coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) THEN
    NULL; -- role-specific anonymous-session check follows membership lookup
  END IF;
  SELECT m.role INTO v_role
  FROM public.business_members m
  WHERE m.business_id = p_business_id AND m.user_id = v_uid
    AND m.active = true AND m.role IN ('owner', 'employee')
  LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Akun tidak memiliki akses aktif ke usaha ini.'; END IF;
  IF coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
     AND (v_role <> 'employee' OR NOT private.kasusaha_employee_device_is_paid(p_business_id)) THEN
    RAISE EXCEPTION 'Sesi anonim hanya diizinkan untuk Karyawan dengan perangkat yang sudah diaktifkan Owner.';
  END IF;
  IF NOT private.kasusaha_business_license_is_verified(p_business_id) THEN
    RAISE EXCEPTION 'Lisensi KasUsaha Lite belum memiliki pembayaran terverifikasi. Fitur kasir dikunci sampai verifikasi selesai.';
  END IF;
  IF NOT private.kasusaha_business_has_feature(p_business_id, 'cashier') THEN
    RAISE EXCEPTION 'Paket lisensi ini tidak mencakup fitur kasir.';
  END IF;
  IF v_role = 'employee' AND NOT private.kasusaha_employee_device_is_paid(p_business_id) THEN
    RAISE EXCEPTION 'Perangkat Karyawan belum diaktifkan oleh Owner. Selesaikan pembayaran aktivasi terlebih dahulu.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':' || v_request_id::text, 0));
  SELECT r.request_hash, r.result INTO v_existing_hash, v_existing_result
  FROM private.store_quick_sale_requests r
  WHERE r.business_id = p_business_id AND r.request_id = v_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash <> v_request_hash THEN
      RAISE EXCEPTION 'ID permintaan penjualan ini sudah dipakai untuk rincian berbeda. Muat ulang kasir dan periksa laporan sebelum membuat transaksi baru.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM private.store_quick_sale_requests r
      WHERE r.business_id = p_business_id AND r.request_id = v_request_id AND r.user_id = v_uid) THEN
      RAISE EXCEPTION 'ID permintaan penjualan tidak cocok dengan akun yang login.';
    END IF;
    RETURN v_existing_result || jsonb_build_object('replayed', true);
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_lines) < 1 OR jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Daftar penjualan tidak valid. Isi 1 sampai 50 baris barang.';
  END IF;
  v_location := CASE
    WHEN nullif(trim(coalesce(p_table_number, '')), '') IS NULL THEN 'Kasir'
    WHEN left(trim(p_table_number), 11) = 'Pelanggan: ' THEN left(regexp_replace(trim(p_table_number), '[<>]', '', 'g'), 100)
    ELSE 'Meja ' || left(regexp_replace(trim(p_table_number), '[<>]', '', 'g'), 20)
  END;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_product_id := (v_line->>'product_id')::uuid;
      v_qty := (v_line->>'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Data barang atau jumlah penjualan tidak valid.';
    END;
    IF v_qty IS NULL OR v_qty < 1 THEN RAISE EXCEPTION 'Jumlah barang harus bilangan bulat positif.'; END IF;
    SELECT sp.price, sp.product_name, sp.product_code, sp.cost_price, sp.stock_quantity
    INTO v_price, v_name, v_code, v_cost, v_stock
    FROM public.store_products sp
    WHERE sp.id = v_product_id AND sp.business_id = p_business_id
      AND sp.active = true AND sp.item_type <> 'ingredient' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Barang tidak ditemukan, nonaktif, atau bukan produk kasir.'; END IF;
    IF v_price IS NULL OR v_price <= 0 OR v_price <> trunc(v_price) THEN
      RAISE EXCEPTION 'Harga jual pada master produk belum valid. Periksa harga produk terlebih dahulu.';
    END IF;
    IF v_stock IS NULL OR v_stock < v_qty THEN
      RAISE EXCEPTION 'Stok % tidak cukup atau belum ditetapkan. Stok tersedia: %.', v_name, coalesce(v_stock, 0);
    END IF;
    v_amount := v_qty * v_price;
    IF v_amount <= 0 OR v_amount <> trunc(v_amount) THEN RAISE EXCEPTION 'Subtotal penjualan tidak valid.'; END IF;
    IF v_role = 'owner'
       AND private.kasusaha_business_has_feature(p_business_id, 'full_finance') IS TRUE THEN
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || CASE WHEN v_cost IS NULL THEN ' | Modal belum dicatat'
          ELSE ' | Modal/unit Rp' || to_char(v_cost, 'FM999,999,999,999,990')
          || ' | Modal total Rp' || to_char(v_cost * v_qty, 'FM999,999,999,999,990')
          || ' | Laba kotor Rp' || to_char((v_price - v_cost) * v_qty, 'FM999,999,999,999,990') END
        || ' | Jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    ELSE
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || ' | Harga jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    END IF;
    INSERT INTO public.financial_transactions
      (business_id, created_by, created_by_role, transaction_date, transaction_type, amount, description, category)
    VALUES
      (p_business_id, v_uid, v_role, (now() AT TIME ZONE 'Asia/Jakarta')::date, 'income', v_amount, v_description, 'Penjualan');
    PERFORM pg_catalog.set_config('kasusaha.stock_movement_type', 'sale', true);
    PERFORM pg_catalog.set_config('kasusaha.stock_movement_request_id', v_request_id::text, true);
    PERFORM pg_catalog.set_config('kasusaha.stock_movement_note', 'Penjualan kasir', true);
    UPDATE public.store_products SET stock_quantity = stock_quantity - v_qty, updated_at = now()
    WHERE id = v_product_id AND business_id = p_business_id
      AND stock_quantity IS NOT NULL AND stock_quantity >= v_qty;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stok berubah saat transaksi diproses. Silakan ulangi penjualan.'; END IF;
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  END LOOP;
  v_result := jsonb_build_object('ok', true, 'total_amount', v_total, 'lines_count', v_count,
    'location', v_location, 'request_id', v_request_id);
  INSERT INTO private.store_quick_sale_requests (request_id, business_id, user_id, request_hash, result)
  VALUES (v_request_id, p_business_id, v_uid, v_request_hash, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_store_quick_sale(p_business_id uuid, p_table_number text, p_lines jsonb, p_request_id uuid, p_cash_received numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_line jsonb;
  v_product_id uuid;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_stock integer;
  v_name text;
  v_code text;
  v_amount numeric;
  v_total numeric := 0;
  v_count integer := 0;
  v_location text;
  v_description text;
  v_request_id uuid := coalesce(p_request_id, pg_catalog.gen_random_uuid());
  v_request_hash text := md5(coalesce(p_table_number, '') || '|' || coalesce(p_lines::text, 'null'));
  v_existing_hash text;
  v_existing_result jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Silakan login terlebih dahulu.';
  END IF;
  IF coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) THEN
    NULL; -- role-specific anonymous-session check follows membership lookup
  END IF;
  SELECT m.role INTO v_role
  FROM public.business_members m
  WHERE m.business_id = p_business_id AND m.user_id = v_uid
    AND m.active = true AND m.role IN ('owner', 'employee')
  LIMIT 1;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Akun tidak memiliki akses aktif ke usaha ini.'; END IF;
  IF coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
     AND (v_role <> 'employee' OR NOT private.kasusaha_employee_device_is_paid(p_business_id)) THEN
    RAISE EXCEPTION 'Sesi anonim hanya diizinkan untuk Karyawan dengan perangkat yang sudah diaktifkan Owner.';
  END IF;
  IF NOT private.kasusaha_business_license_is_verified(p_business_id) THEN
    RAISE EXCEPTION 'Lisensi KasUsaha Lite belum memiliki pembayaran terverifikasi. Fitur kasir dikunci sampai verifikasi selesai.';
  END IF;
  IF NOT private.kasusaha_business_has_feature(p_business_id, 'cashier') THEN
    RAISE EXCEPTION 'Paket lisensi ini tidak mencakup fitur kasir.';
  END IF;
  IF v_role = 'employee' AND NOT private.kasusaha_employee_device_is_paid(p_business_id) THEN
    RAISE EXCEPTION 'Perangkat Karyawan belum diaktifkan oleh Owner. Selesaikan pembayaran aktivasi terlebih dahulu.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':' || v_request_id::text, 0));
  SELECT r.request_hash, r.result INTO v_existing_hash, v_existing_result
  FROM private.store_quick_sale_requests r
  WHERE r.business_id = p_business_id AND r.request_id = v_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash <> v_request_hash THEN
      RAISE EXCEPTION 'ID permintaan penjualan ini sudah dipakai untuk rincian berbeda. Muat ulang kasir dan periksa laporan sebelum membuat transaksi baru.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM private.store_quick_sale_requests r
      WHERE r.business_id = p_business_id AND r.request_id = v_request_id AND r.user_id = v_uid) THEN
      RAISE EXCEPTION 'ID permintaan penjualan tidak cocok dengan akun yang login.';
    END IF;
    -- A request from the legacy client was already committed without a cash_received field.
    -- Return its stored result without re-selling or decrementing stock a second time.
    IF NOT (v_existing_result ? 'cash_received') THEN
      RETURN v_existing_result || jsonb_build_object(
        'replayed', true, 'already_processed', true, 'legacy_cash_unverified', true
      );
    END IF;
    IF (v_existing_result->>'cash_received')::numeric IS DISTINCT FROM p_cash_received THEN
      RAISE EXCEPTION 'Transaksi ini sudah diproses dengan nominal uang diterima yang berbeda. Periksa laporan sebelum mengulang.';
    END IF;
    RETURN v_existing_result || jsonb_build_object('replayed', true);
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_lines) < 1 OR jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Daftar penjualan tidak valid. Isi 1 sampai 50 baris barang.';
  END IF;
  v_location := CASE
    WHEN nullif(trim(coalesce(p_table_number, '')), '') IS NULL THEN 'Kasir'
    WHEN left(trim(p_table_number), 11) = 'Pelanggan: ' THEN left(regexp_replace(trim(p_table_number), '[<>]', '', 'g'), 100)
    ELSE 'Meja ' || left(regexp_replace(trim(p_table_number), '[<>]', '', 'g'), 20)
  END;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_product_id := (v_line->>'product_id')::uuid;
      v_qty := (v_line->>'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Data barang atau jumlah penjualan tidak valid.';
    END;
    IF v_qty IS NULL OR v_qty < 1 THEN RAISE EXCEPTION 'Jumlah barang harus bilangan bulat positif.'; END IF;
    SELECT sp.price, sp.product_name, sp.product_code, sp.cost_price, sp.stock_quantity
    INTO v_price, v_name, v_code, v_cost, v_stock
    FROM public.store_products sp
    WHERE sp.id = v_product_id AND sp.business_id = p_business_id
      AND sp.active = true AND sp.item_type <> 'ingredient' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Barang tidak ditemukan, nonaktif, atau bukan produk kasir.'; END IF;
    IF v_price IS NULL OR v_price <= 0 OR v_price <> trunc(v_price) THEN
      RAISE EXCEPTION 'Harga jual pada master produk belum valid. Periksa harga produk terlebih dahulu.';
    END IF;
    IF v_stock IS NULL OR v_stock < v_qty THEN
      RAISE EXCEPTION 'Stok % tidak cukup atau belum ditetapkan. Stok tersedia: %.', v_name, coalesce(v_stock, 0);
    END IF;
    v_amount := v_qty * v_price;
    IF v_amount <= 0 OR v_amount <> trunc(v_amount) THEN RAISE EXCEPTION 'Subtotal penjualan tidak valid.'; END IF;
    IF v_role = 'owner'
       AND private.kasusaha_business_has_feature(p_business_id, 'full_finance') IS TRUE THEN
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || CASE WHEN v_cost IS NULL THEN ' | Modal belum dicatat'
          ELSE ' | Modal/unit Rp' || to_char(v_cost, 'FM999,999,999,999,990')
          || ' | Modal total Rp' || to_char(v_cost * v_qty, 'FM999,999,999,999,990')
          || ' | Laba kotor Rp' || to_char((v_price - v_cost) * v_qty, 'FM999,999,999,999,990') END
        || ' | Jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    ELSE
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || ' | Harga jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    END IF;
    INSERT INTO public.financial_transactions
      (business_id, created_by, created_by_role, transaction_date, transaction_type, amount, description, category)
    VALUES
      (p_business_id, v_uid, v_role, (now() AT TIME ZONE 'Asia/Jakarta')::date, 'income', v_amount, v_description, 'Penjualan');
    PERFORM pg_catalog.set_config('kasusaha.stock_movement_type', 'sale', true);
    PERFORM pg_catalog.set_config('kasusaha.stock_movement_request_id', v_request_id::text, true);
    PERFORM pg_catalog.set_config('kasusaha.stock_movement_note', 'Penjualan kasir', true);
    UPDATE public.store_products SET stock_quantity = stock_quantity - v_qty, updated_at = now()
    WHERE id = v_product_id AND business_id = p_business_id
      AND stock_quantity IS NOT NULL AND stock_quantity >= v_qty;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stok berubah saat transaksi diproses. Silakan ulangi penjualan.'; END IF;
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  END LOOP;
  IF p_cash_received IS NULL OR p_cash_received < v_total OR p_cash_received <> trunc(p_cash_received) THEN
    RAISE EXCEPTION 'Uang diterima harus berupa bilangan bulat dan sekurang-kurangnya sama dengan total penjualan Rp%.', v_total;
  END IF;
  v_result := jsonb_build_object('ok', true, 'total_amount', v_total, 'lines_count', v_count,
    'location', v_location, 'request_id', v_request_id,
    'cash_received', p_cash_received, 'change_amount', p_cash_received - v_total);
  INSERT INTO private.store_quick_sale_requests (request_id, business_id, user_id, request_hash, result)
  VALUES (v_request_id, p_business_id, v_uid, v_request_hash, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_store_quick_sale(uuid,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_store_quick_sale(uuid,text,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_store_quick_sale(uuid,text,jsonb,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_store_quick_sale(uuid,text,jsonb,uuid,numeric) TO authenticated, service_role;


-- Preserve both customer and table attribution when an open cashier bill is settled.
CREATE OR REPLACE FUNCTION public.settle_store_open_bill(p_bill_id uuid, p_cash_received numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid := (select auth.uid());
 v_bill public.store_open_bills%rowtype;
 v_role text;
 v_result jsonb;
 v_location text;
 v_expected numeric;
begin
 if v_uid is null then raise exception 'Silakan login terlebih dahulu.'; end if;
 select b.* into v_bill from public.store_open_bills b where b.id=p_bill_id for update;
 if not found then raise exception 'Tagihan tidak ditemukan.'; end if;
 select m.role into v_role from public.business_members m where m.business_id=v_bill.business_id and m.user_id=v_uid and m.active=true and m.role in ('owner','employee') limit 1;
 if v_role is null then raise exception 'Akun tidak memiliki akses aktif ke usaha ini.'; end if;
 if v_role='employee' and not private.kasusaha_employee_device_is_paid(v_bill.business_id) then raise exception 'Perangkat Karyawan belum diaktifkan Owner.'; end if;
 if not private.kasusaha_business_license_is_verified(v_bill.business_id) or not private.kasusaha_business_has_feature(v_bill.business_id,'cashier') then raise exception 'Lisensi atau paket belum mengizinkan fitur kasir.'; end if;
 if v_bill.status='paid' then return jsonb_build_object('ok',true,'already_paid',true,'total_amount',v_bill.total_amount,'bill_id',v_bill.id); end if;
 if v_bill.status<>'open' then raise exception 'Tagihan tidak lagi terbuka.'; end if;
 if p_cash_received is null or p_cash_received<v_bill.total_amount or p_cash_received<>trunc(p_cash_received) then raise exception 'Uang diterima belum mencukupi total tagihan.'; end if;
 select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into v_expected from jsonb_array_elements(v_bill.lines) x;
 if v_expected<>v_bill.total_amount then raise exception 'Total tagihan tidak cocok dengan rincian barang. Buka dan simpan ulang tagihan.'; end if;
 if exists(select 1 from jsonb_array_elements(v_bill.lines) x left join public.store_products p on p.id=(x->>'product_id')::uuid and p.business_id=v_bill.business_id where p.id is null or p.active is not true or p.item_type='ingredient' or p.price<>(x->>'unit_price')::numeric) then
  raise exception 'Harga/status produk berubah sejak tagihan dibuat. Buka dan perbarui tagihan sebelum pembayaran.';
 end if;
 v_location := CASE
   WHEN nullif(trim(v_bill.customer_name),'') IS NOT NULL THEN
     'Pelanggan: ' || left(regexp_replace(trim(v_bill.customer_name), '[<>]', '', 'g'), CASE WHEN nullif(trim(v_bill.table_number),'') IS NOT NULL THEN 60 ELSE 80 END)
     || CASE WHEN nullif(trim(v_bill.table_number),'') IS NOT NULL THEN ' • Meja ' || left(regexp_replace(trim(v_bill.table_number), '[<>]', '', 'g'), 20) ELSE '' END
   WHEN nullif(trim(v_bill.table_number),'') IS NOT NULL THEN left(regexp_replace(trim(v_bill.table_number), '[<>]', '', 'g'), 20)
   ELSE NULL
 END;
 v_result:=public.record_store_quick_sale(v_bill.business_id,v_location,v_bill.lines,v_bill.sale_request_id);
 update public.store_open_bills set status='paid',payment_cash=p_cash_received,change_amount=p_cash_received-v_bill.total_amount,paid_at=now(),paid_by=v_uid,updated_at=now(),version=version+1 where id=v_bill.id and status='open';
 if not found then raise exception 'Status tagihan berubah saat pembayaran diproses.'; end if;
 return v_result||jsonb_build_object('bill_id',v_bill.id,'payment_cash',p_cash_received,'change_amount',p_cash_received-v_bill.total_amount,'paid_at',now());
end;
$function$;

COMMIT;
