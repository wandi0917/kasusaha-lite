drop policy if exists business_attendance_select_member_or_owner on public.business_attendance;
create policy business_attendance_select_member_or_owner
on public.business_attendance
for select
to authenticated
using (
  exists (
    select 1
    from public.business_members m
    where m.business_id = business_attendance.business_id
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role = 'owner'
        or (
          m.role = 'employee'
          and (
            business_attendance.user_id = (select auth.uid())
            or private.kasusaha_employee_same_identity_user(
              business_attendance.business_id,
              business_attendance.user_id
            )
          )
          and private.kasusaha_employee_device_is_paid(business_attendance.business_id)
        )
      )
  )
);

drop policy if exists business_attendance_update_self_or_owner on public.business_attendance;
create policy business_attendance_update_self_or_owner
on public.business_attendance
for update
to authenticated
using (
  private.kasusaha_business_license_is_verified(business_id)
  and exists (
    select 1
    from public.business_members m
    where m.business_id = business_attendance.business_id
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role = 'owner'
        or (
          m.role = 'employee'
          and (
            business_attendance.user_id = (select auth.uid())
            or private.kasusaha_employee_same_identity_user(
              business_attendance.business_id,
              business_attendance.user_id
            )
          )
          and private.kasusaha_employee_device_is_paid(business_attendance.business_id)
        )
      )
  )
)
with check (
  private.kasusaha_business_license_is_verified(business_id)
  and (
    (
      exists (
        select 1 from public.business_members owner_member
        where owner_member.business_id = business_attendance.business_id
          and owner_member.user_id = (select auth.uid())
          and owner_member.active
          and owner_member.role = 'owner'
      )
      and exists (
        select 1 from public.business_members target_member
        where target_member.business_id = business_attendance.business_id
          and target_member.user_id = business_attendance.user_id
          and target_member.active
      )
    )
    or
    (
      exists (
        select 1 from public.business_members employee_member
        where employee_member.business_id = business_attendance.business_id
          and employee_member.user_id = (select auth.uid())
          and employee_member.active
          and employee_member.role = 'employee'
      )
      and (
        business_attendance.user_id = (select auth.uid())
        or private.kasusaha_employee_same_identity_user(
          business_attendance.business_id,
          business_attendance.user_id
        )
      )
      and private.kasusaha_employee_device_is_paid(business_attendance.business_id)
    )
  )
);
