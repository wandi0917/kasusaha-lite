-- Manual seller payout workflow.
-- Additive only. Do not apply until the Supabase migration baseline is reconciled.
-- Eligibility: verified Midtrans payment, delivered webhook timestamp + 7x24h,
-- no payment review, refund/chargeback/dispute, return, or manual hold.
-- Shipping is excluded from the 2.5% commission base.

alter table public.marketplace_orders
  add column if not exists shipping_delivered_at timestamptz;

alter table public.marketplace_order_items
  add column if not exists payout_hold boolean not null default false,
  add column if not exists payout_hold_reason text,
  add column if not exists payout_hold_set_by uuid references auth.users(id),
  add column if not exists payout_hold_set_at timestamptz;

alter table public.marketplace_payout_ledger
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists paid_by uuid references auth.users(id),
  add column if not exists failed_by uuid references auth.users(id),
  add column if not exists transfer_reference text,
  add column if not exists transfer_evidence_path text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.marketplace_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.marketplace_payout_ledger(id) on delete restrict,
  order_item_id uuid not null unique references public.marketplace_order_items(id) on delete restrict,
  commission_ledger_id uuid not null references public.marketplace_commission_ledger(id) on delete restrict,
  item_subtotal numeric(18,2) not null check (item_subtotal > 0),
  commission_amount numeric(18,2) not null check (commission_amount >= 0),
  seller_net_amount numeric(18,2) not null check (seller_net_amount > 0),
  delivered_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint marketplace_payout_items_amount_check
    check (seller_net_amount = item_subtotal - commission_amount)
);

create index if not exists marketplace_payout_items_payout_id_idx
  on public.marketplace_payout_items(payout_id);

create index if not exists marketplace_payout_ledger_seller_status_idx
  on public.marketplace_payout_ledger(recipient_user_id,status,requested_at desc)
  where recipient_type = 'seller';

create unique index if not exists marketplace_payout_ledger_seller_transfer_reference_unique
  on public.marketplace_payout_ledger(transfer_reference)
  where recipient_type = 'seller' and transfer_reference is not null;

alter table public.marketplace_payout_items enable row level security;
revoke all on public.marketplace_payout_items from public, anon, authenticated;
grant select, insert, update on table public.marketplace_payout_items to service_role;

insert into storage.buckets (id, name, public)
values ('marketplace-payout-evidence', 'marketplace-payout-evidence', false)
on conflict (id) do update set public = false;

create policy "platform owners manage marketplace payout evidence"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'marketplace-payout-evidence'
  and exists (
    select 1 from public.platform_admins a
    where a.user_id = (select auth.uid())
      and a.active = true
      and a.role = 'platform_owner'
  )
)
with check (
  bucket_id = 'marketplace-payout-evidence'
  and exists (
    select 1 from public.platform_admins a
    where a.user_id = (select auth.uid())
      and a.active = true
      and a.role = 'platform_owner'
  )
);

