\set ON_ERROR_STOP on
DO $test$
BEGIN
  IF NOT private.kasusaha_business_has_feature('00000000-0000-0000-0000-000000000001', 'cashier') THEN
    RAISE EXCEPTION 'FAIL: active verified license on hidden plan did not retain cashier feature';
  END IF;
  IF NOT private.kasusaha_business_has_feature('00000000-0000-0000-0000-000000000001', 'advanced_reports') THEN
    RAISE EXCEPTION 'FAIL: plan feature lookup was not preserved';
  END IF;
END;
$test$;

UPDATE public.marketplace_payment_events SET verification_status = 'pending';
DO $test$
BEGIN
  IF private.kasusaha_business_has_feature('00000000-0000-0000-0000-000000000001', 'cashier') THEN
    RAISE EXCEPTION 'FAIL: unverified payment event granted entitlement';
  END IF;
END;
$test$;
UPDATE public.marketplace_payment_events SET verification_status = 'verified';

UPDATE public.kasusaha_licenses SET cloud_expires_at = now() - interval '1 minute';
DO $test$
BEGIN
  IF private.kasusaha_business_has_feature('00000000-0000-0000-0000-000000000001', 'cashier') THEN
    RAISE EXCEPTION 'FAIL: expired license granted entitlement';
  END IF;
END;
$test$;
UPDATE public.kasusaha_licenses SET cloud_expires_at = now() + interval '30 days';

UPDATE public.marketplace_orders SET status = 'pending', paid_at = null;
DO $test$
BEGIN
  IF private.kasusaha_business_has_feature('00000000-0000-0000-0000-000000000001', 'cashier') THEN
    RAISE EXCEPTION 'FAIL: unpaid order granted entitlement';
  END IF;
END;
$test$;
UPDATE public.marketplace_orders SET status = 'paid', paid_at = now();

UPDATE public.business_members SET active = false;
DO $test$
BEGIN
  IF private.kasusaha_business_has_feature('00000000-0000-0000-0000-000000000001', 'cashier') THEN
    RAISE EXCEPTION 'FAIL: inactive membership granted entitlement';
  END IF;
END;
$test$;

SELECT 'PASS: disabled-plan entitlement preserved; unverified, expired, unpaid, and inactive-member access denied' AS result;
