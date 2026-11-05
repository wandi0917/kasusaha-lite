CREATE OR REPLACE FUNCTION public.kasusaha_get_business_package_entitlements(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_plan_code text;
  v_package_name text;
  v_features jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Login akun terdaftar diperlukan.';
  END IF;

  SELECT l.plan_code,
         coalesce(l.package_name, p.plan_name, 'Lisensi lama'),
         CASE
           WHEN l.plan_code IS NULL OR btrim(l.plan_code) = '' THEN
             '{"barcode":true,"cashier":true,"employees":true,"attendance":true,"basic_stock":true,"marketplace":true,"full_finance":true,"sales_reports":true,"basic_products":true,"advanced_reports":true,"priority_support":true}'::jsonb
           ELSE coalesce(p.features, '{}'::jsonb)
         END
    INTO v_plan_code,v_package_name,v_features
  FROM public.business_workspaces w
  JOIN public.business_members m
    ON m.business_id=w.id AND m.user_id=(SELECT auth.uid()) AND m.active=true
  JOIN public.kasusaha_licenses l
    ON l.buyer_id=w.owner_id AND l.status='active' AND l.product_name='KasUsaha Lite'
  LEFT JOIN public.kasusaha_license_plans p
    ON p.plan_code=l.plan_code AND p.active=true
  WHERE w.id=p_business_id
    AND private.kasusaha_business_license_is_verified(w.id)
  ORDER BY l.activated_at DESC NULLS LAST,l.created_at DESC
  LIMIT 1;

  IF v_features IS NULL THEN
    RAISE EXCEPTION 'Paket aktif dan pembayaran terverifikasi tidak ditemukan untuk usaha ini.';
  END IF;

  RETURN jsonb_build_object(
    'plan_code',coalesce(v_plan_code,'legacy'),
    'package_name',v_package_name,
    'features',v_features
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_get_business_package_entitlements(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.kasusaha_get_business_package_entitlements(uuid) TO authenticated;
