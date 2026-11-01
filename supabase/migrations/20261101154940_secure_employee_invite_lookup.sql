create or replace function public.kasusaha_lookup_employee_invite(p_invite_code text)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select to_jsonb(i)
  from public.employee_invite_codes i
  where i.invite_code = upper(trim(coalesce(p_invite_code, '')))
  limit 1;
$function$;

revoke all on function public.kasusaha_lookup_employee_invite(text) from public, anon, authenticated;
grant execute on function public.kasusaha_lookup_employee_invite(text) to service_role;
