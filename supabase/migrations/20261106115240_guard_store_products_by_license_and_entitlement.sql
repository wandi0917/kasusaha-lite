-- Enforce verified license and basic_stock entitlement on every store_products path.
-- All currently active packages include basic_stock; legacy licenses retain their
-- grandfathered behavior through the entitlement helper.
DROP POLICY IF EXISTS store_products_member_select ON public.store_products;
CREATE POLICY store_products_member_select
ON public.store_products
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_members m
    WHERE m.business_id = store_products.business_id
      AND m.user_id = (SELECT auth.uid())
      AND m.active = true
      AND (
        m.role = 'owner'
        OR (
          m.role = 'employee'
          AND private.kasusaha_employee_device_is_paid(store_products.business_id)
        )
      )
  )
  AND private.kasusaha_business_license_is_verified(store_products.business_id)
  AND private.kasusaha_business_has_feature(store_products.business_id, 'basic_stock')
);

DROP POLICY IF EXISTS store_products_owner_insert ON public.store_products;
CREATE POLICY store_products_owner_insert
ON public.store_products
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.business_members m
    WHERE m.business_id = store_products.business_id
      AND m.user_id = (SELECT auth.uid())
      AND m.active = true
      AND m.role = 'owner'
  )
  AND private.kasusaha_business_license_is_verified(store_products.business_id)
  AND private.kasusaha_business_has_feature(store_products.business_id, 'basic_stock')
);

DROP POLICY IF EXISTS store_products_owner_update ON public.store_products;
CREATE POLICY store_products_owner_update
ON public.store_products
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_members m
    WHERE m.business_id = store_products.business_id
      AND m.user_id = (SELECT auth.uid())
      AND m.active = true
      AND m.role = 'owner'
  )
  AND private.kasusaha_business_license_is_verified(store_products.business_id)
  AND private.kasusaha_business_has_feature(store_products.business_id, 'basic_stock')
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.business_members m
    WHERE m.business_id = store_products.business_id
      AND m.user_id = (SELECT auth.uid())
      AND m.active = true
      AND m.role = 'owner'
  )
  AND private.kasusaha_business_license_is_verified(store_products.business_id)
  AND private.kasusaha_business_has_feature(store_products.business_id, 'basic_stock')
);

DROP POLICY IF EXISTS store_products_owner_delete ON public.store_products;
CREATE POLICY store_products_owner_delete
ON public.store_products
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_members m
    WHERE m.business_id = store_products.business_id
      AND m.user_id = (SELECT auth.uid())
      AND m.active = true
      AND m.role = 'owner'
  )
  AND private.kasusaha_business_license_is_verified(store_products.business_id)
  AND private.kasusaha_business_has_feature(store_products.business_id, 'basic_stock')
);