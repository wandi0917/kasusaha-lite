-- Preserve entitlements for already-issued, verified licenses when a plan is hidden from new sales.
-- The plan active flag controls new checkout visibility only.
-- This migration does not reactivate Professional or grant rights to unverified licenses.

DO $migration$
DECLARE
  v_def text;
  v_old text := 'and paid_plan.active = true';
  v_required text[] := ARRAY[
    'l.status = ''active''',
    'l.activated_at is not null',
    'l.cloud_expires_at is null or l.cloud_expires_at > now()',
    'o.status in (''paid'', ''processing'', ''completed'')',
    'o.paid_at is not null',
    'o.payment_review_required is not true',
    'e.verification_status = ''verified''',
    'e.processed_at is not null',
    'm.user_id = (select auth.uid())',
    'm.active = true',
    'private.kasusaha_business_license_is_verified(w.id)'
  ];
  v_check text;
BEGIN
  v_def := pg_get_functiondef('private.kasusaha_business_has_feature(uuid,text)'::regprocedure);

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected disabled-plan filter was not found; refusing entitlement rewrite';
  END IF;

  -- Remove only the sales-visibility predicate from the paid-plan feature lookup.
  v_def := replace(v_def, v_old, '');
  EXECUTE v_def;

  v_def := pg_get_functiondef('private.kasusaha_business_has_feature(uuid,text)'::regprocedure);

  IF position(v_old in v_def) > 0 THEN
    RAISE EXCEPTION 'Disabled plans are still excluded from existing license entitlements';
  END IF;

  FOREACH v_check IN ARRAY v_required LOOP
    IF position(v_check in v_def) = 0 THEN
      RAISE EXCEPTION 'Required entitlement guard missing after rewrite: %', v_check;
    END IF;
  END LOOP;
END;
$migration$;

COMMENT ON FUNCTION private.kasusaha_business_has_feature(uuid,text) IS
  'Checks verified active business licenses and preserves the features attached to their plan even when that plan is hidden from new sales. Plan active controls sales visibility, not existing license entitlements.';
