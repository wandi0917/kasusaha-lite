create or replace function private.kasusaha_employee_same_identity_user(
  p_business_id uuid,
  p_other_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.employee_identity_aliases me
    join private.employee_identity_aliases other_user
      on other_user.business_id = me.business_id
     and other_user.identity_id = me.identity_id
    where me.business_id = p_business_id
      and me.historical_user_id = (select auth.uid())
      and other_user.historical_user_id = p_other_user_id
  );
$function$;

revoke all on function private.kasusaha_employee_same_identity_user(uuid,uuid) from public, anon;
grant execute on function private.kasusaha_employee_same_identity_user(uuid,uuid) to authenticated, service_role;

create or replace function public.kasusaha_employee_identity_user_ids(p_business_id uuid)
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

revoke all on function public.kasusaha_employee_identity_user_ids(uuid) from public, anon;
grant execute on function public.kasusaha_employee_identity_user_ids(uuid) to authenticated, service_role;

drop policy if exists financial_transactions_select_by_role on public.financial_transactions;
create policy financial_transactions_select_by_role
on public.financial_transactions
for select
to authenticated
using (
  exists (
    select 1
    from public.business_members m
    where m.business_id = financial_transactions.business_id
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role = 'owner'
        or (
          m.role = 'employee'
          and financial_transactions.created_by_role = 'employee'
          and financial_transactions.transaction_type = 'income'
          and (
            financial_transactions.created_by = (select auth.uid())
            or private.kasusaha_employee_same_identity_user(
              financial_transactions.business_id,
              financial_transactions.created_by
            )
          )
          and private.kasusaha_employee_device_is_paid(financial_transactions.business_id)
        )
      )
  )
);
