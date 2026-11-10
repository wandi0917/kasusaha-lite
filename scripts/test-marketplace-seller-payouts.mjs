import fs from "node:fs";
import assert from "node:assert/strict";

const migration = fs.readFileSync("supabase/migrations/20261110120000_manual_seller_marketplace_payouts.sql", "utf8");
const edge = fs.readFileSync("supabase/functions/seller-marketplace-payouts/index.ts", "utf8");
const webhook = fs.readFileSync("supabase/functions/biteship-webhook/index.ts", "utf8");
const docs = fs.readFileSync("docs/marketplace-manual-seller-payouts.md", "utf8");

const checks = [
  [migration.includes("unique references public.marketplace_order_items(id)"), "each order item can be allocated to only one payout"],
  [migration.includes("interval '7 days'"), "seller payout hold is 7x24h from validated delivered time"],
  [migration.includes("o.payment_review_required = false"), "payment review blocks payout"],
  [migration.includes("e.verification_status = 'verified'") && migration.includes("e.processed_at is not null"), "payout requires processed verified Midtrans event"],
  [migration.includes("round(oi.item_subtotal * 0.025, 2)"), "commission is 2.5 percent of item subtotal"],
  [migration.includes("o.shipping_status = 'delivered'"), "Biteship delivered status is required"],
  [migration.includes("lower(e.event_type) like '%refund%'") && migration.includes("lower(e.event_type) like '%chargeback%'") && migration.includes("lower(e.event_type) like '%dispute%'"), "refund, chargeback and dispute events hold payout"],
  [migration.includes("payout_hold = false"), "manual payout hold blocks eligibility"],
  [migration.includes("for update") && migration.includes("pg_advisory_xact_lock"), "payout status updates and seller requests are serialized"],
  [migration.includes("status='paid'") && migration.includes("v_payout.status <> 'submitted'"), "paid can only follow submitted"],
  [migration.includes("revoke all on function private.platform_owner_update_seller_payout") && migration.includes("role='platform_owner'"), "admin transition is restricted to active Platform Owner"],
  [migration.includes("marketplace-payout-evidence") && migration.includes("public = false"), "transfer evidence bucket is private"],
  [edge.includes('authData.user?.email_confirmed_at') && edge.includes("platform_admins"), "edge endpoint verifies user and Platform Owner"],
  [edge.includes('eq("recipient_user_id", userId)'), "seller statement is scoped to the authenticated seller"],
  [edge.includes('createSignedUploadUrl') && edge.includes('createSignedUrl'), "evidence access uses short-lived signed URLs"],
  [webhook.includes("shipping_delivered_at") && webhook.includes("currentOrder.shipping_delivered_at"), "delivered timestamp comes from signed webhook receipt"],
  [docs.includes("tidak mengubah data pesanan atau uang") && docs.includes("BELUM boleh dijalankan"), "production rollout is explicitly blocked pending migration reconciliation"],
];
for (const [condition, message] of checks) {
  assert.ok(condition, message);
  console.log("PASS:", message);
}
