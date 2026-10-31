import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function obj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ success: false, error: "Gunakan POST." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const biteshipKey = Deno.env.get("BITESHIP_API_KEY");
  const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
  const auth = req.headers.get("Authorization") || "";
  if (!url || !serviceKey || !biteshipKey || !publicKey) return reply({ success: false, error: "Konfigurasi server pengiriman belum lengkap." }, 503);
  if (Deno.env.get("BITESHIP_ENABLE_SHIPMENT_BOOKING") !== "true") return reply({ success: false, error: "Pembuatan pengiriman langsung masih dinonaktifkan sampai tarif, alamat asal, dan mode akun Biteship selesai diuji." }, 503);
  if (!/^Bearer\s+\S+$/i.test(auth)) return reply({ success: false, error: "Silakan login terlebih dahulu." }, 401);
  const userClient = createClient(url, publicKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ud, error: ue } = await userClient.auth.getUser();
  if (ue || !ud.user) return reply({ success: false, error: "Sesi login tidak valid." }, 401);
  let body: Record<string, unknown>;
  try { const v = await req.json(); if (!obj(v)) throw new Error(); body = v; }
  catch { return reply({ success: false, error: "Format permintaan tidak valid." }, 400); }
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId)) return reply({ success: false, error: "Nomor pesanan tidak valid." }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: order, error: oe } = await admin.from("marketplace_orders")
    .select("id,buyer_id,status,buyer_name,buyer_phone,shipping_address,destination_postal_code,shipping_provider,shipping_courier_code,shipping_service_code,shipping_tracking_id,shipping_waybill_id,shipping_status,shipping_created_at,payment_review_required")
    .eq("id", orderId).maybeSingle();
  if (oe || !order) return reply({ success: false, error: "Pesanan tidak ditemukan." }, 404);
  if (order.status !== "paid" && order.status !== "processing") return reply({ success: false, error: "Pengiriman hanya dapat dibuat setelah pembayaran terverifikasi." }, 409);
  if (order.payment_review_required === true) return reply({ success: false, error: "Pengiriman ditahan karena pesanan memerlukan pemeriksaan manual." }, 409);

  // Status "paid" di baris pesanan saja tidak cukup: event Midtrans harus
  // berstatus verified dan sudah diproses oleh webhook utama.
  const { data: verifiedPaymentEvent, error: verifiedPaymentEventError } = await admin
    .from("marketplace_payment_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("verification_status", "verified")
    .not("processed_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (verifiedPaymentEventError) {
    console.error("Biteship verified payment lookup:", verifiedPaymentEventError.message);
    return reply({ success: false, error: "Status verifikasi pembayaran belum dapat diperiksa. Pengiriman ditahan sementara." }, 500);
  }
  if (!verifiedPaymentEvent) {
    return reply({ success: false, error: "Pembayaran belum memiliki event Midtrans terverifikasi. Pengiriman ditahan sampai rekonsiliasi selesai." }, 409);
  }

  if (order.shipping_tracking_id || order.shipping_waybill_id || order.shipping_created_at) {
    return reply({ success: true, already_created: true, tracking_id: order.shipping_tracking_id, waybill_id: order.shipping_waybill_id, status: order.shipping_status, message: "Pengiriman untuk pesanan ini sudah tercatat." });
  }
  if (order.shipping_status === "creating") return reply({ success: false, error: "Pembuatan pengiriman sedang berlangsung atau hasil API sebelumnya belum pasti. Periksa dashboard Biteship sebelum mencoba lagi." }, 409);
  if (!order.shipping_courier_code || !order.shipping_service_code || !order.destination_postal_code) return reply({ success: false, error: "Data kurir, layanan, atau kode pos tujuan belum lengkap." }, 400);

  const { data: orderItems, error: ie } = await admin.from("marketplace_order_items")
    .select("product_id,product_name_snapshot,unit_price,quantity,seller_id")
    .eq("order_id", orderId);
  if (ie || !orderItems?.length) return reply({ success: false, error: "Rincian barang pesanan tidak ditemukan." }, 400);
  // Lisensi KasUsaha Lite ID 7 adalah produk digital; jangan pernah kirim ke Biteship.
  // Pesanan campuran lama tetap dapat mengirim barang fisiknya saja.
  const physicalOrderItems = orderItems.filter(i => Number(i.product_id) !== 7);
  if (!physicalOrderItems.length) {
    return reply({ success: false, error: "Pesanan ini hanya berisi lisensi digital dan tidak memerlukan pengiriman fisik." }, 400);
  }
  if (physicalOrderItems.some(i => String(i.seller_id) !== ud.user.id)) return reply({ success: false, error: "Hanya penjual pemilik semua barang fisik dalam pesanan yang dapat membuat pengiriman." }, 403);
  const productIds = [...new Set(physicalOrderItems.map(i => Number(i.product_id)).filter(Number.isFinite))];
  const { data: products, error: pe } = await admin.from("produk")
    .select("id,nama_produk,deskripsi,harga,berat_gram,panjang_cm,lebar_cm,tinggi_cm,alamat_asal_pengiriman,kode_pos_asal_pengiriman,telepon_pengirim,nama_kontak_pengirim,owner_id,nama_penjual")
    .in("id", productIds);
  if (pe || !products || products.length !== productIds.length) return reply({ success: false, error: "Data produk penjual tidak lengkap untuk membuat pengiriman." }, 400);
  if (products.some(p => String(p.owner_id) !== ud.user.id)) return reply({ success: false, error: "Data pemilik produk tidak sesuai dengan akun penjual." }, 403);
  const origins = [...new Set(products.map(p => String(p.kode_pos_asal_pengiriman || "").trim()))];
  const addresses = [...new Set(products.map(p => String(p.alamat_asal_pengiriman || "").trim()))];
  const phones = [...new Set(products.map(p => String(p.telepon_pengirim || "").trim()))];
  const contacts = [...new Set(products.map(p => String(p.nama_kontak_pengirim || p.nama_penjual || "").trim()))];
  if (origins.length !== 1 || !/^\d{5}$/.test(origins[0]) || addresses.length !== 1 || !addresses[0] || phones.length !== 1 || !phones[0] || contacts.length !== 1 || !contacts[0]) {
    return reply({ success: false, error: "Lengkapi alamat asal, kode pos asal, nama kontak, dan telepon pengirim pada data produk penjual." }, 400);
  }
  if (!order.buyer_name || !order.buyer_phone || !order.shipping_address) return reply({ success: false, error: "Data nama, telepon, atau alamat pembeli belum lengkap." }, 400);
  const productById = new Map(products.map(p => [Number(p.id), p]));
  const biteshipItems = physicalOrderItems.map(i => {
    const p = productById.get(Number(i.product_id));
    if (!p) throw new Error("Produk pesanan tidak ditemukan.");
    return {
      name: String(i.product_name_snapshot || p.nama_produk || "Produk").slice(0, 200),
      description: String(p.deskripsi || p.nama_produk || "Produk").slice(0, 200),
      value: Math.max(1, Math.round(Number(i.unit_price) || Number(p.harga) || 1)),
      quantity: Number(i.quantity),
      weight: Math.max(1, Number(p.berat_gram) || 1000),
      length: Math.max(1, Number(p.panjang_cm) || 10),
      width: Math.max(1, Number(p.lebar_cm) || 10),
      height: Math.max(1, Number(p.tinggi_cm) || 10),
    };
  });
  const { data: sellerUser } = await admin.auth.admin.getUserById(ud.user.id);
  const sellerEmail = sellerUser?.user?.email || "";
  if (!sellerEmail) return reply({ success: false, error: "Email akun penjual belum tersedia untuk label pengiriman. Perbarui email akun penjual terlebih dahulu." }, 400);
  const { data: buyerUser } = await admin.auth.admin.getUserById(String(order.buyer_id));
  const buyerEmail = buyerUser?.user?.email || undefined;

  const { data: lock, error: lockError } = await admin.from("marketplace_orders")
    .update({ shipping_status: "creating", updated_at: new Date().toISOString() })
    .eq("id", orderId).in("status", ["paid", "processing"])
    .is("shipping_tracking_id", null).is("shipping_waybill_id", null).is("shipping_created_at", null)
    .select("id").maybeSingle();
  if (lockError || !lock) return reply({ success: false, error: "Pesanan sedang diproses pengiriman oleh proses lain. Periksa status pesanan." }, 409);

  const payload = {
    reference_id: orderId,
    shipper_contact_name: contacts[0],
    shipper_contact_phone: phones[0],
    shipper_contact_email: sellerEmail,
    shipper_organization: "KasUsaha Lite",
    origin_contact_name: contacts[0],
    origin_contact_phone: phones[0],
    origin_address: addresses[0],
    origin_postal_code: Number(origins[0]),
    destination_contact_name: order.buyer_name,
    destination_contact_phone: order.buyer_phone,
    destination_contact_email: buyerEmail,
    destination_address: order.shipping_address,
    destination_postal_code: Number(order.destination_postal_code),
    courier_company: order.shipping_courier_code,
    courier_type: order.shipping_service_code,
    delivery_type: "now",
    order_note: "Pesanan KasUsaha Lite " + orderId,
    items: biteshipItems,
  };
  let response: Response;
  try {
    response = await fetch("https://api.biteship.com/v1/orders", {
      method: "POST",
      headers: { "Authorization": biteshipKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Koneksi create order Biteship gagal; hasil booking belum pasti.", e instanceof Error ? e.message : String(e));
    return reply({ success: false, uncertain: true, error: "Koneksi ke Biteship terputus setelah permintaan dikirim. Periksa dashboard Biteship sebelum mencoba ulang." }, 502);
  }
  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok || !obj(result) || result.success !== true || typeof result.id !== "string") {
    console.error("Biteship order gagal.", { status: response.status, code: obj(result) ? result.code : null });
    await admin.from("marketplace_orders").update({ shipping_status: null, updated_at: new Date().toISOString() })
      .eq("id", orderId).eq("shipping_status", "creating").is("shipping_tracking_id", null);
    return reply({ success: false, error: "Biteship menolak pembuatan pengiriman. Periksa alamat asal/tujuan, kode pos, dan layanan kurir." }, 502);
  }
  const courier = obj(result.courier) ? result.courier : {};
  const { data: saved, error: saveError } = await admin.from("marketplace_orders").update({
    shipping_provider: "Biteship",
    shipping_tracking_id: typeof courier.tracking_id === "string" ? courier.tracking_id : result.id,
    shipping_waybill_id: typeof courier.waybill_id === "string" ? courier.waybill_id : null,
    shipping_status: typeof result.status === "string" ? result.status : "confirmed",
    shipping_created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", orderId).eq("shipping_status", "creating").select("id,shipping_tracking_id,shipping_waybill_id,shipping_status").maybeSingle();
  if (saveError || !saved) {
    console.error("Biteship menerima order tetapi gagal menyimpan hasil di database.", saveError?.message);
    return reply({ success: false, uncertain: true, external_order_id: result.id, error: "Biteship sudah menerima pengiriman tetapi penyimpanan database gagal. Jangan buat pengiriman baru; gunakan ID Biteship saat menghubungi dukungan." }, 502);
  }
  return reply({ success: true, order_id: orderId, biteship_order_id: result.id, tracking_id: saved.shipping_tracking_id, waybill_id: saved.shipping_waybill_id, status: saved.shipping_status });
});