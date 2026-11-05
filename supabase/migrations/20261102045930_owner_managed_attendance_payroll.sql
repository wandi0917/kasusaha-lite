-- Owner-managed attendance payroll.
-- Employees may check in/out and read their own payroll, but cannot set or alter hourly wages.
create or replace function private.guard_business_attendance_hourly_wage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then
    raise exception 'Sesi login tidak valid. Silakan login kembali.';
  end if;

  select bm.role into v_role
  from public.business_members bm
  where bm.business_id = new.business_id
    and bm.user_id = v_uid
    and bm.active = true
  limit 1;

  if v_role is null then
    raise exception 'Akun tidak memiliki keanggotaan aktif pada usaha ini.';
  end if;

  if tg_op = 'UPDATE'
     and new.hourly_wage is distinct from old.hourly_wage
     and v_role <> 'owner' then
    raise exception 'Hanya Owner yang boleh mengubah gaji per jam.';
  end if;

  if tg_op = 'INSERT' and v_role = 'employee' then
    -- Ignore employee-supplied wage. Reuse the last Owner-set wage for this identity.
    select coalesce((
      select a.hourly_wage
      from public.business_attendance a
      where a.business_id = new.business_id
        and (
          a.user_id = new.user_id
          or private.kasusaha_employee_same_identity_user(new.business_id, a.user_id)
        )
        and a.hourly_wage > 0
      order by a.work_date desc, a.created_at desc
      limit 1
    ), 0)
    into new.hourly_wage;
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_business_attendance_hourly_wage() from public, anon, authenticated;

drop trigger if exists trg_guard_business_attendance_hourly_wage on public.business_attendance;
create trigger trg_guard_business_attendance_hourly_wage
before insert or update of hourly_wage on public.business_attendance
for each row execute function private.guard_business_attendance_hourly_wage();
