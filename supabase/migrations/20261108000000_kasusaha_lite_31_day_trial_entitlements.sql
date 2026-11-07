-- KasUsaha Lite: one-time 31-day free trial with Lite package entitlements.
-- Safe to reapply: creates one private trial record per Owner and does not modify business data.
-- Trial access is verified server-side; trial records are never exposed through the Data API.

create table if not exists private.kasusaha_free_trials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.business_workspaces(id) on delete cascade,
  plan_code text not null default 'lite' check (plan_code = 'lite'),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint kasusaha_free_trials_owner_unique unique (owner_id),
  constraint kasusaha_free_trials_business_unique unique (business_id),
  constraint kasusaha_free_trials_valid_period check (expires_at > started_at)
);

alter table private.kasusaha_free_trials enable row level security;
revoke all on table private.kasusaha_free_trials from public, anon, authenticated;
comment on table private.kasusaha_free_trials is
  'Server-side one-time 31-day KasUsaha Lite trial. Access only through guarded SECURITY DEFINER RPCs.';

create or replace function public.kasusaha_start_free_trial(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_owner_id uuid;
  v_trial private.kasusaha_free_trials%rowtype;
  v_paid boolean := false;
begin
  if v_uid is null then
    raise exception 'Login akun terdaftar diperlukan untuk memulai uji coba.';
  end if;

  if coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) then
    return jsonb_build_object('success', true, 'status', 'owner_required', 'is_trial', false);
  end if;

  select w.owner_id into v_owner_id
  from public.business_workspaces w
  where w.id = p_business_id;

  if v_owner_id is null then
    raise exception 'Usaha tidak ditemukan.';
  end if;

  if v_owner_id <> v_uid or not exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = v_uid
      and m.role = 'owner' and m.active = true
  ) then
    return jsonb_build_object('success', true, 'status', 'owner_required', 'is_trial', false);
  end if;

  select exists (
    select 1
    from public.kasusaha_licenses l
    join public.marketplace_orders o on o.id = l.order_id and o.buyer_id = l.buyer_id
    join public.marketplace_payment_events e on e.order_id = o.id
    where l.buyer_id = v_uid and l.status = 'active'
      and l.product_name = 'KasUsaha Lite' and l.activated_at is not null
      and (l.cloud_expires_at is null or l.cloud_expires_at > now())
      and o.status in ('paid', 'processing', 'completed')
      and o.paid_at is not null and o.payment_review_required is not true
      and e.verification_status = 'verified' and e.processed_at is not null
  ) into v_paid;

  if v_paid then
    return jsonb_build_object('success', true, 'status', 'paid', 'is_trial', false);
  end if;

  select * into v_trial from private.kasusaha_free_trials t
  where t.owner_id = v_uid limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'status', case when v_trial.expires_at > now() then 'active' else 'expired' end,
      'is_trial', v_trial.business_id = p_business_id and v_trial.expires_at > now(),
      'same_business', v_trial.business_id = p_business_id,
      'business_id', v_trial.business_id, 'plan_code', v_trial.plan_code,
      'started_at', v_trial.started_at, 'expires_at', v_trial.expires_at,
      'days_remaining', greatest(0, ceil(extract(epoch from (v_trial.expires_at - now())) / 86400.0)::integer)
    );
  end if;

  insert into private.kasusaha_free_trials(owner_id, business_id, plan_code, started_at, expires_at)
  values (v_uid, p_business_id, 'lite', now(), now() + interval '31 days')
  on conflict (owner_id) do nothing
  returning * into v_trial;

  if v_trial.id is null then
    select * into v_trial from private.kasusaha_free_trials t
    where t.owner_id = v_uid limit 1;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', case when v_trial.expires_at > now() then 'active' else 'expired' end,
    'is_trial', v_trial.business_id = p_business_id and v_trial.expires_at > now(),
    'same_business', v_trial.business_id = p_business_id,
    'business_id', v_trial.business_id, 'plan_code', v_trial.plan_code,
    'started_at', v_trial.started_at, 'expires_at', v_trial.expires_at,
    'days_remaining', greatest(0, ceil(extract(epoch from (v_trial.expires_at - now())) / 86400.0)::integer)
  );
end;
$function$;

revoke all on function public.kasusaha_start_free_trial(uuid) from public, anon;
grant execute on function public.kasusaha_start_free_trial(uuid) to authenticated;

