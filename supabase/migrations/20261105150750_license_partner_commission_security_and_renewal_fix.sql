-- Safe license partner commission recording after verified Midtrans payment.
-- Marketplace platform commission remains separate and unchanged.
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
  v_event public.marketplace_payment_events%rowtype;
  v_item_count integer;
  v_digital_count integer;
  v_base numeric;
  v_partner public.license_marketing_partners%rowtype;
  v_attribution public.license_customer_attributions%rowtype;
  v_referral public.license_order_referrals%rowtype;
  v_rate numeric;
  v_type text;
  v_amount numeric;
  v_has_prior_license_purchase boolean := false;
  v_existing public.license_partner_commission_ledger%rowtype;
begin
  select * into v_order
  from public.marketplace_orders
  where id = p_order_id
  for update;

  if not found or v_order.status <> 'paid' or v_order.paid_at is null
     or v_order.payment_review_required then
    return jsonb_build_object('success', false, 'reason', 'order_not_verified_paid');
  end if;

  select * into v_event
  from public.marketplace_payment_events
  where id = p_payment_event_id
    and order_id = p_order_id
    and provider = 'midtrans'
    and verification_status = 'verified';

  if not found then
    return jsonb_build_object('success', false, 'reason', 'payment_event_not_verified');
  end if;

  select count(*), count(*) filter (where product_id in (7,8,9,10)),
         coalesce(sum(item_subtotal) filter (where product_id in (7,8,9,10)), 0)
    into v_item_count, v_digital_count, v_base
  from public.marketplace_order_items
  where order_id = p_order_id;

  if v_item_count = 0 or v_digital_count = 0 then
    return jsonb_build_object('success', true, 'commission_created', false, 'reason', 'not_license_order');
  end if;

  if v_item_count <> v_digital_count or v_base <= 0 then
    return jsonb_build_object('success', false, 'reason', 'mixed_or_invalid_license_order');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_order.buyer_id::text, 0));

  select * into v_existing
  from public.license_partner_commission_ledger
  where order_id = p_order_id
  limit 1;

  if found then
    return jsonb_build_object('success', true, 'commission_created', false,
      'already_recorded', true, 'ledger_id', v_existing.id);
  end if;

  select * into v_attribution
  from public.license_customer_attributions
  where customer_id = v_order.buyer_id
  for update;

  if found then
    select * into v_partner
    from public.license_marketing_partners
    where id = v_attribution.partner_id
      and status = 'active';
    if not found then
      return jsonb_build_object('success', true, 'commission_created', false,
        'reason', 'attributed_partner_not_active');
    end if;
    v_rate := 0.1000;
    v_type := 'renewal';
  else
    select exists (
      select 1
      from public.marketplace_orders prior_order
      join public.marketplace_order_items prior_item on prior_item.order_id = prior_order.id
      where prior_order.buyer_id = v_order.buyer_id
        and prior_order.status = 'paid'
        and prior_order.paid_at is not null
        and prior_order.id <> p_order_id
        and prior_item.product_id in (7,8,9,10)
    ) into v_has_prior_license_purchase;

    select * into v_referral
    from public.license_order_referrals
    where order_id = p_order_id
      and buyer_id = v_order.buyer_id;

    if not found then
      return jsonb_build_object('success', true, 'commission_created', false,
        'reason', 'no_referral');
    end if;

    select * into v_partner
    from public.license_marketing_partners
    where id = v_referral.partner_id
      and referral_code = v_referral.referral_code
      and status = 'active'
      and user_id <> v_order.buyer_id;

    if not found then
      return jsonb_build_object('success', true, 'commission_created', false,
        'reason', 'partner_inactive_or_self_referral');
    end if;

    -- 15% hanya untuk pelanggan yang belum pernah membeli lisensi.
    -- Jika referral baru muncul pada pembelian berikutnya, perlakukan sebagai renewal 10%.
    if v_has_prior_license_purchase then
      v_rate := 0.1000;
      v_type := 'renewal';
    else
      -- Achievement tiers remain disabled until their thresholds are formally defined.
      v_rate := 0.1500;
      v_type := 'first_purchase';
    end if;

    insert into public.license_customer_attributions
      (customer_id, partner_id, first_order_id, attributed_at)
    values
      (v_order.buyer_id, v_partner.id, p_order_id, now())
    on conflict (customer_id) do nothing;

    select * into v_attribution
    from public.license_customer_attributions
    where customer_id = v_order.buyer_id
    for update;

    if v_attribution.partner_id <> v_partner.id then
      -- Another first-paid order won the attribution race; retain original partner.
      select * into v_partner
      from public.license_marketing_partners
      where id = v_attribution.partner_id
        and status = 'active';
      if not found then
        return jsonb_build_object('success', true, 'commission_created', false,
          'reason', 'original_partner_not_active');
      end if;
      v_rate := 0.1000;
      v_type := 'renewal';
    end if;
  end if;

  v_amount := round(v_base * v_rate, 0);
  if v_amount <= 0 then
    return jsonb_build_object('success', true, 'commission_created', false,
      'reason', 'commission_zero');
  end if;

  insert into public.license_partner_commission_ledger
    (partner_id, customer_id, order_id, payment_event_id, commission_type,
     commission_rate, calculation_base, amount, status, idempotency_key, notes)
  values
    (v_partner.id, v_order.buyer_id, p_order_id, p_payment_event_id, v_type,
     v_rate, v_base, v_amount, 'held',
     'license-partner:' || p_order_id::text,
     case when v_type = 'first_purchase'
       then 'Komisi pembelian lisensi pertama 15%; menunggu persetujuan admin.'
       else 'Komisi pembelian ulang/perpanjangan lisensi 10%; menunggu persetujuan admin.'
     end)
  on conflict (idempotency_key) do nothing;

  select * into v_existing
  from public.license_partner_commission_ledger
  where idempotency_key = 'license-partner:' || p_order_id::text;

  return jsonb_build_object('success', true, 'commission_created', found,
    'ledger_id', v_existing.id, 'commission_type', v_existing.commission_type,
    'commission_rate', v_existing.commission_rate, 'amount', v_existing.amount,
    'status', v_existing.status);
end;
$function$;

revoke all on function public.record_license_partner_commission(uuid, uuid) from public;
revoke all on function public.record_license_partner_commission(uuid, uuid) from anon;
revoke all on function public.record_license_partner_commission(uuid, uuid) from authenticated;
grant execute on function public.record_license_partner_commission(uuid, uuid) to service_role;
