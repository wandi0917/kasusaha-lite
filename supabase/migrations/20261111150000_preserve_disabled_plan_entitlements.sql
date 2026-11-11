-- Preserve entitlements for existing licenses when a plan is hidden from new sales.
-- The plan's active flag controls checkout visibility, not historical license rights.
-- This deliberately does not reactivate Professional or expose it to new buyers.
DO $migration$
DECLARE
  v_def text;
  v_old text := 'and paid_plan.active = true';
BEGIN
  v_def := pg_get_functiondef('private.kasusaha_business_has_feature(uuid,text)'::regprocedure);

  IF position(v_old in lower(v_def)) = 0 THEN
    RAISE EXCEPTION 'Expected paid-plan active filter was not found; refusing an unsafe entitlement rewrite.';
  END IF;

  v_def := replace(v_def, v_old, '');
  EXECUTE v_def;

  v_def := pg_get_functiondef('private.kasusaha_business_has_feature(uuid,text)'::regprocedure);
  IF position(v_old in lower(v_def)) > 0 THEN
    RAISE EXCEPTION 'Disabled plans are still excluded from existing license entitlements.';
  END IF;
END;
$migration$;

COMMENT ON FUNCTION private.kasusaha_business_has_feature(uuid,text) IS
  'Checks verified active business licenses and preserves the features attached to their plan even when that plan is hidden from new sales. Plan active controls sales visibility, not existing license entitlements.';
