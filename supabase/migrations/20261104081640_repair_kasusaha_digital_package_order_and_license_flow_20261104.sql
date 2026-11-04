-- Applied to Supabase project flvdudmdltjjdjkdngbv on 2026-11-04.

-- Non-destructive replacement of marketplace checkout, license issuance, and order expiry RPCs.

CREATE OR REPLACE FUNCTION public.create_marketplace_order_secure(p_items jsonb, p_buyer_id uuid, p_buyer_name text, p_buyer_phone text, p_shipping_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_buyer_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_item record;
  v_raw record;
  v_product record;
  v_plan public.kasusaha_license_plans%ROWTYPE;
  v_pid_text text;
  v_qty_text text;
  v_pid_numeric numeric;
  v_qty_numeric numeric;
  v_subtotal numeric := 0;
  v_line_total numeric;
  v_max_total CONSTANT numeric := 99999999999999;
  v_count integer := 0;
  v_rows integer;
  v_has_digital boolean := false;
  v_has_physical boolean := false;
  v_digital_count integer := 0;
  v_is_digital boolean := false;
BEGIN
  v_buyer_id := p_buyer_id;
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Silakan login terlebih dahulu.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Daftar produk tidak valid.';
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Pesanan harus berisi 1 sampai 50 baris barang.';
  END IF;
  IF COALESCE(length(trim(p_buyer_name)), 0) = 0 OR length(trim(p_buyer_name)) > 200 THEN
    RAISE EXCEPTION 'Nama pembeli wajib diisi dan maksimal 200 karakter.';
  END IF;
  IF COALESCE(length(trim(p_buyer_phone)), 0) = 0 OR length(trim(p_buyer_phone)) > 40 THEN
    RAISE EXCEPTION 'Nomor telepon wajib diisi dan maksimal 40 karakter.';
  END IF;
  IF COALESCE(length(trim(p_shipping_address)), 0) = 0 OR length(trim(p_shipping_address)) > 1000 THEN
    RAISE EXCEPTION 'Alamat wajib diisi dan maksimal 1000 karakter.';
  END IF;

  FOR v_raw IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_raw.value) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Format barang tidak valid.';
    END IF;
    v_pid_text := v_raw.value->>'product_id';
    v_qty_text := v_raw.value->>'quantity';
    IF v_pid_text IS NULL OR v_pid_text !~ '^[0-9]{1,19}$' THEN
      RAISE EXCEPTION 'ID produk tidak valid.';
    END IF;
    IF v_qty_text IS NULL OR v_qty_text !~ '^[0-9]{1,10}$' THEN
      RAISE EXCEPTION 'Jumlah barang harus berupa bilangan bulat.';
    END IF;
    v_pid_numeric := v_pid_text::numeric;
    v_qty_numeric := v_qty_text::numeric;
    IF v_pid_numeric < 1 OR v_pid_numeric > 2147483647 THEN
      RAISE EXCEPTION 'ID produk di luar batas yang diizinkan.';
    END IF;
    IF v_qty_numeric < 1 OR v_qty_numeric > 1000 THEN
      RAISE EXCEPTION 'Jumlah setiap barang harus 1 sampai 1000.';
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT (e.value->>'product_id')::bigint AS product_id,
           sum((e.value->>'quantity')::bigint)::bigint AS quantity
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY (e.value->>'product_id')::bigint
    ORDER BY (e.value->>'product_id')::bigint
  LOOP
    IF v_item.quantity < 1 OR v_item.quantity > 1000 THEN
      RAISE EXCEPTION 'Total jumlah produk yang sama maksimal 1000.';
    END IF;

    SELECT id, nama_produk, harga, stok, aktif, owner_id, kategori
    INTO v_product
    FROM public.produk
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk ID % tidak ditemukan.', v_item.product_id;
    END IF;
    IF v_product.aktif IS NOT TRUE THEN
      RAISE EXCEPTION 'Produk % tidak aktif.', v_product.nama_produk;
    END IF;
    IF v_product.owner_id IS NULL THEN
      RAISE EXCEPTION 'Penjual produk % belum terhubung ke akun.', v_product.nama_produk;
    END IF;

    v_is_digital := v_item.product_id IN (7, 8, 9, 10);
    IF v_is_digital AND v_product.kategori IS DISTINCT FROM 'Software Digital' THEN
      RAISE EXCEPTION 'Paket KasUsaha Lite tidak memiliki kategori produk digital yang valid.';
    END IF;
    IF NOT v_is_digital AND v_product.kategori = 'Software Digital' THEN
      RAISE EXCEPTION 'Produk digital belum terdaftar sebagai paket KasUsaha Lite.';
    END IF;

    IF v_is_digital THEN
      IF v_item.quantity <> 1 THEN
        RAISE EXCEPTION 'Satu pesanan hanya dapat membeli satu lisensi untuk satu paket.';
      END IF;
      SELECT * INTO v_plan
      FROM public.kasusaha_license_plans
      WHERE product_id = v_item.product_id AND active IS TRUE
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Paket lisensi tidak aktif atau belum dikonfigurasi.';
      END IF;
      IF v_product.harga IS DISTINCT FROM v_plan.license_price THEN
        RAISE EXCEPTION 'Harga produk paket tidak sama dengan harga paket lisensi.';
      END IF;
      v_digital_count := v_digital_count + 1;
      v_has_digital := true;
    ELSE
      IF v_product.owner_id = v_buyer_id THEN
        RAISE EXCEPTION 'Anda tidak dapat membeli produk milik sendiri.';
      END IF;
      IF v_product.stok < v_item.quantity THEN
        RAISE EXCEPTION 'Stok produk % tidak mencukupi.', v_product.nama_produk;
      END IF;
      v_has_physical := true;
    END IF;

    IF v_product.harga IS NULL OR v_product.harga <= 0 OR v_product.harga <> trunc(v_product.harga) THEN
      RAISE EXCEPTION 'Harga produk % tidak valid.', v_product.nama_produk;
    END IF;
    v_line_total := v_product.harga * v_item.quantity;
    IF v_line_total <= 0 OR v_line_total > v_max_total OR v_subtotal > v_max_total - v_line_total THEN
      RAISE EXCEPTION 'Total pesanan melampaui batas nominal.';
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    v_count := v_count + 1;
  END LOOP;

  IF v_has_digital AND v_has_physical THEN
    RAISE EXCEPTION 'Paket digital KasUsaha Lite harus dibeli terpisah dari produk fisik.';
  END IF;
  IF v_digital_count > 1 THEN
    RAISE EXCEPTION 'Satu pesanan hanya dapat berisi satu paket digital KasUsaha Lite.';
  END IF;
  IF v_count = 0 OR v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Tidak ada produk yang valid.';
  END IF;

  INSERT INTO public.marketplace_orders (
    id, buyer_id, status, currency, item_subtotal, shipping_amount,
    total_amount, buyer_name, buyer_phone, shipping_address, created_at, updated_at
  )
  VALUES (
    v_order_id, v_buyer_id, 'pending_payment', 'IDR', v_subtotal, 0,
    v_subtotal, trim(p_buyer_name), trim(p_buyer_phone),
    trim(p_shipping_address), now(), now()
  );

  FOR v_item IN
    SELECT (e.value->>'product_id')::bigint AS product_id,
           sum((e.value->>'quantity')::bigint)::bigint AS quantity
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY (e.value->>'product_id')::bigint
    ORDER BY (e.value->>'product_id')::bigint
  LOOP
    SELECT id, nama_produk, harga, stok, aktif, owner_id, kategori
    INTO v_product
    FROM public.produk
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND OR v_product.aktif IS NOT TRUE OR v_product.owner_id IS NULL THEN
      RAISE EXCEPTION 'Stok atau status produk berubah. Silakan coba lagi.';
    END IF;

    v_is_digital := v_item.product_id IN (7, 8, 9, 10);
    IF v_is_digital THEN
      IF v_product.kategori IS DISTINCT FROM 'Software Digital' OR v_item.quantity <> 1 THEN
        RAISE EXCEPTION 'Data paket digital berubah atau jumlah lisensi tidak valid.';
      END IF;
      SELECT * INTO v_plan
      FROM public.kasusaha_license_plans
      WHERE product_id = v_item.product_id AND active IS TRUE
      FOR SHARE;
      IF NOT FOUND OR v_product.harga IS DISTINCT FROM v_plan.license_price THEN
        RAISE EXCEPTION 'Konfigurasi harga paket berubah. Silakan ulangi checkout.';
      END IF;
    ELSE
      IF v_product.kategori = 'Software Digital' OR v_product.owner_id = v_buyer_id OR v_product.stok < v_item.quantity THEN
        RAISE EXCEPTION 'Stok atau status produk berubah. Silakan coba lagi.';
      END IF;
    END IF;

    UPDATE public.produk
    SET stok = CASE WHEN v_is_digital THEN stok ELSE stok - v_item.quantity END
    WHERE id = v_item.product_id
      AND (v_is_digital OR stok >= v_item.quantity)
      AND aktif IS TRUE
      AND owner_id = v_product.owner_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Gagal memperbarui stok. Silakan coba lagi.';
    END IF;

    v_line_total := v_product.harga * v_item.quantity;
    INSERT INTO public.marketplace_order_items (
      id, order_id, product_id, seller_id, product_name_snapshot,
      unit_price, quantity, item_subtotal, created_at, package_code, package_term
    )
    VALUES (
      gen_random_uuid(), v_order_id, v_product.id::integer, v_product.owner_id,
      v_product.nama_produk, v_product.harga, v_item.quantity::integer,
      v_line_total, now(),
      CASE WHEN v_is_digital THEN v_plan.plan_code ELSE NULL END,
      CASE WHEN v_is_digital THEN 'initial' ELSE NULL END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'order_id', v_order_id, 'status', 'pending_payment',
    'currency', 'IDR', 'item_subtotal', v_subtotal,
    'shipping_amount', 0, 'total_amount', v_subtotal
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.issue_kasusaha_license(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_item public.marketplace_order_items%ROWTYPE;
  v_product public.produk%ROWTYPE;
  v_plan public.kasusaha_license_plans%ROWTYPE;
  v_license public.kasusaha_licenses%ROWTYPE;
  v_items_subtotal numeric := 0;
  v_digital_count integer := 0;
  v_physical_count integer := 0;
  v_code text;
  v_legacy boolean := false;
BEGIN
  SELECT * INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan.'; END IF;

  IF v_order.status <> 'paid'
     OR v_order.paid_at IS NULL
     OR v_order.payment_provider <> 'midtrans'
     OR COALESCE(v_order.payment_review_required, false) THEN
    RAISE EXCEPTION 'Pesanan belum memenuhi syarat penerbitan lisensi.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_payment_events e
    WHERE e.order_id = p_order_id
      AND e.provider = 'midtrans'
      AND e.verification_status = 'verified'
  ) THEN
    RAISE EXCEPTION 'Lisensi tidak dapat diterbitkan tanpa event pembayaran Midtrans terverifikasi.';
  END IF;

  SELECT * INTO v_item
  FROM public.marketplace_order_items
  WHERE order_id = p_order_id AND product_id IN (7, 8, 9, 10)
  ORDER BY product_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'license_issued', false, 'reason', 'not_kasusaha_license_order');
  END IF;

  SELECT * INTO v_product
  FROM public.produk
  WHERE id = v_item.product_id AND kategori = 'Software Digital';
  IF NOT FOUND THEN RAISE EXCEPTION 'Produk paket digital tidak tersedia.'; END IF;

  v_legacy := NULLIF(TRIM(COALESCE(v_item.package_code, '')), '') IS NULL;
  IF v_legacy THEN
    IF v_item.product_id <> 7 THEN
      RAISE EXCEPTION 'Paket digital baru wajib memiliki kode paket.';
    END IF;
  ELSE
    v_code := LOWER(TRIM(v_item.package_code));
    -- Checkout paket resmi dapat menyimpan seluruh paket melalui produk induk ID 7.
    -- Checkout marketplace alternatif dapat menyimpan produk paket spesifik ID 8-10.
    SELECT * INTO v_plan
    FROM public.kasusaha_license_plans
    WHERE plan_code = v_code
      AND active IS TRUE
      AND (
        v_item.product_id = 7
        OR product_id = v_item.product_id
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kode paket tidak cocok dengan produk atau paket tidak aktif.';
    END IF;
    IF v_plan.product_id NOT IN (7, 8, 9, 10) THEN
      RAISE EXCEPTION 'Pemetaan produk paket tidak valid.';
    END IF;
    IF v_item.product_id <> 7 AND v_product.harga IS DISTINCT FROM v_plan.license_price THEN
      RAISE EXCEPTION 'Harga produk tidak sama dengan harga paket lisensi aktif.';
    END IF;
  END IF;

  SELECT COUNT(*) FILTER (WHERE p.kategori = 'Software Digital'),
         COUNT(*) FILTER (WHERE p.kategori IS DISTINCT FROM 'Software Digital')
  INTO v_digital_count, v_physical_count
  FROM public.marketplace_order_items i
  JOIN public.produk p ON p.id = i.product_id
  WHERE i.order_id = p_order_id;

  IF v_digital_count <> 1 OR v_physical_count <> 0 THEN
    RAISE EXCEPTION 'Pesanan lisensi harus berisi tepat satu paket digital tanpa produk fisik.';
  END IF;

  SELECT COALESCE(SUM(item_subtotal), 0)
  INTO v_items_subtotal
  FROM public.marketplace_order_items
  WHERE order_id = p_order_id;

  IF v_item.quantity <> 1
     OR (
       v_item.product_name_snapshot IS DISTINCT FROM v_product.nama_produk
       AND v_item.product_name_snapshot IS DISTINCT FROM 'KasUsaha Lite'
     )
     OR (NOT v_legacy AND COALESCE(v_item.package_term, '') <> 'initial')
     OR (v_legacy AND v_item.unit_price NOT IN (39000, 49000))
     OR (NOT v_legacy AND v_item.unit_price IS DISTINCT FROM v_plan.license_price)
     OR v_item.item_subtotal IS DISTINCT FROM v_item.unit_price
     OR v_order.item_subtotal IS DISTINCT FROM v_items_subtotal
     OR v_order.total_amount IS DISTINCT FROM (v_order.item_subtotal + COALESCE(v_order.shipping_amount, 0))
     OR COALESCE(v_order.shipping_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'Rincian paket lisensi atau nominal pesanan tidak sesuai.';
  END IF;

  SELECT * INTO v_license
  FROM public.kasusaha_licenses
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_license.buyer_id <> v_order.buyer_id THEN
      RAISE EXCEPTION 'Data lisensi yang sudah ada tidak cocok.';
    END IF;

    IF v_legacy THEN
      UPDATE public.kasusaha_licenses
      SET status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
          plan_code = NULL, package_code = NULL, package_name = NULL,
          product_name = 'KasUsaha Lite',
          activated_at = COALESCE(activated_at, now()),
          cloud_started_at = NULL, cloud_expires_at = NULL, updated_at = now()
      WHERE id = v_license.id
      RETURNING * INTO v_license;
      RETURN jsonb_build_object(
        'success', true, 'license_issued', true, 'already_exists', true,
        'license_id', v_license.id, 'status', v_license.status,
        'plan_code', 'legacy', 'package_name', 'Lisensi lama', 'cloud_expires_at', NULL
      );
    END IF;

    IF v_license.plan_code IS NOT NULL AND v_license.plan_code <> v_plan.plan_code THEN
      RAISE EXCEPTION 'Paket lisensi yang sudah tercatat berbeda dari paket pada pesanan.';
    END IF;

    IF v_license.status = 'pending' THEN
      UPDATE public.kasusaha_licenses
      SET status = 'active',
          plan_code = v_plan.plan_code,
          package_code = v_plan.plan_code,
          package_name = v_plan.plan_name,
          product_name = 'KasUsaha Lite',
          activated_at = COALESCE(activated_at, now()),
          cloud_started_at = COALESCE(cloud_started_at, now()),
          cloud_expires_at = COALESCE(cloud_expires_at, now() + make_interval(months => v_plan.cloud_months)),
          updated_at = now()
      WHERE id = v_license.id
      RETURNING * INTO v_license;
    ELSIF v_license.plan_code IS DISTINCT FROM v_plan.plan_code THEN
      RAISE EXCEPTION 'Lisensi aktif belum cocok dengan paket pesanan; perlu pemeriksaan manual.';
    END IF;

    RETURN jsonb_build_object(
      'success', true, 'license_issued', true, 'already_exists', true,
      'license_id', v_license.id, 'status', v_license.status,
      'plan_code', v_plan.plan_code, 'package_name', v_plan.plan_name,
      'cloud_expires_at', v_license.cloud_expires_at
    );
  END IF;

  INSERT INTO public.kasusaha_licenses (
    id, order_id, buyer_id, license_key, product_name, status,
    activated_at, created_at, updated_at, plan_code, package_code,
    package_name, cloud_started_at, cloud_expires_at
  )
  VALUES (
    gen_random_uuid(), p_order_id, v_order.buyer_id,
    'KS-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 24)),
    'KasUsaha Lite', 'active', now(), now(), now(),
    CASE WHEN v_legacy THEN NULL ELSE v_plan.plan_code END,
    CASE WHEN v_legacy THEN NULL ELSE v_plan.plan_code END,
    CASE WHEN v_legacy THEN NULL ELSE v_plan.plan_name END,
    CASE WHEN v_legacy THEN NULL ELSE now() END,
    CASE WHEN v_legacy THEN NULL ELSE now() + make_interval(months => v_plan.cloud_months) END
  )
  ON CONFLICT (order_id) DO NOTHING
  RETURNING * INTO v_license;

  IF NOT FOUND THEN
    SELECT * INTO v_license
    FROM public.kasusaha_licenses
    WHERE order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND OR v_license.buyer_id <> v_order.buyer_id THEN
      RAISE EXCEPTION 'Lisensi perlu diperiksa karena terjadi konflik.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'license_issued', true, 'already_exists', false,
    'license_id', v_license.id, 'status', v_license.status,
    'plan_code', CASE WHEN v_legacy THEN 'legacy' ELSE v_plan.plan_code END,
    'package_name', CASE WHEN v_legacy THEN 'Lisensi lama' ELSE v_plan.plan_name END,
    'cloud_expires_at', v_license.cloud_expires_at
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.expire_marketplace_order(p_order_id uuid, p_transaction_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_item record;
  v_rows integer;
  v_item_count integer;
BEGIN
  SELECT * INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pesanan tidak ditemukan');
  END IF;

  IF v_order.status = 'cancelled' AND v_order.stock_restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'message', 'Sudah dibatalkan dan stok sudah dikembalikan');
  END IF;

  IF v_order.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status pesanan tidak mengizinkan pembatalan');
  END IF;

  IF v_order.payment_provider <> 'midtrans'
     OR v_order.provider_transaction_id IS DISTINCT FROM p_transaction_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Identitas transaksi tidak cocok');
  END IF;

  IF v_order.stock_restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Penanda pengembalian stok sudah terisi; periksa manual.';
  END IF;

  SELECT COUNT(*) INTO v_item_count
  FROM public.marketplace_order_items
  WHERE order_id = p_order_id;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Detail barang pesanan tidak ditemukan.';
  END IF;

  FOR v_item IN
    SELECT product_id, SUM(quantity)::bigint AS quantity
    FROM public.marketplace_order_items
    WHERE order_id = p_order_id
      AND product_id NOT IN (7, 8, 9, 10)
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    UPDATE public.produk
    SET stok = stok + v_item.quantity
    WHERE id = v_item.product_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Produk ID % tidak ditemukan.', v_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.marketplace_orders
  SET status = 'cancelled',
      stock_restored_at = now(),
      payment_redirect_url = NULL,
      updated_at = now()
  WHERE id = p_order_id
    AND status = 'pending_payment'
    AND stock_restored_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Pesanan berubah; seluruh perubahan dibatalkan.';
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Pesanan dibatalkan dan stok dikembalikan');
END;
$function$


REVOKE ALL ON FUNCTION public.create_marketplace_order_secure(jsonb, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_secure(jsonb, uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.issue_kasusaha_license(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_kasusaha_license(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.expire_marketplace_order(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.expire_marketplace_order(uuid, text) TO service_role;