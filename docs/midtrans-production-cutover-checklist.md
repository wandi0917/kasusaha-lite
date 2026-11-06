# Midtrans Production cutover checklist — KasUsaha Lite

This checklist is intentionally separate from merchant approval. Do not enable Production payments while the Midtrans dashboard still shows **Business review: In progress**.

## Before approval

- Keep `MIDTRANS_IS_PRODUCTION=false`.
- Keep Sandbox and Production Server Keys in Supabase Edge Function secrets only.
- Keep `MIDTRANS_PRODUCTION_PAYMENTS_ENABLED` unset or set to `false`.
- Keep `MARKETPLACE_PRODUCTION_PAYMENTS_ENABLED` unset or set to `false`; physical marketplace checkout has a separate production gate.
- Keep `BITESHIP_ENABLE_SHIPMENT_BOOKING` disabled until the sandbox order and webhook lifecycle is tested.
- Keep `BITESHIP_PRODUCTION_BOOKING_ENABLED` unset or set to `false`; live Biteship API keys require this additional server-side approval.
- Keep the Midtrans notification URL pointed at:
  `https://flvdudmdltjjdjkdngbv.supabase.co/functions/v1/midtrans-webhook`
- Do not use the retired `midtrans-payment-notification` endpoint.
- Do not run a real-money payment test.

## After Midtrans approves the business

1. Confirm the Midtrans dashboard Result is approved and the required Production payment channels are active.
2. Add the Production Server Key to Supabase as `MIDTRANS_SERVER_KEY_PRODUCTION`. Never paste it into chat, GitHub, or frontend code.
3. Confirm the Production Client Key is configured only where the frontend integration actually requires it; never expose the Server Key.
4. Complete Sandbox end-to-end tests first: create checkout, pay, receive notification, verify Status API identity and amount, activate one test license, test duplicate notifications, expiry, and refund/chargeback review. Do not use Production credentials for this test.
5. Set `MIDTRANS_PRODUCTION_PAYMENTS_ENABLED=true` in Supabase Edge Function secrets only after the merchant and payment channels are approved.
6. Set `MIDTRANS_IS_PRODUCTION=true` only after the Production key and webhook URL are verified.
7. Confirm `midtrans-webhook` remains deployed with JWT gateway verification disabled, while its own Midtrans signature and Status API checks remain mandatory. The webhook must continue processing verified notifications/refunds even when new-payment creation is disabled, so in-flight transactions are not stranded.
8. Verify Midtrans can reach the webhook and receives HTTP 200 for a valid notification. Invalid signatures, missing/mismatched transaction IDs, and amount mismatches must not mark orders paid.
9. Keep `MARKETPLACE_PRODUCTION_PAYMENTS_ENABLED` disabled until seller payout recording, order completion, Biteship booking, tracking, and refund review have passed end-to-end tests. Only then enable it separately.
10. For Biteship Sandbox, use an API key beginning `biteship_test.` and enable `BITESHIP_ENABLE_SHIPMENT_BOOKING` only for sandbox tests. Biteship uses the same API endpoint for test and live keys; the key prefix determines the environment.
11. For live shipments, use a `biteship_live.` key and require both `BITESHIP_ENABLE_SHIPMENT_BOOKING=true` and `BITESHIP_PRODUCTION_BOOKING_ENABLED=true`. Do not set the live flag until Biteship activation, seller payout, and tracking tests are complete.
12. With explicit operator approval, run one minimum-value real license payment only after all payment channels are active. Confirm order state, payment event, license eligibility, duplicate-notification idempotency, and refund/reversal review before inviting customers.

## Fail-closed behavior

- New package/license and Employee-ID payment creation require `MIDTRANS_PRODUCTION_PAYMENTS_ENABLED=true` whenever `MIDTRANS_IS_PRODUCTION=true`. If absent, they return HTTP 503 with `PRODUCTION_PAYMENTS_DISABLED`.
- New physical marketplace payment creation additionally requires `MARKETPLACE_PRODUCTION_PAYMENTS_ENABLED=true`. If absent, it returns HTTP 503 with `MARKETPLACE_PRODUCTION_PAYMENTS_DISABLED`.
- Biteship order creation with a `biteship_live.` key additionally requires `BITESHIP_PRODUCTION_BOOKING_ENABLED=true`. A `biteship_test.` key may be used for sandbox order simulation when `BITESHIP_ENABLE_SHIPMENT_BOOKING=true`.
- Sandbox checkout is unaffected by either Production flag.
- `midtrans-webhook` does **not** use the new-payment gate. It must continue to verify and process authentic provider notifications, including refund/chargeback review, for transactions already in flight.
- Do not enable either flag while merchant approval, seller payouts, Biteship booking, or the relevant end-to-end tests are pending.
