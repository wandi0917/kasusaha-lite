create or replace function public.kasusaha_employee_register_alias(
  p_business_id uuid,
  p_canonical_user_id uuid,
  p_alias_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_identity_id uuid;
begin
  if p_business_id is null or p_canonical_user_id is null or p_alias_user_id is null
     or p_canonical_user_id = p_alias_user_id then
    return false;
  end if;

  select a.identity_id into v_identity_id
  from private.employee_identity_aliases a
  where a.business_id = p_business_id
    and a.historical_user_id = p_canonical_user_id
    and a.alias_kind = 'paid_invite_account'
  limit 1;

  if v_identity_id is null then return false; end if;

  insert into private.employee_identity_aliases
    (identity_id, business_id, historical_user_id, alias_kind)
  values
    (v_identity_id, p_business_id, p_alias_user_id, 'historical_session')
  on conflict (business_id, historical_user_id) do nothing;

  return exists (
    select 1
    from private.employee_identity_aliases a
    where a.business_id = p_business_id
      and a.historical_user_id = p_alias_user_id
      and a.identity_id = v_identity_id
      and a.alias_kind = 'historical_session'
  );
end;
$function$;

revoke all on function public.kasusaha_employee_register_alias(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.kasusaha_employee_register_alias(uuid,uuid,uuid) to service_role;
