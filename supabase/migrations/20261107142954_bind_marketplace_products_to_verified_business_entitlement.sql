-- Bind each marketplace listing to one exact Owner workspace.
-- New writes require a verified license with the marketplace feature for that workspace.
-- Legacy rows without a unique Owner workspace are preserved and remain readable;
-- they can be hidden/deleted, and can be assigned only through the Owner-scoped RPC.

ALTER TABLE public.produk
  ADD COLUMN IF NOT EXISTS business_id uuid;

ALTER TABLE public.produk
  ADD CONSTRAINT produk_business_id_fkey
  FOREIGN KEY (business_id)
  REFERENCES public.business_workspaces(id)
  ON DELETE SET NULL;

-- Deterministic backfill only when the owner has exactly one workspace.
-- Ambiguous/orphan legacy rows are intentionally left NULL; no guessed mapping.
UPDATE public.produk p
SET business_id = w.id
FROM (
  SELECT owner_id, min(id::text)::uuid AS id
  FROM public.business_workspaces
  WHERE owner_id IS NOT NULL
  GROUP BY owner_id
  HAVING count(*) = 1
) w
WHERE p.owner_id = w.owner_id
  AND p.business_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_produk_business_id
  ON public.produk(business_id);

-- Business identity is private to signed-in sellers; it is not part of public catalog reads.
GRANT SELECT (business_id) ON TABLE public.produk TO authenticated;

DROP POLICY IF EXISTS "Penjual dapat menambah produk miliknya" ON public.produk;
CREATE POLICY "Penjual dapat menambah produk miliknya"
ON public.produk
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = (SELECT auth.uid())
  AND business_id IS NOT NULL
  AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
  AND EXISTS (
    SELECT 1
    FROM public.business_workspaces w
    WHERE w.id = business_id
      AND w.owner_id = (SELECT auth.uid())
      AND private.kasusaha_business_license_is_verified(w.id)
      AND private.kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE
  )
);

-- Owners may always hide their own listing, but any listing left active must
-- remain tied to this exact workspace and its currently verified marketplace entitlement.
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
    OR (
      business_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.business_workspaces w
        WHERE w.id = business_id
          AND w.owner_id = (SELECT auth.uid())
          AND private.kasusaha_business_license_is_verified(w.id)
          AND private.kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE
      )
    )
  )
);

-- Owners can always remove their own listings, including after license expiry.
DROP POLICY IF EXISTS "Penjual dapat menghapus produk miliknya" ON public.produk;
CREATE POLICY "Penjual dapat menghapus produk miliknya"
ON public.produk
FOR DELETE
TO authenticated
USING (
  owner_id = (SELECT auth.uid())
  AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
);

CREATE OR REPLACE FUNCTION public.kasusaha_assign_my_marketplace_product(
  p_product_id bigint,
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_product public.produk%rowtype;
BEGIN
  IF v_uid IS NULL OR coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Login Owner/Penjual terdaftar diperlukan.';
  END IF;
  IF p_product_id IS NULL OR p_business_id IS NULL THEN
    RAISE EXCEPTION 'Produk dan usaha tujuan wajib dipilih.';
  END IF;

  SELECT p.* INTO v_product
  FROM public.produk p
  WHERE p.id = p_product_id AND p.owner_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau bukan milik akun ini.';
  END IF;

  IF v_product.business_id IS NOT NULL THEN
    IF v_product.business_id = p_business_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', true, 'already_assigned', true,
        'product_id', p_product_id, 'business_id', p_business_id
      );
    END IF;
    RAISE EXCEPTION 'Produk sudah terhubung ke usaha lain. Pemindahan usaha tidak dilakukan otomatis.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_workspaces w
    WHERE w.id = p_business_id
      AND w.owner_id = v_uid
      AND private.kasusaha_business_license_is_verified(w.id)
      AND private.kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE
  ) THEN
    RAISE EXCEPTION 'Usaha tujuan tidak dimiliki akun ini atau lisensinya belum mengizinkan Pasar Online.';
  END IF;

  UPDATE public.produk
  SET business_id = p_business_id
  WHERE id = p_product_id
    AND owner_id = v_uid
    AND business_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk berubah saat proses pengaitan usaha. Muat ulang lalu coba kembali.';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'already_assigned', false,
    'product_id', p_product_id, 'business_id', p_business_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_assign_my_marketplace_product(bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kasusaha_assign_my_marketplace_product(bigint, uuid)
  TO authenticated;
