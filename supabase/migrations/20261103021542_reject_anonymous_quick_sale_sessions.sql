-- Reject anonymous Supabase Auth sessions from the privileged cashier RPC.
-- Anonymous Auth users inherit the authenticated Postgres role, so auth.uid()
-- alone is not sufficient authorization for recording business transactions.
CREATE OR REPLACE FUNCTION public.record_store_quick_sale(
  p_business_id uuid,
  p_table_number text,
  p_lines jsonb,
  p_request_id uuid DEFAULT gen_random_uuid()
)
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
    RAISE EXCEPTION 'Akun anonim tidak diizinkan mencatat transaksi kasir. Gunakan akun Owner atau Karyawan terdaftar.';
  END IF;

  SELECT m.role INTO v_role
  FROM public.business_members m
  WHERE m.business_id = p_business_id
    AND m.user_id = v_uid
    AND m.active = true
    AND m.role IN ('owner', 'employee')
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Akun tidak memiliki akses aktif ke usaha ini.';
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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text || ':' || v_request_id::text, 0)
  );

  SELECT r.request_hash, r.result
  INTO v_existing_hash, v_existing_result
  FROM private.store_quick_sale_requests r
  WHERE r.business_id = p_business_id
    AND r.request_id = v_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_hash <> v_request_hash THEN
      RAISE EXCEPTION 'ID permintaan penjualan ini sudah dipakai untuk rincian berbeda. Muat ulang kasir dan periksa laporan sebelum membuat transaksi baru.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM private.store_quick_sale_requests r
      WHERE r.business_id = p_business_id
        AND r.request_id = v_request_id
        AND r.user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'ID permintaan penjualan tidak cocok dengan akun yang login.';
    END IF;
    RETURN v_existing_result || jsonb_build_object('replayed', true);
  END IF;

  IF p_lines IS NULL
     OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) < 1
     OR jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Daftar penjualan tidak valid. Isi 1 sampai 50 baris barang.';
  END IF;

  v_location := CASE
    WHEN nullif(trim(coalesce(p_table_number, '')), '') IS NULL THEN 'Kasir'
    ELSE 'Meja ' || left(regexp_replace(trim(p_table_number), '[<>]', '', 'g'), 20)
  END;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_product_id := (v_line->>'product_id')::uuid;
      v_qty := (v_line->>'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Data barang atau jumlah penjualan tidak valid.';
    END;

    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Jumlah barang harus bilangan bulat positif.';
    END IF;

    SELECT sp.price, sp.product_name, sp.product_code, sp.cost_price, sp.stock_quantity
    INTO v_price, v_name, v_code, v_cost, v_stock
    FROM public.store_products sp
    WHERE sp.id = v_product_id
      AND sp.business_id = p_business_id
      AND sp.active = true
      AND sp.item_type <> 'ingredient'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang tidak ditemukan, nonaktif, atau bukan produk kasir.';
    END IF;
    IF v_price IS NULL OR v_price <= 0 OR v_price <> trunc(v_price) THEN
      RAISE EXCEPTION 'Harga jual pada master produk belum valid. Periksa harga produk terlebih dahulu.';
    END IF;
    IF v_stock IS NULL OR v_stock < v_qty THEN
      RAISE EXCEPTION 'Stok % tidak cukup atau belum ditetapkan. Stok tersedia: %.', v_name, coalesce(v_stock, 0);
    END IF;

    v_amount := v_qty * v_price;
    IF v_amount <= 0 OR v_amount <> trunc(v_amount) THEN
      RAISE EXCEPTION 'Subtotal penjualan tidak valid.';
    END IF;

    IF v_role = 'owner' THEN
      v_description :=
        v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || CASE
          WHEN v_cost IS NULL THEN ' | Modal belum dicatat'
          ELSE ' | Modal/unit Rp' || to_char(v_cost, 'FM999,999,999,999,990')
            || ' | Modal total Rp' || to_char(v_cost * v_qty, 'FM999,999,999,999,990')
            || ' | Laba kotor Rp' || to_char((v_price - v_cost) * v_qty, 'FM999,999,999,999,990')
        END
        || ' | Jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    ELSE
      v_description :=
        v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || ' | Harga jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    END IF;

    INSERT INTO public.financial_transactions
      (business_id, created_by, created_by_role, transaction_date, transaction_type, amount, description, category)
    VALUES
      (p_business_id, v_uid, v_role, (now() AT TIME ZONE 'Asia/Jakarta')::date, 'income', v_amount, v_description, 'Penjualan');

    UPDATE public.store_products
    SET stock_quantity = stock_quantity - v_qty, updated_at = now()
    WHERE id = v_product_id
      AND business_id = p_business_id
      AND stock_quantity IS NOT NULL
      AND stock_quantity >= v_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stok berubah saat transaksi diproses. Silakan ulangi penjualan.';
    END IF;

    v_total := v_total + v_amount;
    v_count := v_count + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'total_amount', v_total,
    'lines_count', v_count,
    'location', v_location,
    'request_id', v_request_id
  );

  INSERT INTO private.store_quick_sale_requests
    (request_id, business_id, user_id, request_hash, result)
  VALUES
    (v_request_id, p_business_id, v_uid, v_request_hash, v_result);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_store_quick_sale(uuid,text,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_store_quick_sale(uuid,text,jsonb,uuid) TO authenticated;
