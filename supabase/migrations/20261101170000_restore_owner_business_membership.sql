-- Restore an Owner membership only when the authenticated user owns the workspace.
-- This avoids relying on a direct SELECT blocked by business_workspaces RLS.
create or replace function public.restore_owner_business_membership()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_business_id uuid;
  v_business_name text;
  v_other_business_id uuid;
begin
  if v_uid is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Akun anonim tidak dapat memulihkan keanggotaan Owner.';
  end if;

  select m.business_id
    into v_other_business_id
  from public.business_members m
  where m.user_id = v_uid
    and m.active
  limit 1;

  select w.id, w.business_name
    into v_business_id, v_business_name
  from public.business_workspaces w
  where w.owner_id = v_uid
  order by w.created_at desc
  limit 1;

  if v_business_id is null then
    return jsonb_build_object('restored', false, 'reason', 'owned_workspace_not_found');
  end if;

  if v_other_business_id is not null and v_other_business_id <> v_business_id then
    return jsonb_build_object('restored', false, 'reason', 'active_membership_other_business');
  end if;

  insert into public.business_members (business_id, user_id, role, active)
  values (v_business_id, v_uid, 'owner', true)
  on conflict (business_id, user_id)
  do update set role = 'owner', active = true;

  return jsonb_build_object(
    'restored', true,
    'business_id', v_business_id,
    'business_name', v_business_name,
    'role', 'owner'
  );
end;
$function$;

revoke all on function public.restore_owner_business_membership() from public;
revoke all on function public.restore_owner_business_membership() from anon;
grant execute on function public.restore_owner_business_membership() to authenticated;