create or replace function private.request_seller_marketplace_payout(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_seller uuid := auth.uid();
  v_key text;
  v_payout_id uuid;
  v_item_ids uuid[];
  v_total numeric(18,2);
  v_count integer;
begin
  if v_seller is null then raise exception 'Login seller diperlukan.'; end if;
  if p_request_id is null then raise exception 'ID permintaan tidak valid.'; end if;
  v_key := 'seller-manual-transfer:' || v_seller::text || ':' || p_request_id::text;

  perform pg_advisory_xact_lock(hashtextextended(v_seller::text, 0));

  select id into v_payout_id
  from public.marketplace_payout_ledger
  where idempotency_key = v_key
    and recipient_user_id = v_seller
    and recipient_type = 'seller';
  if found then
    return jsonb_build_object('ok',true,'replayed',true,'payout_id',v_payout_id);
  end if;

  with commission_rollup as (
    select c.order_item_id,
      count(*) filter (where c.entry_type = 'commission') as commission_count,
      (array_agg(c.id order by c.id) filter (where c.entry_type = 'commission'))[1] as commission_ledger_id,
      max(c.amount) filter (where c.entry_type = 'commission') as commission_amount,
      bool_or(c.entry_type <> 'commission') as has_adjustment
    from public.marketplace_commission_ledger c
    group by c.order_item_id
  ),
  eligible as (
    select oi.id, oi.order_id, oi.seller_id, oi.item_subtotal,
      cr.commission_ledger_id, cr.commission_amount, o.shipping_delivered_at
    from public.marketplace_order_items oi
    join public.marketplace_orders o on o.id = oi.order_id
    join commission_rollup cr on cr.order_item_id = oi.id
    where oi.seller_id = v_seller
      and oi.item_subtotal > 0
      and (oi.product_id is null or oi.product_id not in (7,8,9,10))
      and oi.payout_hold = false
      and cr.commission_count = 1
      and cr.has_adjustment is distinct from true
      and cr.commission_amount = round(oi.item_subtotal * 0.025, 2)
      and o.status in ('paid','processing','completed')
      and o.payment_review_required = false
      and o.payment_provider = 'midtrans'
      and o.paid_at is not null
      and o.shipping_provider = 'Biteship'
      and o.shipping_status = 'delivered'
      and o.shipping_delivered_at <= now() - interval '7 days'
      and exists (
        select 1 from public.marketplace_payment_events e
        where e.order_id = o.id
          and e.provider = 'midtrans'
          and e.event_type in ('capture','settlement')
          and e.verification_status = 'verified'
          and e.processed_at is not null
      )
      and not exists (
        select 1 from public.marketplace_payment_events e
        where e.order_id = o.id
          and (
            lower(e.event_type) like '%refund%'
            or lower(e.event_type) like '%chargeback%'
            or lower(e.event_type) like '%dispute%'
          )
      )
      and not exists (
        select 1 from public.marketplace_payout_items pi
        where pi.order_item_id = oi.id
      )
  )
  select array_agg(id order by id),
         coalesce(sum(item_subtotal - commission_amount),0),
         count(*)
    into v_item_ids, v_total, v_count
  from eligible;

  if coalesce(v_count,0) = 0 or coalesce(v_total,0) <= 0 then
    raise exception 'Belum ada item yang memenuhi syarat pencairan. Periksa pembayaran, status delivered, masa tahan 7 hari, refund/sengketa, dan penahanan manual.';
  end if;

  insert into public.marketplace_payout_ledger
    (recipient_user_id,recipient_type,amount,currency,status,provider,idempotency_key,notes,requested_at,updated_at)
  values
    (v_seller,'seller',v_total,'IDR','pending','manual_bank_transfer',v_key,
     'Permintaan pencairan seller; menunggu pemeriksaan Platform Owner.',now(),now())
  returning id into v_payout_id;

  with commission_rollup as (
    select c.order_item_id,
      (array_agg(c.id order by c.id) filter (where c.entry_type = 'commission'))[1] as commission_ledger_id,
      max(c.amount) filter (where c.entry_type = 'commission') as commission_amount
    from public.marketplace_commission_ledger c
    group by c.order_item_id
  )
  insert into public.marketplace_payout_items
    (payout_id,order_item_id,commission_ledger_id,item_subtotal,commission_amount,seller_net_amount,delivered_at)
  select v_payout_id, oi.id, cr.commission_ledger_id, oi.item_subtotal,
    cr.commission_amount, oi.item_subtotal-cr.commission_amount, o.shipping_delivered_at
  from public.marketplace_order_items oi
  join public.marketplace_orders o on o.id=oi.order_id
  join commission_rollup cr on cr.order_item_id=oi.id
  where oi.id = any(v_item_ids);

  return jsonb_build_object(
    'ok',true,'replayed',false,'payout_id',v_payout_id,
    'amount',v_total,'item_count',v_count,'currency','IDR','status','pending'
  );
end;
$function$;

create or replace function public.request_seller_marketplace_payout(p_request_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.request_seller_marketplace_payout(p_request_id);
$function$;

create or replace function private.platform_owner_update_seller_payout(
  p_payout_id uuid,
  p_action text,
  p_transfer_reference text default null,
  p_evidence_path text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
  v_payout public.marketplace_payout_ledger%rowtype;
begin
  if v_admin is null or not exists (
    select 1 from public.platform_admins a
    where a.user_id=v_admin and a.active=true and a.role='platform_owner'
  ) then raise exception 'Hanya Platform Owner aktif yang dapat mengelola pencairan.'; end if;

  select * into v_payout
  from public.marketplace_payout_ledger
  where id=p_payout_id and recipient_type='seller'
  for update;
  if not found then raise exception 'Permintaan pencairan seller tidak ditemukan.'; end if;

  if p_action in ('mark_submitted','retry_submitted') then
    if v_payout.status not in ('pending','failed') then
      raise exception 'Pencairan hanya dapat dikirim dari status pending atau failed.';
    end if;
    if nullif(trim(p_transfer_reference),'') is null
       or nullif(trim(p_evidence_path),'') is null
       or nullif(trim(p_note),'') is null then
      raise exception 'Referensi transfer, bukti transfer, dan catatan wajib diisi.';
    end if;
    if split_part(trim(p_evidence_path), '/', 1) <> p_payout_id::text
       or split_part(trim(p_evidence_path), '/', 2) = ''
       or split_part(trim(p_evidence_path), '/', 3) <> '' then
      raise exception 'Lokasi bukti transfer tidak sesuai folder payout.';
    end if;
    set status='submitted',provider='manual_bank_transfer',
        transfer_reference=left(trim(p_transfer_reference),160),
        transfer_evidence_path=left(trim(p_evidence_path),500),
        submitted_by=v_admin,notes=left(trim(p_note),1000),updated_at=now()
    where id=p_payout_id;
  elsif p_action='mark_paid' then
    if v_payout.status <> 'submitted' then
      raise exception 'Status harus submitted sebelum dikonfirmasi paid.';
    end if;
    if nullif(trim(v_payout.transfer_reference),'') is null
       or nullif(trim(v_payout.transfer_evidence_path),'') is null
       or nullif(trim(p_note),'') is null then
      raise exception 'Referensi, bukti transfer, dan konfirmasi tertulis wajib tersedia.';
    end if;
    if exists (
      select 1
      from public.marketplace_payout_items pi
      join public.marketplace_order_items oi on oi.id=pi.order_item_id
      join public.marketplace_orders o on o.id=oi.order_id
      where pi.payout_id=p_payout_id
        and (
          oi.payout_hold = true
          or o.status not in ('paid','processing','completed')
          or o.payment_review_required = true
          or o.shipping_status <> 'delivered'
          or o.shipping_delivered_at is null
          or o.shipping_delivered_at > now() - interval '7 days'
          or not exists (
            select 1 from public.marketplace_payment_events e
            where e.order_id=o.id and e.provider='midtrans'
              and e.event_type in ('capture','settlement')
              and e.verification_status='verified' and e.processed_at is not null
          )
          or exists (
            select 1 from public.marketplace_payment_events e
            where e.order_id=o.id and (
              lower(e.event_type) like '%refund%'
              or lower(e.event_type) like '%chargeback%'
              or lower(e.event_type) like '%dispute%'
            )
          )
        )
    ) then
      raise exception 'Payout ditahan karena item tidak lagi memenuhi syarat atau ada sengketa/refund.';
    end if;
    if not exists (
      select 1 from storage.objects so
      where so.bucket_id='marketplace-payout-evidence'
        and so.name=v_payout.transfer_evidence_path
    ) then
      raise exception 'File bukti transfer tidak lagi tersedia di bucket privat.';
    end if;
    update public.marketplace_payout_ledger
    set status='paid',paid_by=v_admin,completed_at=now(),
        notes=left(trim(p_note),1000),updated_at=now()
    where id=p_payout_id;
  elsif p_action='mark_failed' then
    if v_payout.status not in ('pending','submitted') then
      raise exception 'Pencairan hanya dapat dinyatakan gagal dari pending atau submitted.';
    end if;
    if nullif(trim(p_note),'') is null then
      raise exception 'Alasan kegagalan wajib diisi.';
    end if;
    update public.marketplace_payout_ledger
    set status='failed',failed_by=v_admin,notes=left(trim(p_note),1000),updated_at=now()
    where id=p_payout_id;
  else
    raise exception 'Aksi pencairan tidak dikenal.';
  end if;

  return jsonb_build_object('ok',true,'payout_id',p_payout_id,'status',
    (select status from public.marketplace_payout_ledger where id=p_payout_id));
end;
$function$;

create or replace function public.platform_owner_update_seller_payout(
  p_payout_id uuid,
  p_action text,
  p_transfer_reference text default null,
  p_evidence_path text default null,
  p_note text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.platform_owner_update_seller_payout(
    p_payout_id,p_action,p_transfer_reference,p_evidence_path,p_note
  );
$function$;

create or replace function private.platform_owner_set_seller_payout_hold(
  p_order_item_id uuid,
  p_hold boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (
    select 1 from public.platform_admins a
    where a.user_id=v_admin and a.active=true and a.role='platform_owner'
  ) then raise exception 'Hanya Platform Owner aktif yang dapat mengubah penahanan item.'; end if;
  if p_order_item_id is null or p_hold is null then raise exception 'Rincian penahanan tidak valid.'; end if;
  if p_hold and nullif(trim(p_reason),'') is null then raise exception 'Alasan penahanan wajib diisi.'; end if;
  if exists (select 1 from public.marketplace_payout_items pi
    join public.marketplace_payout_ledger pl on pl.id=pi.payout_id
    where pi.order_item_id=p_order_item_id and pl.status in ('submitted','paid')) then
    raise exception 'Item yang sudah dikirim untuk transfer atau dibayar tidak dapat diubah status penahanannya.';
  end if;
  update public.marketplace_order_items
  set payout_hold=p_hold,
      payout_hold_reason=case when p_hold then left(trim(p_reason),1000) else null end,
      payout_hold_set_by=case when p_hold then v_admin else null end,
      payout_hold_set_at=case when p_hold then now() else null end
  where id=p_order_item_id;
  if not found then raise exception 'Item pesanan tidak ditemukan.'; end if;
  return jsonb_build_object('ok',true,'order_item_id',p_order_item_id,'payout_hold',p_hold);
end;
$function$;

create or replace function public.platform_owner_set_seller_payout_hold(
  p_order_item_id uuid,p_hold boolean,p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.platform_owner_set_seller_payout_hold(p_order_item_id,p_hold,p_reason);
$function$;

revoke all on function private.request_seller_marketplace_payout(uuid) from public, anon;
revoke all on function public.request_seller_marketplace_payout(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.request_seller_marketplace_payout(uuid) to authenticated;
grant execute on function public.request_seller_marketplace_payout(uuid) to authenticated;

revoke all on function private.platform_owner_update_seller_payout(uuid,text,text,text,text) from public, anon;
revoke all on function public.platform_owner_update_seller_payout(uuid,text,text,text,text) from public, anon;
grant execute on function private.platform_owner_update_seller_payout(uuid,text,text,text,text) to authenticated;
grant execute on function public.platform_owner_update_seller_payout(uuid,text,text,text,text) to authenticated;

revoke all on function private.platform_owner_set_seller_payout_hold(uuid,boolean,text) from public, anon;
revoke all on function public.platform_owner_set_seller_payout_hold(uuid,boolean,text) from public, anon;
grant execute on function private.platform_owner_set_seller_payout_hold(uuid,boolean,text) to authenticated;
grant execute on function public.platform_owner_set_seller_payout_hold(uuid,boolean,text) to authenticated;

drop policy if exists "platform owners manage marketplace payout evidence" on storage.objects;
) then
      raise exception 'Lokasi bukti transfer tidak sesuai folder aman Platform Owner.';
    end if;
    if exists (
      select 1
      from public.marketplace_payout_items pi
      join public.marketplace_order_items oi on oi.id=pi.order_item_id
      join public.marketplace_orders o on o.id=oi.order_id
      where pi.payout_id=p_payout_id
        and (
          oi.payout_hold = true
          or o.status not in ('paid','processing','completed')
          or o.payment_review_required = true
          or o.shipping_status <> 'delivered'
          or o.shipping_delivered_at is null
          or o.shipping_delivered_at > now() - interval '7 days'
          or not exists (
            select 1 from public.marketplace_payment_events e
            where e.order_id=o.id and e.provider='midtrans'
              and e.event_type in ('capture','settlement')
              and e.verification_status='verified' and e.processed_at is not null
          )
          or exists (
            select 1 from public.marketplace_payment_events e
            where e.order_id=o.id and (
              lower(e.event_type) like '%refund%'
              or lower(e.event_type) like '%chargeback%'
              or lower(e.event_type) like '%dispute%'
            )
          )
        )
    ) then
      raise exception 'Item payout ditahan atau tidak lagi memenuhi syarat. Periksa status pembayaran, pengiriman, masa tahan, refund, dan sengketa.';
    end if;
    if not exists (
      select 1 from storage.objects so
      where so.bucket_id='marketplace-payout-evidence'
        and so.name=trim(p_evidence_path)
    ) then
      raise exception 'File bukti transfer belum ditemukan di bucket privat.';
    end if;
    update public.marketplace_payout_ledger
    set status='submitted',provider='manual_bank_transfer',
        transfer_reference=left(trim(p_transfer_reference),160),
        transfer_evidence_path=left(trim(p_evidence_path),500),
        submitted_by=v_admin,notes=left(trim(p_note),1000),updated_at=now()
    where id=p_payout_id;
  elsif p_action='mark_paid' then
    if v_payout.status <> 'submitted' then
      raise exception 'Status harus submitted sebelum dikonfirmasi paid.';
    end if;
    if nullif(trim(v_payout.transfer_reference),'') is null
       or nullif(trim(v_payout.transfer_evidence_path),'') is null
       or nullif(trim(p_note),'') is null then
      raise exception 'Referensi, bukti transfer, dan konfirmasi tertulis wajib tersedia.';
    end if;
    update public.marketplace_payout_ledger
    set status='paid',paid_by=v_admin,completed_at=now(),
        notes=left(trim(p_note),1000),updated_at=now()
    where id=p_payout_id;
  elsif p_action='mark_failed' then
    if v_payout.status not in ('pending','submitted') then
      raise exception 'Pencairan hanya dapat dinyatakan gagal dari pending atau submitted.';
    end if;
    if nullif(trim(p_note),'') is null then
      raise exception 'Alasan kegagalan wajib diisi.';
    end if;
    update public.marketplace_payout_ledger
    set status='failed',failed_by=v_admin,notes=left(trim(p_note),1000),updated_at=now()
    where id=p_payout_id;
  else
    raise exception 'Aksi pencairan tidak dikenal.';
  end if;

  return jsonb_build_object('ok',true,'payout_id',p_payout_id,'status',
    (select status from public.marketplace_payout_ledger where id=p_payout_id));
end;
$function$;

create or replace function public.platform_owner_update_seller_payout(
  p_payout_id uuid,
  p_action text,
  p_transfer_reference text default null,
  p_evidence_path text default null,
  p_note text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.platform_owner_update_seller_payout(
    p_payout_id,p_action,p_transfer_reference,p_evidence_path,p_note
  );
$function$;

create or replace function private.platform_owner_set_seller_payout_hold(
  p_order_item_id uuid,
  p_hold boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (
    select 1 from public.platform_admins a
    where a.user_id=v_admin and a.active=true and a.role='platform_owner'
  ) then raise exception 'Hanya Platform Owner aktif yang dapat mengubah penahanan item.'; end if;
  if p_order_item_id is null or p_hold is null then raise exception 'Rincian penahanan tidak valid.'; end if;
  if p_hold and nullif(trim(p_reason),'') is null then raise exception 'Alasan penahanan wajib diisi.'; end if;
  if exists (select 1 from public.marketplace_payout_items pi
    join public.marketplace_payout_ledger pl on pl.id=pi.payout_id
    where pi.order_item_id=p_order_item_id and pl.status in ('submitted','paid')) then
    raise exception 'Item yang sudah dikirim untuk transfer atau dibayar tidak dapat diubah status penahanannya.';
  end if;
  update public.marketplace_order_items
  set payout_hold=p_hold,
      payout_hold_reason=case when p_hold then left(trim(p_reason),1000) else null end,
      payout_hold_set_by=case when p_hold then v_admin else null end,
      payout_hold_set_at=case when p_hold then now() else null end
  where id=p_order_item_id;
  if not found then raise exception 'Item pesanan tidak ditemukan.'; end if;
  return jsonb_build_object('ok',true,'order_item_id',p_order_item_id,'payout_hold',p_hold);
end;
$function$;

create or replace function public.platform_owner_set_seller_payout_hold(
  p_order_item_id uuid,p_hold boolean,p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.platform_owner_set_seller_payout_hold(p_order_item_id,p_hold,p_reason);
$function$;

revoke all on function private.request_seller_marketplace_payout(uuid) from public, anon;
revoke all on function public.request_seller_marketplace_payout(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.request_seller_marketplace_payout(uuid) to authenticated;
grant execute on function public.request_seller_marketplace_payout(uuid) to authenticated;

revoke all on function private.platform_owner_update_seller_payout(uuid,text,text,text,text) from public, anon;
revoke all on function public.platform_owner_update_seller_payout(uuid,text,text,text,text) from public, anon;
grant execute on function private.platform_owner_update_seller_payout(uuid,text,text,text,text) to authenticated;
grant execute on function public.platform_owner_update_seller_payout(uuid,text,text,text,text) to authenticated;

revoke all on function private.platform_owner_set_seller_payout_hold(uuid,boolean,text) from public, anon;
revoke all on function public.platform_owner_set_seller_payout_hold(uuid,boolean,text) from public, anon;
grant execute on function private.platform_owner_set_seller_payout_hold(uuid,boolean,text) to authenticated;
grant execute on function public.platform_owner_set_seller_payout_hold(uuid,boolean,text) to authenticated;

