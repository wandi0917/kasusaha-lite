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

// Webhook events may arrive out of order. Never let an older movement event
// downgrade a shipment that has already advanced to a later delivery stage.
const statusRank: Record<string, number> = {
  confirmed: 10, scheduled: 20, allocated: 30,
  picking_up: 40, pickingUp: 40, picked: 50,
  in_transit: 60, inTransit: 60,
  dropping_off: 70, droppingOff: 70,
  on_hold: 75, onHold: 75,
  delivered: 80,
  return_in_transit: 90, returnInTransit: 90,
  returned: 95,
  rejected: 100, courier_not_found: 100, courierNotFound: 100,
  cancelled: 100, disposed: 100,
};
function shouldApplyStatus(current: unknown, incoming: string): boolean {
  const currentStatus = text(current);
  if (!currentStatus || currentStatus === incoming) return true;
  const currentRank = statusRank[currentStatus];
  const incomingRank = statusRank[incoming];
  // Unknown stored or incoming states fail closed; do not replace them based
  // on an ordering assumption that has not been explicitly defined.
  if (currentRank === undefined || incomingRank === undefined) return false;
  return incomingRank > currentRank;
}

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
    // Read current status, then use an optimistic compare-and-set on that exact
    // value below. This prevents two concurrent/out-of-order webhooks from
    // overwriting a newer status after this read.
    const { data: currentOrder, error: currentOrderError } = await admin.from("marketplace_orders")
      .select("id,shipping_status")
      .eq("biteship_order_id", biteshipOrderId)
      .eq("shipping_provider", "Biteship")
      .maybeSingle();
    if (currentOrderError) {
      console.error("Gagal membaca status pengiriman saat memproses webhook Biteship.", currentOrderError.message);
      return reply({ success: false, error: "Status pengiriman belum dapat diperiksa." }, 500);
    }
    if (!currentOrder) return reply({ success: false, error: "Pesanan Biteship tidak ditemukan." }, 404);
    if (shouldApplyStatus(currentOrder.shipping_status, status)) {
      patch.shipping_status = status;
      // Retain the value observed above as a write precondition. A competing
      // webhook that changes it first makes this update affect zero rows.
      patch.__expected_shipping_status = currentOrder.shipping_status;
    }
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

  const expectedStatus = patch.__expected_shipping_status;
  delete patch.__expected_shipping_status;
  let updateQuery = admin.from("marketplace_orders")
    .update(patch)
    .eq("biteship_order_id", biteshipOrderId)
    .eq("shipping_provider", "Biteship");
  if (patch.shipping_status !== undefined) {
    updateQuery = expectedStatus === null
      ? updateQuery.is("shipping_status", null)
      : updateQuery.eq("shipping_status", expectedStatus);
  }
  const { data, error } = await updateQuery
    .select("id,shipping_status,shipping_tracking_id,shipping_waybill_id")
    .maybeSingle();

  if (error) {
    console.error("Gagal menyimpan webhook Biteship.", error.message);
    return reply({ success: false, error: "Status pengiriman belum dapat disimpan." }, 500);
  }
  if (!data && patch.shipping_status !== undefined) {
    // A newer webhook won the compare-and-set. Treat this delivery as safely
    // superseded rather than retrying it into a stale status overwrite.
    const { data: latestOrder, error: latestError } = await admin.from("marketplace_orders")
      .select("id,shipping_status,shipping_tracking_id,shipping_waybill_id")
      .eq("biteship_order_id", biteshipOrderId)
      .eq("shipping_provider", "Biteship")
      .maybeSingle();
    if (latestError) {
      console.error("Gagal membaca status terbaru setelah konflik webhook Biteship.", latestError.message);
      return reply({ success: false, error: "Status pengiriman terbaru belum dapat diperiksa." }, 500);
    }
    if (!latestOrder) return reply({ success: false, error: "Pesanan Biteship tidak ditemukan." }, 404);
    return reply({ success: true, ignored: true, reason: "Status lebih baru telah diterapkan oleh notifikasi lain.", order_id: latestOrder.id, status: latestOrder.shipping_status, waybill_id: latestOrder.shipping_waybill_id });
  }
  if (!data) return reply({ success: false, error: "Pesanan Biteship tidak ditemukan." }, 404);
  return reply({ success: true, order_id: data.id, status: data.shipping_status, waybill_id: data.shipping_waybill_id });
});