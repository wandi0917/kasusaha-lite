# QA checklist — Midtrans, license referral, refunds

This branch is a **draft candidate only**. Do not deploy to production until the cases below pass against a disposable/staging Supabase project and Midtrans Sandbox.

## Release gates — must be completed before public launch

- [ ] Reconcile the Supabase migration baseline first. The remote database has historical migration records whose SQL files are not present in this repository; do not run `supabase db push`, `db reset --remote`, or bulk migration repair until the missing history has been safely reconstructed and reviewed.
- [ ] Apply candidate database migrations to a disposable/staging database first, then compare the resulting schema, function definitions, grants, and RLS policies with production.
- [ ] Confirm the Midtrans merchant account has completed Production activation and at least one payment channel is actually enabled; a dashboard set to Production is not proof that checkout can collect payment.
- [ ] Configure separate secrets for each environment: `MIDTRANS_IS_PRODUCTION`, `MIDTRANS_SERVER_KEY_SANDBOX`, and `MIDTRANS_SERVER_KEY_PRODUCTION`. Production mode must fail closed when the Production key is missing; never point a live webhook at a Sandbox key.
- [ ] Keep `MIDTRANS_PRODUCTION_PAYMENTS_ENABLED` unset/false until merchant approval, active payment channels, Production key, webhook URL, and low-value smoke-test plan are confirmed. `create-midtrans-payment`, `midtrans-webhook`, and `employee-device-activation` must all fail closed with `PRODUCTION_PAYMENTS_NOT_ENABLED` until the explicit flag is true.
- [ ] Verify the exact Midtrans notification URL is `https://flvdudmdltjjdjkdngbv.supabase.co/functions/v1/midtrans-webhook` and test signature, Status API, amount, currency, order identity, duplicate notifications, and refund handling in Sandbox.
- [ ] Confirm the Biteship sender address, API key, webhook signature secret, courier services, and shipping booking flag. Keep automatic booking disabled until a real paid test order passes end-to-end.
- [ ] Enable Supabase Auth leaked-password protection in the Auth dashboard and review password policy before public customer onboarding.
- [ ] Run owner, employee, buyer, and anonymous-session tests using separate test accounts; verify package entitlements and ensure no test account can read another business's data.
- [ ] Verify backup/restore procedure and retain a known-good Cloudflare production deployment for rollback.
- [ ] Perform a final live smoke test with a low-value real payment only after merchant activation, secrets, migration baseline, and refund procedure are confirmed.


## Package entitlement truthfulness — current production snapshot

- [ ] Compare the customer-facing package feature matrix with `kasusaha_license_plans.features` after every package migration.
- [ ] Current production price snapshot: Starter Rp49.000, Lite Rp99.000, Business Rp149.000, Professional Rp249.000.
- [ ] Current production entitlement snapshot: Starter has cashier/basic stock/basic products/sales reports; Lite adds barcode, employee/attendance, marketplace, and full finance; Business adds advanced reports.
- [ ] Professional currently has the same entitlement flags as Business. Do not advertise a distinct Professional-only feature, priority support, SLA, or premium capability until the entitlement is implemented and tested.
- [ ] Renewal prices shown in the UI are informational only; renewal checkout is not available and there is no automatic renewal billing.
- [ ] Do not present the planned 0.1% fair-usage/service-fee preview as a charge. It remains informational and requires explicit Owner consent before any future billing.

## Migration baseline — production snapshot

- Production migration history currently contains 110 applied entries and ends at `20261106113750`.
- Production applied the fail-closed entitlement migrations as remote versions `20261106113748` and `20261106113750`; the repository records their exact remote versions in `supabase/migrations/20261106113748_...sql` and `20261106113750_...sql`.
- The package-referral capture migration and provider-paid-time commission reconciliation remain pending candidate work; do not apply them until a disposable/staging database and Midtrans Sandbox lifecycle tests pass. The old local version numbers `20261105170000` and `20261105180000` predate the latest remote migration and must be re-versioned before any future application.
- The repository does not contain the complete historical SQL baseline represented by the remote migration history. Never bulk-push, reset, or repair migration history until the baseline is reconstructed and reconciled.
- The two production-applied fail-closed migrations were dry-run in a transaction that was rolled back before application. The remaining candidate migrations were also dry-run previously; this is not a substitute for a disposable staging database.

## Current production boundary

- This PR is not merged. Its preview build does not change the production Pages branch.
- Candidate SQL migrations have only been dry-run in a rolled-back transaction; they have not been applied to production.
- Candidate Edge Function source has not been deployed to the production Supabase project.
- No real orders, payment events, licenses, or commission rows were created by this audit.

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
