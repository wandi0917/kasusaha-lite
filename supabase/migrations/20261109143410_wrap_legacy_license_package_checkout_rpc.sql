-- Preserve compatibility for clients that still call the legacy four-argument RPC.
-- Delegate to the serialized, referral-aware implementation so all checkout paths
-- share buyer-level locking and server-side package validation.
CREATE OR REPLACE FUNCTION public.create_kasusaha_package_order(
  p_package_code text,
  p_buyer_name text,
  p_buyer_phone text,
  p_shipping_address text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT public.create_kasusaha_package_order(
    p_package_code,
    p_buyer_name,
    p_buyer_phone,
    p_shipping_address,
    NULL::text
  );
$function$;

REVOKE ALL ON FUNCTION public.create_kasusaha_package_order(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_kasusaha_package_order(text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.create_kasusaha_package_order(text, text, text, text)
  IS 'Compatibility wrapper for older clients; delegates to the serialized five-argument checkout RPC with no referral code.';
