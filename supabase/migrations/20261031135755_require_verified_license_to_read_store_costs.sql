-- Prevent fail-open access to product cost data when package feature lookup is NULL.
CREATE OR REPLACE FUNCTION public.get_store_product_costs(p_business_id uuid)
RETURNS TABLE(product_id uuid, cost_price numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT sp.id, sp.cost_price
  FROM public.store_products sp
  WHERE sp.business_id = p_business_id
    AND (SELECT auth.uid()) IS NOT NULL
    AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
    AND EXISTS (
      SELECT 1 FROM public.business_members m
      WHERE m.business_id = sp.business_id
        AND m.user_id = (SELECT auth.uid())
        AND m.active = true
        AND m.role = 'owner'
    )
    AND private.kasusaha_business_license_is_verified(sp.business_id)
    AND private.kasusaha_business_has_feature(sp.business_id,'full_finance');
$function$;

REVOKE ALL ON FUNCTION public.get_store_product_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_product_costs(uuid) TO authenticated, service_role;
