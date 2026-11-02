-- Keep payment event records private while allowing each authenticated buyer
-- to read only their own license when its order has a verified payment event.
create or replace function private.kasusaha_license_order_payment_is_verified(
  p_order_id uuid,
  p_buyer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    (select auth.uid()) is not null
    and (select auth.uid()) = p_buyer_id
    and not coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false)
    and exists (
      select 1
      from public.marketplace_orders o
      join public.marketplace_payment_events e
        on e.order_id = o.id
       and e.provider = 'midtrans'
       and e.verification_status = 'verified'
       and e.processed_at is not null
      where o.id = p_order_id
        and o.buyer_id = p_buyer_id
        and o.status in ('paid', 'processing', 'completed')
        and o.paid_at is not null
        and o.payment_review_required is not true
    );
$function$;

revoke all on function private.kasusaha_license_order_payment_is_verified(uuid, uuid) from public, anon;
grant execute on function private.kasusaha_license_order_payment_is_verified(uuid, uuid) to authenticated;

drop policy if exists "Buyer can view own KasUsaha licenses" on public.kasusaha_licenses;
create policy "Buyer can view own KasUsaha licenses"
on public.kasusaha_licenses
for select
to authenticated
using (
  buyer_id = (select auth.uid())
  and private.kasusaha_license_order_payment_is_verified(order_id, buyer_id)
);
