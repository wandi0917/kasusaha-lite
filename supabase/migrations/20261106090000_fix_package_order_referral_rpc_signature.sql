-- Fix package checkout RPC: frontend sends p_referral_code as the fifth named argument.
-- Keep the existing four-argument RPC intact for legacy clients.
-- The order and referral capture are atomic: any referral validation/insert failure
-- raises an exception and rolls back the order created by the four-argument function.

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
  v_referral_code text := upper(trim(coalesce(p_referral_code, '')));
  v_partner public.license_marketing_partners%ROWTYPE;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Silakan login terlebih dahulu.';
  END IF;

  IF coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Pembelian paket lisensi memerlukan akun pembeli terdaftar.';
  END IF;

  IF v_referral_code <> '' THEN
    SELECT *
      INTO v_partner
    FROM public.license_marketing_partners
    WHERE upper(referral_code) = v_referral_code
      AND status = 'active'
      AND user_id <> v_buyer_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kode referral tidak valid, tidak aktif, atau tidak boleh digunakan untuk akun sendiri.';
    END IF;
  END IF;

  -- Reuse the established order validation and price source of truth.
  v_result := public.create_kasusaha_package_order(
    p_package_code,
    p_buyer_name,
    p_buyer_phone,
    p_shipping_address
  );

  IF coalesce((v_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Pesanan paket tidak berhasil dibuat.';
  END IF;

  v_order_id := nullif(v_result ->> 'order_id', '')::uuid;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Nomor pesanan paket tidak valid.';
  END IF;

  IF v_referral_code <> '' THEN
    INSERT INTO public.license_order_referrals (
      order_id,
      buyer_id,
      partner_id,
      referral_code,
      captured_at
    )
    VALUES (
      v_order_id,
      v_buyer_id,
      v_partner.id,
      v_partner.referral_code,
      now()
    );
    v_result := v_result || jsonb_build_object('referral_captured', true);
  ELSE
    v_result := v_result || jsonb_build_object('referral_captured', false);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_kasusaha_package_order(text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_kasusaha_package_order(text, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.create_kasusaha_package_order(text, text, text, text, text)
  IS 'Creates a licensed package order and atomically captures an optional active, non-self referral code.';

NOTIFY pgrst, 'reload schema';
