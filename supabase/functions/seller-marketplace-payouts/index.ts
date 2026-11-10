import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kasusaha-lite.pages.dev",
  "https://wandi0917.github.io",
  "https://fix-navigation-serialization.kasusaha-lite.pages.dev",
]);
const headers = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function reply(body: unknown, status = 200, origin: string | null = null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://kasusaha-lite.pages.dev";
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Access-Control-Allow-Origin": allowed, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clean(value: unknown, max = 1000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Origin": origin || "https://kasusaha-lite.pages.dev" } });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply({ error: "Login diperlukan." }, 401, origin);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !service) return reply({ error: "Konfigurasi server belum lengkap." }, 500, origin);

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user?.email_confirmed_at) return reply({ error: "Sesi login tidak valid." }, 401, origin);
  const userId = authData.user.id;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!isObject(parsed)) throw new Error("invalid");
    body = parsed;
  } catch {
    return reply({ error: "Payload JSON tidak valid." }, 400, origin);
  }

  const action = clean(body.action, 40);
  const ownerActions = new Set(["owner_list", "owner_mark_submitted", "owner_mark_paid", "owner_mark_failed", "owner_create_evidence_upload", "owner_get_evidence", "owner_set_hold"]);
  const isOwnerAction = ownerActions.has(action || "");
  if (isOwnerAction) {
    const { data: owner, error } = await admin.from("platform_admins")
      .select("user_id").eq("user_id", userId).eq("active", true).eq("role", "platform_owner").maybeSingle();
    if (error) return reply({ error: "Akses Platform Owner belum dapat diverifikasi." }, 500, origin);
    if (!owner) return reply({ error: "Hanya Platform Owner yang dapat mengelola pencairan." }, 403, origin);
  }

  if (action === "request_payout") {
    const requestId = clean(body.request_id, 36);
    if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return reply({ error: "request_id harus UUID yang valid." }, 400, origin);
    }
    const { data, error } = await userClient.rpc("request_seller_marketplace_payout", { p_request_id: requestId });
    if (error) return reply({ error: error.message || "Permintaan pencairan gagal." }, 409, origin);
    return reply({ success: true, result: data }, 200, origin);
  }

  if (action === "seller_statement") {
    const { data: payouts, error } = await admin.from("marketplace_payout_ledger")
      .select("id,amount,currency,status,provider,provider_payout_id,requested_at,completed_at,transfer_reference,transfer_evidence_path,notes,updated_at")
      .eq("recipient_type", "seller").eq("recipient_user_id", userId)
      .order("requested_at", { ascending: false }).limit(100);
    if (error) return reply({ error: "Pernyataan pencairan belum dapat dimuat." }, 500, origin);
    const ids = (payouts || []).map((p) => p.id);
    const { data: details, error: detailError } = ids.length
      ? await admin.from("marketplace_payout_items")
          .select("payout_id,order_item_id,item_subtotal,commission_amount,seller_net_amount,delivered_at,created_at")
          .in("payout_id", ids)
      : { data: [], error: null };
    if (detailError) return reply({ error: "Rincian pencairan belum dapat dimuat." }, 500, origin);
    return reply({ success: true, payouts: payouts || [], items: details || [] }, 200, origin);
  }

  if (action === "owner_list") {
    const { data: payouts, error } = await admin.from("marketplace_payout_ledger")
      .select("id,recipient_user_id,amount,currency,status,provider,transfer_reference,transfer_evidence_path,requested_at,completed_at,submitted_by,paid_by,failed_by,notes,updated_at")
      .eq("recipient_type", "seller").order("requested_at", { ascending: false }).limit(500);
    if (error) return reply({ error: "Daftar payout belum dapat dimuat." }, 500, origin);
    const ids = (payouts || []).map((p) => p.id);
    const { data: items, error: itemError } = ids.length
      ? await admin.from("marketplace_payout_items")
          .select("payout_id,order_item_id,commission_ledger_id,item_subtotal,commission_amount,seller_net_amount,delivered_at")
          .in("payout_id", ids)
      : { data: [], error: null };
    if (itemError) return reply({ error: "Rincian payout belum dapat dimuat." }, 500, origin);
    return reply({ success: true, payouts: payouts || [], items: items || [] }, 200, origin);
  }

  if (action === "owner_mark_submitted" || action === "owner_mark_paid" || action === "owner_mark_failed") {
    const payoutId = clean(body.payout_id, 36);
    if (!payoutId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payoutId)) return reply({ error: "payout_id tidak valid." }, 400, origin);
    const rpcAction = action === "owner_mark_submitted" ? (body.retry === true ? "retry_submitted" : "mark_submitted")
      : action === "owner_mark_paid" ? "mark_paid" : "mark_failed";
    const { data, error } = await userClient.rpc("platform_owner_update_seller_payout", {
      p_payout_id: payoutId,
      p_action: rpcAction,
      p_transfer_reference: clean(body.transfer_reference, 160),
      p_evidence_path: clean(body.evidence_path, 500),
      p_note: clean(body.note, 1000),
    });
    if (error) return reply({ error: error.message || "Perubahan status payout gagal." }, 409, origin);
    return reply({ success: true, result: data }, 200, origin);
  }

  if (action === "owner_create_evidence_upload") {
    const payoutId = clean(body.payout_id, 36);
    const fileName = clean(body.file_name, 100);
    if (!payoutId || !/^[0-9a-f-]{36}$/i.test(payoutId) || !fileName || !/\.(pdf|png|jpe?g)$/i.test(fileName)) {
      return reply({ error: "payout_id atau nama bukti PDF/JPG/PNG tidak valid." }, 400, origin);
    }
    const path = userId + "/" + payoutId + "/" + crypto.randomUUID() + "-" + fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const { data, error } = await admin.storage.from("marketplace-payout-evidence").createSignedUploadUrl(path);
    if (error || !data) return reply({ error: "Tautan unggah bukti belum dapat dibuat. Pastikan migration dan bucket sudah diterapkan." }, 503, origin);
    return reply({ success: true, path, signed_url: data.signedUrl, token: data.token }, 200, origin);
  }

  if (action === "owner_get_evidence") {
    const path = clean(body.evidence_path, 500);
    if (!path || !path.startsWith(userId + "/")) return reply({ error: "Bukti hanya dapat dibuka oleh pemiliknya." }, 403, origin);
    const { data, error } = await admin.storage.from("marketplace-payout-evidence").createSignedUrl(path, 60);
    if (error || !data) return reply({ error: "Bukti transfer tidak ditemukan." }, 404, origin);
    return reply({ success: true, signed_url: data.signedUrl, expires_in: 60 }, 200, origin);
  }

  if (action === "owner_set_hold") {
    const itemId = clean(body.order_item_id, 36);
    if (!itemId || !/^[0-9a-f-]{36}$/i.test(itemId) || typeof body.hold !== "boolean") return reply({ error: "Rincian penahanan tidak valid." }, 400, origin);
    const { data, error } = await userClient.rpc("platform_owner_set_seller_payout_hold", {
      p_order_item_id: itemId, p_hold: body.hold, p_reason: clean(body.reason, 1000),
    });
    if (error) return reply({ error: error.message || "Penahanan item gagal diubah." }, 409, origin);
    return reply({ success: true, result: data }, 200, origin);
  }

  return reply({ error: "Aksi tidak dikenal." }, 400, origin);
});
