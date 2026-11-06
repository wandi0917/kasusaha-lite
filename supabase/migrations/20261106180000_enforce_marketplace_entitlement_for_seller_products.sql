-- Enforce marketplace package entitlement for seller product writes.
-- Public product reads remain available for active listings.
-- Existing legacy licenses with a verified payment retain their legacy entitlement.

DROP POLICY IF EXISTS "Penjual dapat menambah produk miliknya" ON public.produk;
CREATE POLICY "Penjual dapat menambah produk miliknya"
ON public.produk
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = (SELECT auth.uid())
  AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
  AND EXISTS (
    SELECT 1
    FROM public.business_workspaces w
    WHERE w.owner_id = (SELECT auth.uid())
      AND private.kasusaha_business_license_is_verified(w.id)
      AND private.kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE
  )
);

-- Owners may always access their own row for safe deactivation; an unentitled seller
-- may not keep a listing active or reactivate it.
DROP POLICY IF EXISTS "Penjual dapat mengubah produk miliknya" ON public.produk;
CREATE POLICY "Penjual dapat mengubah produk miliknya"
ON public.produk
FOR UPDATE
TO authenticated
USING (
  owner_id = (SELECT auth.uid())
  AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
)
WITH CHECK (
  owner_id = (SELECT auth.uid())
  AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
  AND (
    aktif IS FALSE
    OR EXISTS (
      SELECT 1
      FROM public.business_workspaces w
      WHERE w.owner_id = (SELECT auth.uid())
        AND private.kasusaha_business_license_is_verified(w.id)
        AND private.kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE
    )
  )
);

-- Owners can always remove their own listings, including after expiry.
DROP POLICY IF EXISTS "Penjual dapat menghapus produk miliknya" ON public.produk;
CREATE POLICY "Penjual dapat menghapus produk miliknya"
ON public.produk
FOR DELETE
TO authenticated
USING (
  owner_id = (SELECT auth.uid())
  AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
);
