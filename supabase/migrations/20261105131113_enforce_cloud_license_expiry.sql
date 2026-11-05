-- Enforce cloud service expiry for newly issued package licenses.
-- Legacy licenses with no cloud_expires_at remain valid as promised.
CREATE OR REPLACE FUNCTION private.kasusaha_business_license_is_verified(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_workspaces w
    JOIN public.business_members m ON m.business_id = w.id
    JOIN public.kasusaha_licenses l ON l.buyer_id = w.owner_id
    JOIN public.marketplace_orders o ON o.id = l.order_id AND o.buyer_id = l.buyer_id
    JOIN public.marketplace_payment_events e ON e.order_id = o.id
    WHERE w.id = p_business_id
      AND m.user_id = (SELECT auth.uid())
      AND m.active = true
      AND l.status = 'active'
      AND l.product_name = 'KasUsaha Lite'
      AND l.activated_at IS NOT NULL
      AND (l.cloud_expires_at IS NULL OR l.cloud_expires_at > now())
      AND o.status IN ('paid', 'processing', 'completed')
      AND o.paid_at IS NOT NULL
      AND o.payment_review_required IS NOT TRUE
      AND e.verification_status = 'verified'
      AND e.processed_at IS NOT NULL
  );
$function$;
