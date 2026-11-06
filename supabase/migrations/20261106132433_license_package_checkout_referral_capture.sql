-- Add optional approved partner referral capture to the dedicated four-package checkout.
-- Keep the existing 4-argument RPC intact for older deployed clients.
-- Serialize check-and-capture by buyer to avoid concurrent first-touch races.
CREATE OR REPLACE FUNCTION public.create_kasusaha_package_order(
  p_package_code text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address text,
  p_referral_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_buyer_id uuid := auth.uid();
  v_seller_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_code text := lower(trim(coalesce(p_package_code, '')));
  v_referral_code text := upper(trim(coalesce(p_referral_code, '')));
  v_product_name text;
  v_plan public.kasusaha_license_plans%ROWTYPE;
  v_partner public.license_marketing_partners%ROWTYPE;
  v_has_attribution boolean := false;
  v_referral_captured boolean := false;
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Silakan login terlebih dahulu.';
  END IF;
  IF coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Pembelian paket lisensi memerlukan akun pembeli terdaftar.';
  END IF;
  IF length(trim(coalesce(p_buyer_name, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Nama pembeli wajib diisi.';
  END IF;
  IF length(trim(coalesce(p_buyer_phone, ''))) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Nomor telepon wajib diisi.';
  END IF;
  IF length(trim(coalesce(p_shipping_address, ''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Alamat wajib diisi.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_buyer_id::text, 0)
  );

  SELECT owner_id, nama_produk
  INTO v_seller_id, v_product_name
  FROM public.produk
  WHERE id = 7 AND aktif IS TRUE AND kategori = 'Software Digital'
  FOR SHARE;
  IF v_seller_id IS NULL OR v_product_name IS NULL THEN
    RAISE EXCEPTION 'Produk lisensi utama tidak tersedia.';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.kasusaha_license_plans
  WHERE plan_code = v_code AND active IS TRUE
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paket tidak dikenal atau tidak aktif.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.license_customer_attributions
    WHERE customer_id = v_buyer_id
  ) INTO v_has_attribution;

  IF NOT v_has_attribution AND v_referral_code <> '' THEN
    IF v_referral_code !~ '^[A-Z0-9][A-Z0-9_-]{3,31}$' THEN
      RAISE EXCEPTION 'Format kode referral tidak valid.';
    END IF;

    SELECT *
    INTO v_partner
    FROM public.license_marketing_partners
    WHERE referral_code = v_referral_code
      AND status = 'active'
      AND user_id <> v_buyer_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kode referral tidak ditemukan, mitra belum aktif, atau kode milik akun sendiri.';
    END IF;
  END IF;

  INSERT INTO public.marketplace_orders (
    id, buyer_id, status, currency, item_subtotal, shipping_amount, total_amount,
    buyer_name, buyer_phone, shipping_address, created_at, updated_at
  ) VALUES (
    v_order_id, v_buyer_id, 'pending_payment', 'IDR',
    v_plan.license_price, 0, v_plan.license_price,
    trim(p_buyer_name), trim(p_buyer_phone), trim(p_shipping_address), now(), now()
  );

  INSERT INTO public.marketplace_order_items (
    id, order_id, product_id, seller_id, product_name_snapshot,
    unit_price, quantity, item_subtotal, created_at, package_code, package_term
  ) VALUES (
    gen_random_uuid(), v_order_id, 7, v_seller_id, v_product_name,
    v_plan.license_price, 1, v_plan.license_price, now(), v_plan.plan_code, 'initial'
  );

  IF NOT v_has_attribution AND v_referral_code <> '' THEN
    INSERT INTO public.license_order_referrals (
      order_id, buyer_id, partner_id, referral_code, captured_at
    ) VALUES (
      v_order_id, v_buyer_id, v_partner.id, v_partner.referral_code, now()
    );
    v_referral_captured := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'package_code', v_plan.plan_code,
    'package_name', v_plan.plan_name,
    'total_amount', v_plan.license_price,
    'currency', 'IDR',
    'referral_captured', v_referral_captured,
    'existing_attribution_preserved', v_has_attribution
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_kasusaha_package_order(text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_kasusaha_package_order(text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.create_kasusaha_package_order(text, text, text, text, text)
  IS 'Creates a server-priced KasUsaha Lite package order and captures an optional approved marketing referral without overwriting permanent customer attribution.';

-- Professional priority support is not currently a contracted support service/SLA.
UPDATE public.kasusaha_license_plans
SET features = jsonb_set(coalesce(features, '{}'::jsonb), '{priority_support}', 'false'::jsonb, true)
WHERE plan_code = 'professional'
  AND coalesce(features->>'priority_support','false') <> 'false';

NOTIFY pgrst, 'reload schema';
