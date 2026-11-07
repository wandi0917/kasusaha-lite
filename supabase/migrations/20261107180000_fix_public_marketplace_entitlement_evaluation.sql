-- Public marketplace visibility must not depend on the buyer's current login session.
-- Evaluate the listing owner's verified license and plan directly, returning only a boolean.

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
    JOIN public.business_members m
      ON m.business_id = w.id
     AND m.user_id = w.owner_id
     AND m.role = 'owner'
     AND m.active IS TRUE
    WHERE p.id = p_product_id
      AND p.aktif IS TRUE
      AND p.business_id IS NOT NULL
      AND coalesce((
        SELECT CASE
          WHEN l.plan_code IS NULL OR btrim(l.plan_code) = '' THEN true
          ELSE coalesce((lp.features ->> 'marketplace')::boolean, false)
        END
        FROM public.kasusaha_licenses l
        JOIN public.marketplace_orders o
          ON o.id = l.order_id
         AND o.buyer_id = l.buyer_id
        JOIN LATERAL (
          SELECT 1
          FROM public.marketplace_payment_events e
          WHERE e.order_id = o.id
            AND e.verification_status = 'verified'
            AND e.processed_at IS NOT NULL
          LIMIT 1
        ) verified_event ON true
        LEFT JOIN public.kasusaha_license_plans lp
          ON lp.plan_code = l.plan_code
         AND lp.active IS TRUE
        WHERE l.buyer_id = w.owner_id
          AND l.status = 'active'
          AND l.product_name = 'KasUsaha Lite'
          AND l.activated_at IS NOT NULL
          AND (l.cloud_expires_at IS NULL OR l.cloud_expires_at > now())
          AND o.status IN ('paid', 'processing', 'completed')
          AND o.paid_at IS NOT NULL
          AND o.payment_review_required IS NOT TRUE
        ORDER BY l.activated_at DESC NULLS LAST, l.created_at DESC
        LIMIT 1
      ), false) IS TRUE
  );
$function$;
