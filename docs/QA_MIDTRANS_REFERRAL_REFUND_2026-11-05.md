# QA checklist — Midtrans, license referral, refunds

This branch is a **draft candidate only**. Do not deploy to production until the cases below pass against a disposable/staging Supabase project and Midtrans Sandbox.

## Package checkout and referral RPC

- [ ] Authenticated buyer can create a package order using the four-argument legacy RPC.
- [ ] Authenticated buyer can create a package order using the five-argument RPC with an active referral code; exactly one referral row is captured for that order.
- [ ] Empty referral code creates a normal order without a referral row.
- [ ] Invalid, inactive, unknown, and self-owned referral codes are rejected before an order remains committed.
- [ ] Referral insert failure rolls back the package order; no orphan pending order remains.
- [ ] Browser-supplied price is ignored; the active license-plan price remains the server-side source of truth.
- [ ] Anonymous sessions cannot create package orders through either RPC signature.
- [ ] Authenticated users cannot execute the five-argument RPC through PUBLIC/anon grants.

## Payment timestamp and webhook

- [ ] Valid settlement: order becomes paid only after signature/Status API, amount, currency, order ID, and transaction ID match.
- [ ] `paid_at` equals Midtrans `settlement_time` (or `transaction_time` fallback) interpreted as GMT+7, not webhook receipt time.
- [ ] Missing/malformed provider timestamp: webhook returns retryable 5xx and does not mark the order paid.
- [ ] Valid card capture with `fraud_status=accept` is accepted; capture without accept is not.
- [ ] Duplicate settlement notification does not duplicate event, commission, license, or shipment.
- [ ] Delayed pending notification after settlement never downgrades a paid order.
- [ ] Invalid signature plus failed Status API validation never changes order state.

## License partner commissions

- [ ] First paid license order with active referral creates one 15% held commission.
- [ ] Later paid license order creates one 10% held commission.
- [ ] A later order webhook arriving first, followed by an earlier provider-paid order, recalculates unpaid/approved rows to correct first/renewal rates and partner.
- [ ] Existing approved rows affected by recalculation return to held; no payout is triggered.
- [ ] A commission already marked paid is never changed financially; it receives a manual-review note if attribution changes.
- [ ] First paid license order without referral prevents later referral from claiming the customer.
- [ ] Orders marked `payment_review_required=true` are excluded from first-purchase and renewal attribution.
- [ ] Paid orders backed only by manual CSV evidence (`verification_status=received`) are excluded from referral attribution and commission calculations.
- [ ] Invalid, inactive, or self-referral code cannot create a commission.
- [ ] Concurrent and repeated webhook delivery is idempotent.
- [ ] Non-license marketplace orders return success without creating license-partner ledger rows.

## Refunds and chargebacks

- [ ] `refund`, `partial_refund`, `chargeback`, and `partial_chargeback` set `payment_review_required`.
- [ ] Approved but unpaid license-partner commissions are moved back to held.
- [ ] Midtrans refund notification with and without `bank_confirmed_at` produces distinct event fingerprints.
- [ ] Existing paid commissions are not clawed back automatically; admin review is required.
- [ ] License is not revoked automatically on partial refund; review flow must decide access.
- [ ] Platform finance excludes the order from available commission while `payment_review_required=true`.

## Regression

- [ ] Physical marketplace order still records 2.5% commission from product subtotal only, excluding shipping.
- [ ] Physical order still validates Biteship quote and does not book duplicate shipments.
- [ ] License purchase still issues exactly one license after verified payment.
- [ ] Expire/cancel/deny/failure behavior remains idempotent.
- [ ] Owner, employee, and buyer access boundaries remain unchanged.
