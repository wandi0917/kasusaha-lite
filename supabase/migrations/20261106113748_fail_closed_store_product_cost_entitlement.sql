-- Fail closed when the active license plan does not resolve a feature entitlement.
-- The previous COALESCE(..., true) treated a NULL entitlement lookup as permission,
-- which could allow full-finance cost edits if plan metadata was missing/inconsistent.
CREATE OR REPLACE FUNCTION public.set_store_product_cost(
  p_product_id uuid,
  p_cost_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Login diperlukan.';
  END IF;

  IF COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Akun anonim tidak diizinkan mengubah harga modal.';
  END IF;

  IF p_cost_price IS NULL OR p_cost_price < 0 OR p_cost_price <> trunc(p_cost_price) THEN
    RAISE EXCEPTION 'Harga modal harus bilangan bulat nol atau lebih.';
  END IF;

  SELECT business_id INTO v_business_id
  FROM public.store_products
  WHERE id = p_product_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Barang tidak ditemukan.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members m
    WHERE m.business_id = v_business_id
      AND m.user_id = (SELECT auth.uid())
      AND m.active = true
      AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Hanya Owner yang boleh mengubah harga modal.';
  END IF;

  IF NOT private.kasusaha_business_license_is_verified(v_business_id) THEN
    RAISE EXCEPTION 'Lisensi KasUsaha Lite belum memiliki pembayaran terverifikasi.';
  END IF;

  -- Fail closed: NULL means the entitlement could not be established.
  IF private.kasusaha_business_has_feature(v_business_id, 'full_finance')
       IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Harga modal dan keuangan lengkap tersedia mulai paket Lite.';
  END IF;

  UPDATE public.store_products
  SET cost_price = p_cost_price,
      updated_at = now()
  WHERE id = p_product_id
    AND business_id = v_business_id;

  RETURN jsonb_build_object('ok', true, 'product_id', p_product_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_store_product_cost(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_store_product_cost(uuid, numeric) TO authenticated, service_role;
