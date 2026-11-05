# Midtrans Production cutover checklist — KasUsaha Lite

This checklist is intentionally separate from merchant approval. Do not enable Production payments while the Midtrans dashboard still shows **Business review: In progress**.

## Before approval

- Keep `MIDTRANS_IS_PRODUCTION=false`.
- Keep Sandbox and Production Server Keys in Supabase Edge Function secrets only.
- Keep `MIDTRANS_PRODUCTION_PAYMENTS_ENABLED` unset or set to `false`.
- Keep the Midtrans notification URL pointed at:
  `https://flvdudmdltjjdjkdngbv.supabase.co/functions/v1/midtrans-webhook`
- Do not use the retired `midtrans-payment-notification` endpoint.
- Do not run a real-money payment test.

## After Midtrans approves the business

1. Confirm the Midtrans dashboard Result is approved and the required Production payment channels are active.
2. Add the Production Server Key to Supabase as `MIDTRANS_SERVER_KEY_PRODUCTION`. Never paste it into chat, GitHub, or frontend code.
3. Confirm the Production Client Key is configured only where the frontend integration actually requires it; never expose the Server Key.
4. Set `MIDTRANS_PRODUCTION_PAYMENTS_ENABLED=true` in Supabase Edge Function secrets.
5. Set `MIDTRANS_IS_PRODUCTION=true` only after the Production key and webhook URL are verified.
6. Confirm `midtrans-webhook` remains deployed with JWT gateway verification disabled, while its own Midtrans signature and Status API checks remain mandatory.
7. Verify Midtrans can reach the webhook and receives HTTP 200 for a valid notification. Invalid signatures and amount mismatches must not mark orders paid.
8. With explicit operator approval, run one minimum-value real payment only after all payment channels are active. Confirm order state, payment event, license eligibility, commission ledger, and refund/reversal path before inviting customers.

## Fail-closed behavior

The three payment entry points — marketplace/package checkout, Midtrans webhook processing, and Employee-ID activation — now require `MIDTRANS_PRODUCTION_PAYMENTS_ENABLED=true` whenever `MIDTRANS_IS_PRODUCTION=true`. If the flag is absent, they return HTTP 503 with `PRODUCTION_PAYMENTS_NOT_ENABLED`. Sandbox behavior is unchanged.

Do not enable this flag while the merchant review is pending.
