-- KasUsaha Lite: read-only SECURITY DEFINER audit
-- Run in Supabase SQL Editor. This script does not modify database objects,
-- grants, policies, customer data, or application configuration.
--
-- Review every returned row manually. "auth.uid" detection is a heuristic:
-- authorization may also be enforced through private helper functions,
-- membership checks, row ownership checks, or trusted service-role paths.

WITH security_definer_functions AS (
  SELECT
    p.oid,
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_userbyid(p.proowner) AS function_owner,
    COALESCE(array_to_string(p.proconfig, '; '), '') AS function_settings,
    pg_get_functiondef(p.oid) AS definition,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef IS TRUE
    AND n.nspname IN ('public', 'private')
)
SELECT
  schema_name,
  function_name,
  arguments,
  function_owner,
  function_settings,
  anon_can_execute,
  authenticated_can_execute,
  service_role_can_execute,
  (position('auth.uid' IN lower(definition)) > 0) AS references_auth_uid,
  (position('auth.jwt' IN lower(definition)) > 0) AS references_auth_jwt,
  (position('private.' IN lower(definition)) > 0) AS references_private_helper,
  CASE
    WHEN anon_can_execute THEN 'REVIEW: callable by anon'
    WHEN authenticated_can_execute
      AND position('auth.uid' IN lower(definition)) = 0
      AND position('auth.jwt' IN lower(definition)) = 0
      AND position('private.' IN lower(definition)) = 0
      THEN 'REVIEW: no obvious caller-context check; inspect manually'
    WHEN function_settings = ''
      THEN 'REVIEW: no function-level settings; verify search_path safety'
    ELSE 'MANUAL REVIEW: verify ownership and tenant isolation'
  END AS review_hint
FROM security_definer_functions
ORDER BY
  anon_can_execute DESC,
  authenticated_can_execute DESC,
  schema_name,
  function_name,
  arguments;

-- Separate summary: counts by execution audience.
WITH security_definer_functions AS (
  SELECT
    p.oid,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef IS TRUE
    AND n.nspname IN ('public', 'private')
)
SELECT
  count(*) AS security_definer_function_count,
  count(*) FILTER (WHERE anon_can_execute) AS executable_by_anon_count,
  count(*) FILTER (WHERE authenticated_can_execute) AS executable_by_authenticated_count
FROM security_definer_functions;
