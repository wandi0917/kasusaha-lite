-- Deterministic referral commission attribution.
-- Resolve the partner and first/repeat rate from the chronologically earliest
-- paid KasUsaha license order, never from webhook arrival order.
create or replace function public.record_license_partner_commission(
  p_order_id uuid,
  p_payment_event_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_order public.marketplace_orders%rowtype;
  v_first_order public.marketplace_orders%rowtype;
  v_event public.marketplace_payment_events%rowtype;
  v_item_count integer;
  v_digital_count integer;
  v_base numeric;
  v_partner public.license_marketing_partners%rowtype;
  v_referral public.license_order_referrals%rowtype;
  v_rate numeric;
  v_type text;
  v_amount numeric;
  v_rows_inserted integer := 0;
  v_existing public.license_partner_commission_ledger%rowtype;
begin
  select * into v_order
  from public.marketplace_orders
  where id = p_order_id
  for update;

  if not found
     or v_order.status <> 'paid'
     or v_order.paid_at is null
     or v_order.payment_provider <> 'midtrans'
     or coalesce(v_order.payment_review_required, false) then
    return jsonb_build_object('success', false, 'reason', 'order_not_verified_paid');
  end if;

  select * into v_event
  from public.marketplace_payment_events
  where id = p_payment_event_id
    and order_id = p_order_id
    and provider = 'midtrans'
    and event_type in ('settlement', 'capture')
    and verification_status = 'verified';

  if not found then
    return jsonb_build_object('success', false, 'reason', 'payment_event_not_verified');
  end if;

  select count(*),
         count(*) filter (where product_id in (7, 8, 9, 10)),
         coalesce(sum(item_subtotal) filter (where product_id in (7, 8, 9, 10)), 0)
    into v_item_count, v_digital_count, v_base
  from public.marketplace_order_items
  where order_id = p_order_id;

  if v_item_count = 0 or v_digital_count = 0 then
    return jsonb_build_object('success', true, 'commission_created', false, 'reason', 'not_license_order');
  end if;

  if v_item_count <> v_digital_count or v_base <= 0 then
    return jsonb_build_object('success', false, 'reason', 'mixed_or_invalid_license_order');
  end if;

  -- Serialize all commission calculations for the same buyer.
  perform pg_advisory_xact_lock(hashtextextended(v_order.buyer_id::text, 0));

  select * into v_existing
  from public.license_partner_commission_ledger
  where order_id = p_order_id
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'commission_created', false,
      'already_recorded', true,
      'ledger_id', v_existing.id,
      'commission_type', v_existing.commission_type,
      'commission_rate', v_existing.commission_rate,
      'amount', v_existing.amount,
      'status', v_existing.status
    );
  end if;

  -- The first purchase is based on the payment timestamp persisted on orders.
  -- Stable tie-breakers make equal timestamps deterministic.
  select o.* into v_first_order
  from public.marketplace_orders o
  where o.buyer_id = v_order.buyer_id
    and o.status = 'paid'
    and o.paid_at is not null
    and exists (
      select 1
      from public.marketplace_order_items i
      where i.order_id = o.id
        and i.product_id in (7, 8, 9, 10)
    )
  order by o.paid_at asc, o.created_at asc, o.id asc
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'first_paid_license_order_not_found');
  end if;

  -- Referral must belong to the chronologically first paid license order.
  -- A referral on a later purchase cannot retroactively replace attribution.
  select * into v_referral
  from public.license_order_referrals
  where order_id = v_first_order.id
    and buyer_id = v_order.buyer_id;

  if not found then
    return jsonb_build_object('success', true, 'commission_created', false, 'reason', 'first_paid_order_has_no_referral');
  end if;

  select * into v_partner
  from public.license_marketing_partners
  where id = v_referral.partner_id
    and referral_code = v_referral.referral_code
    and status = 'active'
    and user_id <> v_order.buyer_id;

  if not found then
    return jsonb_build_object('success', true, 'commission_created', false, 'reason', 'first_order_referral_partner_inactive_or_self_referral');
  end if;

  -- Reconcile attribution to the earliest paid order so a delayed webhook
  -- cannot permanently assign a later order's referral.
  insert into public.license_customer_attributions
    (customer_id, partner_id, first_order_id, attributed_at)
  values
    (v_order.buyer_id, v_partner.id, v_first_order.id, v_first_order.paid_at)
  on conflict (customer_id) do update
    set partner_id = excluded.partner_id,
        first_order_id = excluded.first_order_id,
        attributed_at = excluded.attributed_at;

  if v_order.id = v_first_order.id then
    v_rate := 0.1500;
    v_type := 'first_purchase';
  else
    v_rate := 0.1000;
    v_type := 'renewal';
  end if;

  v_amount := round(v_base * v_rate, 0);
  if v_amount <= 0 then
    return jsonb_build_object('success', true, 'commission_created', false, 'reason', 'commission_zero');
  end if;

  insert into public.license_partner_commission_ledger
    (partner_id, customer_id, order_id, payment_event_id, commission_type,
     commission_rate, calculation_base, amount, status, idempotency_key, notes)
  values
    (v_partner.id, v_order.buyer_id, p_order_id, p_payment_event_id, v_type,
     v_rate, v_base, v_amount, 'held',
     'license-partner:' || p_order_id::text,
     case when v_type = 'first_purchase'
       then 'Komisi pembelian lisensi pertama 15%; dihitung dari paid_at paling awal dan menunggu persetujuan admin.'
       else 'Komisi pembelian ulang lisensi 10%; atribusi mitra mengikuti paid_at pertama dan menunggu persetujuan admin.'
     end)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rows_inserted = row_count;

  select * into v_existing
  from public.license_partner_commission_ledger
  where idempotency_key = 'license-partner:' || p_order_id::text;

  return jsonb_build_object(
    'success', true,
    'commission_created', v_rows_inserted = 1,
    'ledger_id', v_existing.id,
    'commission_type', v_existing.commission_type,
    'commission_rate', v_existing.commission_rate,
    'amount', v_existing.amount,
    'status', v_existing.status,
    'first_paid_order_id', v_first_order.id
  );
end;
$function$;

revoke all on function public.record_license_partner_commission(uuid, uuid) from public;
revoke all on function public.record_license_partner_commission(uuid, uuid) from anon;
revoke all on function public.record_license_partner_commission(uuid, uuid) from authenticated;
grant execute on function public.record_license_partner_commission(uuid, uuid) to service_role;