create or replace function public.kasusaha_get_business_trial_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_owner_id uuid;
  v_trial private.kasusaha_free_trials%rowtype;
  v_paid boolean := false;
begin
  if v_uid is null then raise exception 'Login akun terdaftar diperlukan.'; end if;

  select w.owner_id into v_owner_id
  from public.business_workspaces w where w.id = p_business_id;

  if v_owner_id is null or not exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = v_uid and m.active = true
  ) then
    raise exception 'Akses ke usaha ini tidak diizinkan.';
  end if;

  select exists (
    select 1
    from public.kasusaha_licenses l
    join public.marketplace_orders o on o.id = l.order_id and o.buyer_id = l.buyer_id
    join public.marketplace_payment_events e on e.order_id = o.id
    where l.buyer_id = v_owner_id and l.status = 'active'
      and l.product_name = 'KasUsaha Lite' and l.activated_at is not null
      and (l.cloud_expires_at is null or l.cloud_expires_at > now())
      and o.status in ('paid', 'processing', 'completed')
      and o.paid_at is not null and o.payment_review_required is not true
      and e.verification_status = 'verified' and e.processed_at is not null
  ) into v_paid;

  if v_paid then
    return jsonb_build_object('success', true, 'is_trial', false, 'status', 'paid');
  end if;

  select * into v_trial from private.kasusaha_free_trials t
  where t.owner_id = v_owner_id limit 1;

  if not found then
    return jsonb_build_object('success', true, 'is_trial', false, 'status', 'not_started');
  end if;

  if v_trial.business_id <> p_business_id then
    return jsonb_build_object(
      'success', true, 'is_trial', false, 'status', 'already_used',
      'used_for_business_id', v_trial.business_id, 'expires_at', v_trial.expires_at
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'is_trial', v_trial.expires_at > now(),
    'status', case when v_trial.expires_at > now() then 'active' else 'expired' end,
    'plan_code', v_trial.plan_code, 'started_at', v_trial.started_at,
    'expires_at', v_trial.expires_at,
    'days_remaining', greatest(0, ceil(extract(epoch from (v_trial.expires_at - now())) / 86400.0)::integer)
  );
end;
$function$;

revoke all on function public.kasusaha_get_business_trial_status(uuid) from public, anon;
grant execute on function public.kasusaha_get_business_trial_status(uuid) to authenticated;

create or replace function private.kasusaha_business_license_is_verified(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.business_workspaces w
    join public.business_members m
      on m.business_id = w.id and m.user_id = (select auth.uid()) and m.active = true
    where w.id = p_business_id
      and (
        exists (
          select 1
          from public.kasusaha_licenses l
          join public.marketplace_orders o on o.id = l.order_id and o.buyer_id = l.buyer_id
          join public.marketplace_payment_events e on e.order_id = o.id
          where l.buyer_id = w.owner_id and l.status = 'active'
            and l.product_name = 'KasUsaha Lite' and l.activated_at is not null
            and (l.cloud_expires_at is null or l.cloud_expires_at > now())
            and o.status in ('paid', 'processing', 'completed')
            and o.paid_at is not null and o.payment_review_required is not true
            and e.verification_status = 'verified' and e.processed_at is not null
        )
        or exists (
          select 1 from private.kasusaha_free_trials t
          where t.business_id = w.id and t.owner_id = w.owner_id
            and t.plan_code = 'lite' and t.started_at <= now() and t.expires_at > now()
        )
      )
  );
$function$;

grant execute on function private.kasusaha_business_license_is_verified(uuid) to authenticated;

