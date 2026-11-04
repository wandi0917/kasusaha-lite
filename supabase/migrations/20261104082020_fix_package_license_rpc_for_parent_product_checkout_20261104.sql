-- Corrects package-plan lookup for create_kasusaha_package_order, which stores all four plans against parent product ID 7.

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


REVOKE ALL ON FUNCTION public.issue_kasusaha_license(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_kasusaha_license(uuid) TO service_role;