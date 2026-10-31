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
  if (!url || !serviceKey || !biteshipKey || !publicKey) {
    console.error("Konfigurasi backend Biteship belum lengkap.");
    return reply({ success: false, error: "Integrasi pengiriman belum dikonfigurasi di server." }, 503);
  }
  if (!/^Bearer\s+\S+$/i.test(auth)) return reply({ success: false, error: "Silakan login terlebih dahulu." }, 401);

  const userClient = createClient(url, publicKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ success: false, error: "Sesi login tidak valid." }, 401);

  let body: Record<string, unknown>;
  try { const parsed = await req.json(); if (!obj(parsed)) throw new Error(); body = parsed; }
  catch { return reply({ success: false, error: "Data permintaan tidak valid." }, 400); }

  const destinationPostal = String(body.destination_postal_code || "").trim();
  if (!/^\d{5}$/.test(destinationPostal)) return reply({ success: false, error: "Masukkan kode pos tujuan 5 digit." }, 400);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return reply({ success: false, error: "Keranjang harus berisi 1–30 jenis produk." }, 400);

  const quantities = new Map<number, number>();
  for (const raw of body.items) {
    if (!obj(raw) || !Number.isSafeInteger(raw.product_id) || Number(raw.product_id) <= 0 || !Number.isSafeInteger(raw.quantity) || Number(raw.quantity) < 1 || Number(raw.quantity) > 1000) {
      return reply({ success: false, error: "ID produk atau jumlah tidak valid." }, 400);
    }
    const id = Number(raw.product_id);
    quantities.set(id, (quantities.get(id) || 0) + Number(raw.quantity));
  }
  if ([...quantities.values()].some(n => n > 1000)) return reply({ success: false, error: "Jumlah produk maksimal 1000 per jenis." }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: products, error: productError } = await admin.from("produk")
    .select("id,nama_produk,deskripsi,harga,stok,aktif,owner_id,berat_gram,panjang_cm,lebar_cm,tinggi_cm,kode_pos_asal_pengiriman")
    .in("id", [...quantities.keys()]);
  if (productError || !products || products.length !== quantities.size) {
    console.error("Produk tidak dapat diverifikasi untuk tarif.", productError?.message);
    return reply({ success: false, error: "Sebagian produk tidak ditemukan atau data produk belum lengkap." }, 400);
  }
  // Produk digital KasUsaha Lite (ID 7) tidak boleh masuk perhitungan ongkir.
  if (products.some(p => Number(p.id) === 7)) {
    return reply({ success: false, error: "Produk digital KasUsaha Lite tidak memerlukan ongkir. Pisahkan dari keranjang produk fisik." }, 400);
  }
  if (products.some(p => p.aktif !== true || !p.owner_id || Number(p.stok) < (quantities.get(Number(p.id)) || 0))) {
    return reply({ success: false, error: "Ada produk tidak aktif atau stok tidak mencukupi." }, 400);
  }
  const origins = [...new Set(products.map(p => String(p.kode_pos_asal_pengiriman || "").trim()))];
  if (origins.length !== 1 || !/^\d{5}$/.test(origins[0])) {
    return reply({ success: false, error: "Produk dalam keranjang harus berasal dari satu lokasi penjual dengan kode pos asal pengiriman 5 digit yang sudah diisi." }, 400);
  }
  if (new Set(products.map(p => String(p.owner_id))).size !== 1) {
    return reply({ success: false, error: "Untuk saat ini, satu pesanan hanya dapat berisi produk dari satu penjual agar ongkir dihitung dengan benar." }, 400);
  }

  const fingerprint = products.map(p => ({
    product_id: Number(p.id),
    quantity: quantities.get(Number(p.id)) || 0,
    weight: Math.max(1, Number(p.berat_gram) || 1000),
    length: Math.max(1, Number(p.panjang_cm) || 10),
    width: Math.max(1, Number(p.lebar_cm) || 10),
    height: Math.max(1, Number(p.tinggi_cm) || 10),
  })).sort((a,b) => a.product_id-b.product_id);
  const items = products.map(p => ({
    name: String(p.nama_produk || "Produk").slice(0, 200),
    description: String(p.deskripsi || p.nama_produk || "Produk").slice(0, 200),
    value: Math.max(1, Math.round(Number(p.harga) || 1)),
    quantity: quantities.get(Number(p.id)) || 1,
    weight: Math.max(1, Number(p.berat_gram) || 1000),
    length: Math.max(1, Number(p.panjang_cm) || 10),
    width: Math.max(1, Number(p.lebar_cm) || 10),
    height: Math.max(1, Number(p.tinggi_cm) || 10),
  }));
  const response = await fetch("https://api.biteship.com/v1/rates/couriers", {
    method: "POST",
    headers: { "Authorization": biteshipKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      origin_postal_code: Number(origins[0]),
      destination_postal_code: Number(destinationPostal),
      couriers: "jne,jnt,sicepat,tiki,pos,wahana,anteraja,ninja,lionparcel,idexpress,sap",
      items,
    }),
  });
  let data: unknown;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || !obj(data) || data.success !== true || !Array.isArray(data.pricing)) {
    console.error("Biteship rates gagal.", { status: response.status, code: obj(data) ? data.code : null });
    return reply({ success: false, error: "Biteship belum dapat menghitung ongkir untuk alamat dan produk ini. Periksa konfigurasi akun, kode pos, berat, dan saldo API." }, 502);
  }

  const fingerprintJson = fingerprint;
  const options = [];
  for (const p of data.pricing) {
    if (!obj(p) || typeof p.company !== "string" || typeof p.type !== "string" || !Number.isFinite(Number(p.price)) || Number(p.price) < 0) continue;
    const row = {
      buyer_id: userData.user.id,
      product_fingerprint: fingerprintJson,
      origin_postal_code: origins[0],
      destination_postal_code: destinationPostal,
      courier_code: p.company,
      courier_service_code: p.type,
      courier_name: String(p.courier_name || p.company),
      courier_service_name: String(p.courier_service_name || p.type),
      shipping_amount: Math.round(Number(p.price)),
      currency: "IDR",
      expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    };
    const { data: saved, error: saveError } = await admin.from("biteship_shipping_quotes").insert(row).select("id").single();
    if (saveError || !saved?.id) {
      console.error("Gagal menyimpan quote Biteship.", saveError?.message);
      return reply({ success: false, error: "Tarif berhasil dihitung tetapi gagal disimpan. Silakan ulangi cek ongkir." }, 500);
    }
    options.push({
      quote_id: saved.id,
      courier_code: row.courier_code,
      courier_name: row.courier_name,
      service_code: row.courier_service_code,
      service_name: row.courier_service_name,
      price: row.shipping_amount,
      duration: typeof p.duration === "string" ? p.duration : (typeof p.shipment_duration_range === "string" ? p.shipment_duration_range + " " + String(p.shipment_duration_unit || "days") : ""),
      expires_at: row.expires_at,
    });
  }
  return reply({ success: true, destination_postal_code: destinationPostal, origin_postal_code: origins[0], options });
});