create or replace function private.kasusaha_business_has_feature(p_business_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select case
      when paid.license_id is not null then
        case when paid.plan_code is null or btrim(paid.plan_code) = '' then true
          else coalesce((paid_plan.features ->> p_feature)::boolean, false) end
      when trial.business_id is not null then coalesce((lite_plan.features ->> p_feature)::boolean, false)
      else false
    end
    from public.business_workspaces w
    join public.business_members m
      on m.business_id = w.id and m.user_id = (select auth.uid()) and m.active = true
    left join lateral (
      select l.id as license_id, l.plan_code
      from public.kasusaha_licenses l
      join public.marketplace_orders o on o.id = l.order_id and o.buyer_id = l.buyer_id
      join public.marketplace_payment_events e on e.order_id = o.id
      where l.buyer_id = w.owner_id and l.status = 'active'
        and l.product_name = 'KasUsaha Lite' and l.activated_at is not null
        and (l.cloud_expires_at is null or l.cloud_expires_at > now())
        and o.status in ('paid', 'processing', 'completed')
        and o.paid_at is not null and o.payment_review_required is not true
        and e.verification_status = 'verified' and e.processed_at is not null
      order by l.activated_at desc nulls last, l.created_at desc limit 1
    ) paid on true
    left join public.kasusaha_license_plans paid_plan
      on paid_plan.plan_code = paid.plan_code and paid_plan.active = true
    left join private.kasusaha_free_trials trial
      on trial.business_id = w.id and trial.owner_id = w.owner_id
      and trial.plan_code = 'lite' and trial.started_at <= now() and trial.expires_at > now()
    left join public.kasusaha_license_plans lite_plan
      on lite_plan.plan_code = 'lite' and lite_plan.active = true
    where w.id = p_business_id and (select auth.uid()) is not null
      and (
        not coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false)
        or (m.role = 'employee' and private.kasusaha_employee_device_is_paid(w.id))
      )
      and private.kasusaha_business_license_is_verified(w.id)
    limit 1
  ), false);
$function$;

grant execute on function private.kasusaha_business_has_feature(uuid, text) to authenticated;

create or replace function public.kasusaha_get_business_package_entitlements(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_plan_code text;
  v_package_name text;
  v_features jsonb;
  v_trial_started_at timestamptz;
  v_trial_expires_at timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'Login akun terdaftar diperlukan.'; end if;

  select
    case when paid.license_id is not null then coalesce(nullif(paid.plan_code, ''), 'legacy') else 'lite' end,
    case when paid.license_id is not null then coalesce(paid.package_name, paid_plan.plan_name, 'Lisensi lama')
      else 'Lite (Uji Coba Gratis 31 Hari)' end,
    case when paid.license_id is not null then
      case when paid.plan_code is null or btrim(paid.plan_code) = '' then
        '{"barcode":true,"cashier":true,"employees":true,"attendance":true,"basic_stock":true,"marketplace":true,"full_finance":true,"sales_reports":true,"basic_products":true,"advanced_reports":true,"priority_support":true}'::jsonb
      else coalesce(paid_plan.features, '{}'::jsonb) end
      else coalesce(lite_plan.features, '{}'::jsonb) end,
    case when paid.license_id is null then trial.started_at else null end,
    case when paid.license_id is null then trial.expires_at else null end
  into v_plan_code, v_package_name, v_features, v_trial_started_at, v_trial_expires_at
  from public.business_workspaces w
  join public.business_members m
    on m.business_id = w.id and m.user_id = (select auth.uid()) and m.active = true
  left join lateral (
    select l.id as license_id, l.plan_code, l.package_name, l.activated_at, l.created_at
    from public.kasusaha_licenses l
    join public.marketplace_orders o on o.id = l.order_id and o.buyer_id = l.buyer_id
    join public.marketplace_payment_events e on e.order_id = o.id
    where l.buyer_id = w.owner_id and l.status = 'active'
      and l.product_name = 'KasUsaha Lite' and l.activated_at is not null
      and (l.cloud_expires_at is null or l.cloud_expires_at > now())
      and o.status in ('paid', 'processing', 'completed')
      and o.paid_at is not null and o.payment_review_required is not true
      and e.verification_status = 'verified' and e.processed_at is not null
    order by l.activated_at desc nulls last, l.created_at desc limit 1
  ) paid on true
  left join public.kasusaha_license_plans paid_plan
    on paid_plan.plan_code = paid.plan_code and paid_plan.active = true
  left join private.kasusaha_free_trials trial
    on trial.business_id = w.id and trial.owner_id = w.owner_id
    and trial.plan_code = 'lite' and trial.started_at <= now() and trial.expires_at > now()
  left join public.kasusaha_license_plans lite_plan
    on lite_plan.plan_code = 'lite' and lite_plan.active = true
  where w.id = p_business_id
    and (
      not coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false)
      or (m.role = 'employee' and private.kasusaha_employee_device_is_paid(w.id))
    )
    and (paid.license_id is not null or trial.business_id is not null)
  limit 1;

  if v_features is null then
    raise exception 'Paket aktif, uji coba aktif, dan pembayaran terverifikasi tidak ditemukan untuk usaha ini.';
  end if;

  return jsonb_build_object(
    'plan_code', coalesce(v_plan_code, 'legacy'),
    'package_name', v_package_name,
    'features', v_features,
    'is_trial', v_trial_expires_at is not null and v_trial_expires_at > now(),
    'trial_started_at', v_trial_started_at,
    'trial_expires_at', v_trial_expires_at,
    'trial_days_remaining', case when v_trial_expires_at is not null
      then greatest(0, ceil(extract(epoch from (v_trial_expires_at - now())) / 86400.0)::integer)
      else null end
  );
