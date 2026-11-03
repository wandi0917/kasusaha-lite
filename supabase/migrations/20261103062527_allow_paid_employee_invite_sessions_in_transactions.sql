-- Employee invite-code sessions are anonymous Supabase Auth users by design.
-- Permit only active, paid-device Employees to use member-scoped cashier and
-- attendance features. Anonymous Owners and unactivated Employees stay blocked.
DO $migration$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('private.kasusaha_business_has_feature(uuid,text)'::regprocedure);
  v_old := $old$    AND NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)$old$;
  v_new := $new$    AND (
      NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
      OR (m.role = 'employee' AND private.kasusaha_employee_device_is_paid(w.id))
    )$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected anonymous-session guard not found in private.kasusaha_business_has_feature.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef('public.kasusaha_get_business_package_entitlements(uuid)'::regprocedure);
  v_old := $old$  IF (SELECT auth.uid()) IS NULL
     OR coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false) THEN$old$;
  v_new := $new$  IF (SELECT auth.uid()) IS NULL THEN$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected login guard not found in kasusaha_get_business_package_entitlements.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$  WHERE w.id=p_business_id
    AND private.kasusaha_business_license_is_verified(w.id)$old$;
  v_new := $new$  WHERE w.id=p_business_id
    AND (
      NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
      OR (m.role = 'employee' AND private.kasusaha_employee_device_is_paid(w.id))
    )
    AND private.kasusaha_business_license_is_verified(w.id)$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected membership/license filter not found in kasusaha_get_business_package_entitlements.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef('public.record_store_quick_sale(uuid,text,jsonb,uuid)'::regprocedure);
  v_old := $old$RAISE EXCEPTION 'Akun anonim tidak diizinkan mencatat transaksi kasir. Gunakan akun Owner atau Karyawan terdaftar.';$old$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected anonymous-session rejection not found in record_store_quick_sale.';
  END IF;
  v_def := replace(v_def, v_old, 'NULL; -- role-specific anonymous-session check follows membership lookup');
  v_old := $old$  IF v_role IS NULL THEN RAISE EXCEPTION 'Akun tidak memiliki akses aktif ke usaha ini.'; END IF;$old$;
  v_new := $new$  IF v_role IS NULL THEN RAISE EXCEPTION 'Akun tidak memiliki akses aktif ke usaha ini.'; END IF;
  IF coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
     AND (v_role <> 'employee' OR NOT private.kasusaha_employee_device_is_paid(p_business_id)) THEN
    RAISE EXCEPTION 'Sesi anonim hanya diizinkan untuk Karyawan dengan perangkat yang sudah diaktifkan Owner.';
  END IF;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected membership guard not found in record_store_quick_sale.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;
