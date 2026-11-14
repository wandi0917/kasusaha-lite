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
  IF (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) THEN
    RAISE EXCEPTION 'Expected exactly one disabled-plan filter in private entitlement helper; refusing ambiguous rewrite';
  END IF;
  v_def := replace(v_def, v_old, '');
  EXECUTE v_def;
  v_def := pg_get_functiondef('private.kasusaha_business_has_feature(uuid,text)'::regprocedure);
  IF position(v_old in v_def) > 0 THEN
    RAISE EXCEPTION 'Disabled plans are still excluded from existing private entitlements';
  END IF;
  FOREACH v_check IN ARRAY v_required LOOP
    IF position(v_check in v_def) = 0 THEN
      RAISE EXCEPTION 'Required private entitlement guard missing after rewrite: %', v_check;
    END IF;
  END LOOP;
END;
$migration$;

DO $migration$
DECLARE
  v_def text;
  v_old text := 'AND lp.active IS TRUE';
  v_required text[] := ARRAY[
    'p.aktif IS TRUE',
    'p.business_id IS NOT NULL',
    'w.owner_id = p.owner_id',
    'm.user_id = w.owner_id',
    'm.role = ''owner''',
    'm.active IS TRUE',
    'e.verification_status = ''verified''',
    'e.processed_at IS NOT NULL',
    'l.status = ''active''',
    'l.product_name = ''KasUsaha Lite''',
    'l.activated_at IS NOT NULL',
    'l.cloud_expires_at IS NULL OR l.cloud_expires_at > now()',
    'o.status IN (''paid'', ''processing'', ''completed'')',
    'o.paid_at IS NOT NULL',
    'o.payment_review_required IS NOT TRUE',
    't.expires_at > now()'
  ];
  v_check text;
BEGIN
  v_def := pg_get_functiondef('public.kasusaha_marketplace_product_is_public(bigint)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) THEN
    RAISE EXCEPTION 'Expected exactly one disabled-plan filter in public marketplace helper; refusing ambiguous rewrite';
  END IF;
  v_def := replace(v_def, v_old, '');
  EXECUTE v_def;
  v_def := pg_get_functiondef('public.kasusaha_marketplace_product_is_public(bigint)'::regprocedure);
  IF position(v_old in v_def) > 0 THEN
    RAISE EXCEPTION 'Disabled plans are still excluded from existing public marketplace listings';
  END IF;
  FOREACH v_check IN ARRAY v_required LOOP
    IF position(v_check in v_def) = 0 THEN
      RAISE EXCEPTION 'Required public marketplace guard missing after rewrite: %', v_check;
    END IF;
  END LOOP;
END;
$migration$;

COMMENT ON FUNCTION private.kasusaha_business_has_feature(uuid,text) IS
  'Checks verified active business licenses and preserves the features attached to their plan even when that plan is hidden from new sales. Plan active controls sales visibility, not existing license entitlements.';

COMMENT ON FUNCTION public.kasusaha_marketplace_product_is_public(bigint) IS
  'Checks whether a product belongs to an active, verified Owner workspace with a current paid license or trial. Hidden plan status does not revoke existing verified marketplace listing entitlement.';
