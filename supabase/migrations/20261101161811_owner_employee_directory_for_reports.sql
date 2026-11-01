CREATE OR REPLACE FUNCTION public.kasusaha_owner_employee_directory(p_business_id uuid)
RETURNS TABLE(identity_id uuid, user_id uuid, employee_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH owner_access AS (
    SELECT 1 AS allowed
    WHERE (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.business_members m
        WHERE m.business_id = p_business_id
          AND m.user_id = (SELECT auth.uid())
          AND m.active = true
          AND m.role = 'owner'
      )
      AND private.kasusaha_business_license_is_verified(p_business_id)
  ),
  identity_rows AS (
    SELECT i.id, i.business_id, i.employee_name, i.auth_user_id
    FROM private.employee_identities i
    WHERE i.business_id = p_business_id
  )
  SELECT i.id, i.auth_user_id,
         COALESCE(NULLIF(pg_catalog.btrim(i.employee_name), ''), 'Karyawan')
  FROM identity_rows i
  CROSS JOIN owner_access
  WHERE i.auth_user_id IS NOT NULL

  UNION

  SELECT i.id, a.historical_user_id,
         COALESCE(NULLIF(pg_catalog.btrim(i.employee_name), ''), 'Karyawan')
  FROM private.employee_identity_aliases a
  JOIN identity_rows i
    ON i.id = a.identity_id
   AND i.business_id = a.business_id
  CROSS JOIN owner_access
  WHERE a.business_id = p_business_id

  UNION

  SELECT NULL::uuid, m.user_id,
         COALESCE(NULLIF(pg_catalog.btrim(ic.employee_name), ''), 'Karyawan')
  FROM public.business_members m
  LEFT JOIN public.employee_invite_code_users u
    ON u.user_id = m.user_id
   AND u.business_id = m.business_id
  LEFT JOIN public.employee_invite_codes ic
    ON ic.id = u.invite_code_id
   AND ic.business_id = u.business_id
  CROSS JOIN owner_access
  WHERE m.business_id = p_business_id
    AND m.active = true
    AND m.role = 'employee'
    AND NOT EXISTS (
      SELECT 1 FROM identity_rows i
      WHERE i.auth_user_id = m.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM private.employee_identity_aliases a
      WHERE a.business_id = p_business_id
        AND a.historical_user_id = m.user_id
    );
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_owner_employee_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kasusaha_owner_employee_directory(uuid) TO authenticated, service_role;
