-- Public buyers can only see active marketplace products whose exact Owner
-- workspace still has a verified license and the marketplace feature.
-- Owner SELECT policy remains intact so sellers can still manage their own legacy rows.

CREATE OR REPLACE FUNCTION public.kasusaha_marketplace_product_is_public(p_product_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.produk p
    JOIN public.business_workspaces w
      ON w.id = p.business_id
     AND w.owner_id = p.owner_id
    WHERE p.id = p_product_id
      AND p.aktif IS TRUE
      AND p.business_id IS NOT NULL
      AND private.kasusaha_business_license_is_verified(w.id)
      AND private.kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE
  );
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_marketplace_product_is_public(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kasusaha_marketplace_product_is_public(bigint)
  TO anon, authenticated;

DROP POLICY IF EXISTS "Publik dapat melihat produk aktif" ON public.produk;
CREATE POLICY "Publik dapat melihat produk aktif"
ON public.produk
FOR SELECT
TO anon, authenticated
USING (public.kasusaha_marketplace_product_is_public(id));