end;
$function$;

revoke all on function public.kasusaha_get_business_package_entitlements(uuid) from public, anon;
grant execute on function public.kasusaha_get_business_package_entitlements(uuid) to authenticated;

create or replace function public.create_business_workspace(p_business_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_business public.business_workspaces%rowtype;
  v_role text;
  v_paid boolean := false;
  v_prior_trial private.kasusaha_free_trials%rowtype;
  v_trial private.kasusaha_free_trials%rowtype;
begin
  if v_uid is null then raise exception 'Silakan login terlebih dahulu.'; end if;
  if coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) then
    raise exception 'Akun anonim hanya dapat bergabung sebagai Karyawan melalui kode undangan Owner.';
  end if;
  if p_business_name is null or length(trim(p_business_name)) not between 1 and 120 then
    raise exception 'Nama usaha wajib diisi (maksimal 120 karakter).';
  end if;

  select w.* into v_business
  from public.business_workspaces w
  join public.business_members m on m.business_id = w.id
  where m.user_id = v_uid and m.active
  order by case when m.role = 'owner' and w.owner_id = v_uid then 0 else 1 end, w.id
  limit 1;

  if found then
    select m.role into v_role from public.business_members m
    where m.business_id = v_business.id and m.user_id = v_uid and m.active;
    if v_role = 'owner' then
      return jsonb_build_object('success', true, 'business_id', v_business.id,
        'business_name', v_business.business_name, 'invite_code', v_business.invite_code,
        'role', v_role, 'existing', true);
    end if;
    return jsonb_build_object('success', true, 'business_id', v_business.id,
      'business_name', v_business.business_name, 'role', v_role, 'existing', true);
  end if;

  select exists (
    select 1
    from public.kasusaha_licenses l
    join public.marketplace_orders o on o.id = l.order_id and o.buyer_id = l.buyer_id
    join public.marketplace_payment_events e on e.order_id = o.id
    where l.buyer_id = v_uid and l.status = 'active'
      and l.product_name = 'KasUsaha Lite' and l.activated_at is not null
      and (l.cloud_expires_at is null or l.cloud_expires_at > now())
      and o.status in ('paid', 'processing', 'completed')
      and o.paid_at is not null and o.payment_review_required is not true
      and e.verification_status = 'verified' and e.processed_at is not null
  ) into v_paid;

  if not v_paid then
    select * into v_prior_trial from private.kasusaha_free_trials t
    where t.owner_id = v_uid limit 1;
    if found then
      raise exception 'Uji coba gratis 31 hari sudah pernah digunakan. Aktifkan lisensi KasUsaha Lite untuk membuat usaha baru atau melanjutkan akses.';
    end if;
  end if;

  insert into public.business_workspaces(owner_id, business_name)
  values (v_uid, trim(p_business_name)) returning * into v_business;

  insert into public.business_members(business_id, user_id, role)
  values (v_business.id, v_uid, 'owner');

  if not v_paid then
    insert into private.kasusaha_free_trials(owner_id, business_id, plan_code, started_at, expires_at)
    values (v_uid, v_business.id, 'lite', now(), now() + interval '31 days')
    returning * into v_trial;
  end if;

  return jsonb_build_object(
    'success', true, 'business_id', v_business.id,
    'business_name', v_business.business_name, 'invite_code', v_business.invite_code,
    'role', 'owner', 'existing', false, 'is_trial', v_trial.id is not null,
    'trial_started_at', v_trial.started_at, 'trial_expires_at', v_trial.expires_at
  );
end;
$function$;

revoke all on function public.create_business_workspace(text) from public, anon;
grant execute on function public.create_business_workspace(text) to authenticated;
