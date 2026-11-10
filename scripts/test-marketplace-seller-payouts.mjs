import fs from "node:fs";
import assert from "node:assert/strict";

const migration = fs.readFileSync("supabase/migrations/20261110120000_manual_seller_marketplace_payouts.sql", "utf8");
const edge = fs.readFileSync("supabase/functions/seller-marketplace-payouts/index.ts", "utf8");
const webhook = fs.readFileSync("supabase/functions/biteship-webhook/index.ts", "utf8");
const docs = fs.readFileSync("docs/marketplace-manual-seller-payouts.md", "utf8");

const checks = [
  [migration.includes("unique references public.marketplace_order_items(id)"), "each order item can be allocated to only one payout"],
  [/update public\.marketplace_payout_ledger\s+set status='submitted'/.test(migration), "submitted transition uses valid UPDATE SQL"],
  [!/\n\) then\s+raise exception 'Lokasi bukti transfer/.test(migration), "migration contains no orphaned duplicate SQL fragment"],
  [migration.includes("and oi.package_code is null") && migration.includes("from public.kasusaha_license_plans lp"), "all configured license packages are excluded from seller payouts"],
  [migration.includes("where so.bucket_id='marketplace-payout-evidence'") && migration.includes("and so.name=trim(p_evidence_path)"), "submitted payout requires an uploaded private evidence object"],
  [(migration.match(/seller_marketplace_payout_batch_is_eligible\(p_payout_id\)/g) || []).length >= 2, "eligibility is revalidated before transfer and before paid confirmation"],
  [migration.includes("if v_payout.status <> 'pending' then") && migration.includes("Status submitted tidak boleh ditandai gagal otomatis"), "submitted transfer cannot be marked failed before bank reconciliation"],
  [migration.includes("oi.seller_id is distinct from pl.recipient_user_id") && migration.includes("o.status is null") && migration.includes("o.payment_review_required is distinct from false"), "null or changed seller, order and review states fail closed"],
  [migration.includes("c.calculation_base = pi.item_subtotal") && migration.includes("c.entry_type <> 'commission'"), "commission ledger and later reversals are revalidated before payout"],
  [migration.includes("o.payment_provider is distinct from 'midtrans'") && migration.includes("o.shipping_provider is distinct from 'Biteship'") && migration.includes("o.shipping_status is distinct from 'delivered'"), "missing payment or delivery fields fail closed at payout revalidation"],
  [migration.includes("pl.amount = (") && migration.includes("sum(pi.seller_net_amount)"), "payout batch total must equal the sum of its item allocations"],
  [migration.includes("(array_agg(c.id order by c.id) filter (where c.entry_type = 'commission'))[1]"), "commission UUID selection uses ordered aggregation without unsupported UUID max"],
  [migration.includes("marketplace_payout_ledger_seller_transfer_reference_unique"), "a bank transfer reference cannot be reused for another seller payout"],
  [migration.includes("split_part(trim(p_evidence_path), '/', 1) <> p_payout_id::text"), "evidence path is restricted to the payout folder"],
  [migration.includes("interval '7 days'"), "seller payout hold is 7x24h from validated delivered time"],
  [migration.includes("o.payment_review_required = false"), "payment review blocks payout"],
  [migration.includes("e.verification_status = 'verified'") && migration.includes("e.processed_at is not null"), "payout requires processed verified Midtrans event"],
  [migration.includes("round(oi.item_subtotal * 0.025, 2)"), "commission is 2.5 percent of item subtotal"],
  [migration.includes("o.shipping_status = 'delivered'"), "Biteship delivered status is required"],
  [migration.includes("lower(e.event_type) like '%refund%'") && migration.includes("lower(e.event_type) like '%chargeback%'") && migration.includes("lower(e.event_type) like '%dispute%'"), "refund, chargeback and dispute events hold payout"],
  [migration.includes("payout_hold = false"), "manual payout hold blocks eligibility"],
  [migration.includes("for update") && migration.includes("pg_advisory_xact_lock"), "payout status updates and seller requests are serialized"],
  [migration.includes("status='paid'") && migration.includes("v_payout.status <> 'submitted'"), "paid can only follow submitted"],
  [migration.includes("Payout ditahan karena item tidak lagi memenuhi syarat") && migration.includes("File bukti transfer tidak lagi tersedia"), "payout is revalidated again at final paid confirmation"],
  [migration.includes("revoke all on function private.platform_owner_update_seller_payout") && migration.includes("role='platform_owner'"), "admin transition is restricted to active Platform Owner"],
  [migration.includes("marketplace-payout-evidence") && migration.includes("public = false"), "transfer evidence bucket is private"],
  [edge.includes('authData.user?.email_confirmed_at') && edge.includes("platform_admins"), "edge endpoint verifies user and Platform Owner"],
  [edge.includes('eq("recipient_user_id", userId)'), "seller statement is scoped to the authenticated seller"],
  [edge.includes('createSignedUploadUrl') && edge.includes('createSignedUrl'), "evidence access uses short-lived signed URLs"],
  [edge.includes('eq("transfer_evidence_path", path)'), "evidence download requires an exact payout ledger link"],
  [edge.includes('["pending", "failed"].includes(payout.status)'), "evidence upload is limited to an existing pending or failed seller payout"],
  [webhook.includes("shipping_delivered_at") && webhook.includes("currentOrder.shipping_delivered_at"), "delivered timestamp comes from signed webhook receipt"],
  [docs.includes("tidak mengubah data pesanan atau uang") && docs.includes("BELUM boleh dijalankan"), "production rollout is explicitly blocked pending migration reconciliation"],
];
for (const [condition, message] of checks) {
  assert.ok(condition, message);
  console.log("PASS:", message);
}
