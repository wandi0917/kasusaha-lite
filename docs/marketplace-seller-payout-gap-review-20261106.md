# Audit gap pencairan dana seller marketplace — 6 November 2026

Project Supabase Production: `flvdudmdltjjdjkdngbv`  
Repository: `wandi0917/kasusaha-lite`  
Scope: read-only schema/source review. No seller, payment, payout, or bank data was changed.

## Executive finding

Marketplace checkout, Midtrans payment verification, Biteship shipping gates, and the 2.5% platform commission calculation exist. A complete seller payout workflow does not yet exist. Physical marketplace Production payments must remain disabled until this gap is closed and tested.

## Verified live schema

### `marketplace_order_items`
- Has `order_id`, `seller_id`, `product_id`, item snapshot, `unit_price`, `quantity`, and `item_subtotal`.
- `seller_id` references `auth.users(id)`.
- The buyer/seller read policy limits each seller to their own item rows and buyers to their own order.

### `marketplace_commission_ledger`
- One row references an `order_item_id`, entry type, commission rate, calculation base, amount, unique idempotency key, and verified payment-event reference.
- It records platform commission, not seller payable balance.
- It does not store a seller ID or payout status. Seller identity can be derived through `marketplace_order_items.seller_id`.
- It has no direct `anon` or `authenticated` table access.

### `marketplace_payout_ledger`
- Supports recipient types `seller` and `platform_owner`, positive IDR amounts, statuses `pending`, `submitted`, `paid`, `failed`, `reversed`, and `cancelled`, provider/reference fields, idempotency key, timestamps, and notes.
- It has no order/item/commission detail relation, no approval actor, no transfer evidence field, and no seller payout profile relation.
- It has no direct `anon` or `authenticated` table access.

### Existing finance Edge Function
- `platform-marketplace-finance` is GET-only.
- It authorizes an active `platform_owner` in `platform_admins`.
- It selects payout rows only where `recipient_type = 'platform_owner'`.
- It does not provide a seller payout request, approval, transfer, or completion endpoint.

Production currently has zero marketplace orders, order items, commission rows, and payout rows. No real seller payout has therefore been exercised.

## Required design before seller payout is enabled

1. Add a payout-batch detail relation (for example, `marketplace_payout_items`) linking each payout batch to exact order items and commission ledger entries. Enforce unique linkage so an order item cannot be paid twice.
2. Build seller payable from server-owned records only. At minimum, reconcile the paid item subtotal against the platform commission and any explicit refund/reversal adjustments. Shipping must remain outside the 2.5% commission base and must not be silently added to seller proceeds.
3. Require the exact order to be paid, the matching Midtrans event to be verified and processed, the seller to match the item owner, and `payment_review_required = false`.
4. Define a release policy (for example, delivered plus a stated return/dispute hold period) before implementation. Do not infer a policy from a technical status alone.
5. Create batches atomically under row locks; enforce idempotency at batch and item level; prevent overlapping pending/submitted batches.
6. Use a controlled status transition model: pending → submitted → paid, with failed/cancelled/reversed handling and a documented retry path. A failed transfer must not lose the seller's entitlement or create a duplicate transfer.
7. Require two-person or maker/checker approval for manual transfers where practical. A request must never mark itself paid.
8. Store transfer reference and immutable evidence. Keep evidence in a private bucket with narrow access; never expose full bank account numbers in ordinary logs or UI.
9. Keep seller bank destination separate from public profile. Prefer a provider-managed recipient token; if account details must be stored, use an explicitly reviewed protected/encrypted design and strict access controls.
10. Add a seller-facing read-only statement and platform-owner reconciliation report, both derived from the same ledger rows.

## Recommended financial rule (not yet implemented)

For a physical product item:
- Platform fee = rounded 2.5% × item subtotal.
- Seller gross entitlement = item subtotal − platform fee.
- Shipping is excluded from the platform fee base and is reconciled separately.
- Refunds, chargebacks, partial refunds, and disputes hold the affected item until manually resolved; no automatic clawback or payout reversal without a matching audited adjustment.

Rounding, seller release timing, minimum payout threshold, bank-transfer fees, and who bears transfer fees must be formally fixed before enabling seller payout.

## Safe rollout sequence

1. Reconcile the Supabase migration baseline first. The current repository migration history is incomplete; do not run `db push`, reset, or guessed SQL.
2. Add additive schema only after the migration baseline is safely reconciled.
3. Implement server-side RPC/Edge Functions with explicit platform-owner authorization and service-role isolation.
4. Test on an isolated/staging database with synthetic users, orders, refunds, duplicate requests, concurrent payout attempts, failed transfers, and retries.
5. Verify every payout batch against the commission ledger and order items.
6. Keep physical marketplace Production payment gate disabled until all tests and merchant/shipping activation checks pass.

## Changes made by this audit

- No production schema or data changes.
- No payout was created and no money was transferred.
- This document is a verified gap assessment and design requirement, not an enabled payout feature.
