import { createClient } from "npm:@supabase/supabase-js@2";

const headers = { "Content-Type": "application/json; charset=utf-8" };
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}
function obj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
const allowedStatuses = new Set([
  "confirmed", "scheduled", "allocated", "picking_up", "pickingUp",
  "picked", "in_transit", "inTransit", "dropping_off", "droppingOff",
  "return_in_transit", "returnInTransit", "on_hold", "onHold",
  "delivered", "rejected", "courier_not_found", "courierNotFound",
  "returned", "cancelled", "disposed",
]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ success: false, error: "Gunakan POST." }, 405);

  const expectedKey = Deno.env.get("BITESHIP_WEBHOOK_SIGNATURE_KEY") || "";
  const expectedSecret = Deno.env.get("BITESHIP_WEBHOOK_SIGNATURE_SECRET") || "";
  const receivedKey = req.headers.get("x-kasusaha-signature-key") || req.headers.get("x-signature-key") || req.headers.get("signature-key") || "";
  const receivedSecret = req.headers.get("x-kasusaha-signature-secret") || req.headers.get("x-signature-secret") || req.headers.get("signature-secret") || "";
  if (!expectedKey || !expectedSecret) {
    console.error("Secret webhook Biteship belum dikonfigurasi.");
    return reply({ success: false, error: "Webhook belum dikonfigurasi." }, 503);
  }
  if (!safeEqual(receivedKey, expectedKey) || !safeEqual(receivedSecret, expectedSecret)) {
    return reply({ success: false, error: "Signature webhook tidak valid." }, 401);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!obj(parsed)) throw new Error("invalid");
    body = parsed;
  } catch {
    return reply({ success: false, error: "Payload JSON tidak valid." }, 400);
  }

  const event = text(body.event);
  const biteshipOrderId = text(body.order_id);
  if (!event || !biteshipOrderId || biteshipOrderId.length > 160) {
    return reply({ success: false, error: "Event atau order_id tidak valid." }, 400);
  }
  if (event === "order.price") {
    // Harga akhir Biteship tidak boleh mengubah ongkir yang sudah dibayar secara diam-diam.
    console.warn("Webhook order.price diterima; perlu rekonsiliasi manual.", { biteshipOrderId });
    return reply({ success: true, ignored: true, reason: "Perubahan harga perlu rekonsiliasi manual." });
  }
  if (event !== "order.status" && event !== "order.waybill_id") {
    return reply({ success: true, ignored: true, reason: "Event tidak digunakan." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ success: false, error: "Konfigurasi database server belum lengkap." }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const patch: Record<string, unknown> = {
    shipping_last_event_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const status = text(body.status);
  if (event === "order.status") {
    if (!status || !allowedStatuses.has(status)) {
      return reply({ success: false, error: "Status pengiriman tidak dikenal." }, 400);
    }
    patch.shipping_status = status;
  }
  const trackingId = text(body.courier_tracking_id);
  const waybillId = text(body.courier_waybill_id);
  const trackingUrl = text(body.courier_link);
  if (trackingId) patch.shipping_tracking_id = trackingId.slice(0, 180);
  if (waybillId) patch.shipping_waybill_id = waybillId.slice(0, 180);
  if (trackingUrl) {
    try {
      const parsedUrl = new URL(trackingUrl);
      if (parsedUrl.protocol === "https:" && !parsedUrl.username && !parsedUrl.password) {
        patch.shipping_tracking_url = parsedUrl.href.slice(0, 1000);
      }
    } catch { /* Abaikan URL tracking yang tidak valid. */ }
  }

  const { data, error } = await admin.from("marketplace_orders")
    .update(patch)
    .eq("biteship_order_id", biteshipOrderId)
    .eq("shipping_provider", "Biteship")
    .select("id,shipping_status,shipping_tracking_id,shipping_waybill_id")
    .maybeSingle();

  if (error) {
    console.error("Gagal menyimpan webhook Biteship.", error.message);
    return reply({ success: false, error: "Status pengiriman belum dapat disimpan." }, 500);
  }
  if (!data) return reply({ success: false, error: "Pesanan Biteship tidak ditemukan." }, 404);
  return reply({ success: true, order_id: data.id, status: data.shipping_status, waybill_id: data.shipping_waybill_id });
});