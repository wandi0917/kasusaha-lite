-- Resolve employee report and attendance history across verified invite-code sessions.
-- A used invite + matching registered name + paid canonical activation is the proof
-- that a recovered anonymous session belongs to the same employee.
-- This deliberately supplements (rather than deletes) legacy identity aliases.

create or replace function private.kasusaha_employee_identity_user_ids(p_business_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when exists (
      select 1
      from public.business_members m
      where m.business_id = p_business_id
        and m.user_id = (select auth.uid())
        and m.active = true
        and m.role = 'employee'
    )
    then coalesce(
      (
        select array_agg(distinct resolved.user_id)
        from (
          select (select auth.uid()) as user_id

          union

          select a.historical_user_id
          from private.employee_identity_aliases me
          join private.employee_identity_aliases a
            on a.business_id = me.business_id
           and a.identity_id = me.identity_id
          where me.business_id = p_business_id
            and me.historical_user_id = (select auth.uid())

          union

          select other_binding.user_id
          from public.employee_invite_code_users current_binding
          join public.employee_invite_codes invite
            on invite.id = current_binding.invite_code_id
           and invite.business_id = current_binding.business_id
           and invite.status = 'used'
           and invite.user_id is not null
          join public.employee_invite_code_users canonical_binding
            on canonical_binding.invite_code_id = invite.id
           and canonical_binding.business_id = invite.business_id
           and canonical_binding.user_id = invite.user_id
          join public.employee_invite_code_users other_binding
            on other_binding.invite_code_id = current_binding.invite_code_id
           and other_binding.business_id = current_binding.business_id
          where current_binding.business_id = p_business_id
            and current_binding.user_id = (select auth.uid())
        ) resolved
      ),
      array[(select auth.uid())]
    )
    else array[]::uuid[]
  end;
$function$;

revoke all on function private.kasusaha_employee_identity_user_ids(uuid) from public, anon;
grant execute on function private.kasusaha_employee_identity_user_ids(uuid) to authenticated, service_role;

create or replace function private.kasusaha_employee_same_identity_user(
  p_business_id uuid,
  p_other_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from private.employee_identity_aliases me
      join private.employee_identity_aliases other_user
        on other_user.business_id = me.business_id
       and other_user.identity_id = me.identity_id
      where me.business_id = p_business_id
        and me.historical_user_id = (select auth.uid())
        and other_user.historical_user_id = p_other_user_id
    )
    or exists (
      select 1
      from public.employee_invite_code_users current_binding
      join public.employee_invite_codes invite
        on invite.id = current_binding.invite_code_id
       and invite.business_id = current_binding.business_id
       and invite.status = 'used'
       and invite.user_id is not null
      join public.employee_invite_code_users canonical_binding
        on canonical_binding.invite_code_id = invite.id
       and canonical_binding.business_id = invite.business_id
       and canonical_binding.user_id = invite.user_id
      join public.employee_invite_code_users other_binding
        on other_binding.invite_code_id = current_binding.invite_code_id
       and other_binding.business_id = current_binding.business_id
      where current_binding.business_id = p_business_id
        and current_binding.user_id = (select auth.uid())
        and other_binding.user_id = p_other_user_id
    );
$function$;

revoke all on function private.kasusaha_employee_same_identity_user(uuid,uuid) from public, anon;
grant execute on function private.kasusaha_employee_same_identity_user(uuid,uuid) to authenticated, service_role;
