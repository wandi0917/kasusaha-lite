# QA checklist — Midtrans, license referral, refunds

This branch is a **draft candidate only**. Do not deploy to production until the cases below pass against a disposable/staging Supabase project and Midtrans Sandbox.

## Package checkout and referral RPC

- [ ] Customer-facing referral input remains disabled with a clear explanation until partner onboarding, approval, and management are ready; direct RPC tests must not be mistaken for a launched referral program.
- [ ] Authenticated buyer can create a package order using the four-argument legacy RPC.
- [ ] Authenticated buyer can create a package order using the five-argument RPC with an active referral code; exactly one referral row is captured for that order.
- [ ] Empty referral code creates a normal order without a referral row.
- [ ] Invalid, inactive, unknown, and self-owned referral codes are rejected before an order remains committed.
- [ ] Referral insert failure rolls back the package order; no orphan pending order remains.
- [ ] Browser-supplied price is ignored; the active license-plan price remains the server-side source of truth.
- [ ] Anonymous sessions cannot create package orders through either RPC signature.
- [ ] Authenticated users cannot execute the five-argument RPC through PUBLIC/anon grants.
- [ ] A buyer with an existing permanent attribution cannot overwrite it by entering a different referral code on a later order.
- [ ] Concurrent package checkouts for one buyer serialize first-touch referral capture and preserve one permanent attribution.
- [ ] The existing migration `20261105170000_license_package_checkout_referral_capture.sql` is applied once; no later duplicate migration may replace its stronger first-touch safeguards.

## Payment timestamp and webhook

- [ ] Valid settlement: order becomes paid only after signature/Status API, amount, currency, order ID, and transaction ID match.
- [ ] `paid_at` equals Midtrans `settlement_time` (or `transaction_time` fallback) interpreted as GMT+7, not webhook receipt time.
- [ ] Empty or whitespace-only `settlement_time` falls back to a valid `transaction_time`; malformed/missing timestamps remain retryable and do not mark an order paid.
- [ ] `updated_at` records webhook processing time and is not backdated to the provider payment timestamp.
- [ ] Missing/malformed provider timestamp: webhook returns retryable 5xx and does not mark the order paid.
- [ ] Valid card capture with `fraud_status=accept` is accepted; capture without accept is not.
- [ ] Duplicate settlement notification does not duplicate event, commission, license, or shipment.
- [ ] Delayed pending notification after settlement never downgrades a paid order.
- [ ] Invalid signature plus failed Status API validation never changes order state.

## License partner commissions

- [ ] First paid license order with active referral creates one 15% held commission.
- [ ] First-purchase commission uses the approved partner row's `first_purchase_rate`; renewal uses `renewal_rate` (currently constrained to 10%).
- [ ] Zero-rate or rounded-to-zero commission does not create a zero-value ledger row.
- [ ] Later paid license order creates one renewal held commission using the partner's configured renewal rate.
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

- [ ] Owner on Starter/no-`full_finance` plan receives sales-price-only transaction descriptions; cost price and gross profit are not persisted in the description.
- [ ] Owner with verified `full_finance` entitlement retains cost/gross-profit details; employee descriptions never include them.
- [ ] Physical marketplace order still records 2.5% commission from product subtotal only, excluding shipping.
- [ ] Physical order still validates Biteship quote and does not book duplicate shipments.
- [ ] License purchase still issues exactly one license after verified payment.
- [ ] Expire/cancel/deny/failure behavior remains idempotent.
- [ ] Owner, employee, and buyer access boundaries remain unchanged.
