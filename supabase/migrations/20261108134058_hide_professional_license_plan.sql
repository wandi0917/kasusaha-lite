-- Temporarily hide Professional from new license sales.
-- Existing license records and their entitlements are preserved.
BEGIN;

UPDATE public.kasusaha_license_plans
SET active = false,
    updated_at = now()
WHERE plan_code = 'professional'
  AND active IS TRUE;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.kasusaha_license_plans
    WHERE plan_code = 'professional'
  ) THEN
    RAISE EXCEPTION 'Professional package row is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.kasusaha_license_plans
    WHERE plan_code = 'professional'
      AND active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Professional package must remain hidden from new sales';
  END IF;
END;
$verify$;

COMMIT;

-- Rollback, only when Professional is ready to be sold again:
-- UPDATE public.kasusaha_license_plans
-- SET active = true, updated_at = now()
-- WHERE plan_code = 'professional';
