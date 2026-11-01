create or replace function private.kasusaha_employee_identity_user_ids(p_business_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when exists (
      select 1 from public.business_members m
      where m.business_id = p_business_id
        and m.user_id = (select auth.uid())
        and m.active = true
        and m.role = 'employee'
    )
    then coalesce(
      (
        select array_agg(distinct a.historical_user_id)
        from private.employee_identity_aliases me
        join private.employee_identity_aliases a
          on a.business_id = me.business_id
         and a.identity_id = me.identity_id
        where me.business_id = p_business_id
          and me.historical_user_id = (select auth.uid())
      ),
      array[(select auth.uid())]
    )
    else array[]::uuid[]
  end;
$function$;
revoke all on function private.kasusaha_employee_identity_user_ids(uuid) from public, anon;
grant execute on function private.kasusaha_employee_identity_user_ids(uuid) to authenticated, service_role;

create or replace function public.kasusaha_employee_identity_user_ids(p_business_id uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $function$
  select private.kasusaha_employee_identity_user_ids(p_business_id);
$function$;
revoke all on function public.kasusaha_employee_identity_user_ids(uuid) from public, anon;
grant execute on function public.kasusaha_employee_identity_user_ids(uuid) to authenticated, service_role;
