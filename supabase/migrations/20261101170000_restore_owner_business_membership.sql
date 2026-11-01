-- Safely restore Owner membership for the authenticated account's own workspace(s).
-- Privileged logic stays in the non-exposed private schema; public RPC is invoker-only.
create or replace function private.restore_owner_business_membership()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_workspace_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Akun anonim tidak dapat memulihkan keanggotaan Owner.';
  end if;

  select count(*)::integer
    into v_workspace_count
  from public.business_workspaces w
  where w.owner_id = v_uid;

  if v_workspace_count = 0 then
    return jsonb_build_object(
      'restored', false,
      'reason', 'owned_workspace_not_found'
    );
  end if;

  insert into public.business_members (business_id, user_id, role, active)
  select w.id, v_uid, 'owner', true
  from public.business_workspaces w
  where w.owner_id = v_uid
  on conflict (business_id, user_id)
  do update set role = 'owner', active = true;

  return jsonb_build_object(
    'restored', true,
    'restored_count', v_workspace_count,
    'role', 'owner'
  );
end;
$function$;

revoke all on function private.restore_owner_business_membership() from public;
revoke all on function private.restore_owner_business_membership() from anon;
grant usage on schema private to authenticated;
grant execute on function private.restore_owner_business_membership() to authenticated;

create or replace function public.restore_owner_business_membership()
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.restore_owner_business_membership();
$function$;

revoke all on function public.restore_owner_business_membership() from public;
revoke all on function public.restore_owner_business_membership() from anon;
grant execute on function public.restore_owner_business_membership() to authenticated;
