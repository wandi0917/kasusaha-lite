
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type JsonObject = Record<string, unknown>;

type OrderItem = {
  product_id: number;
  quantity: number;
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function isObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function readSupabasePublicKey(): string | null {
  // Nama variabel legacy yang masih tersedia di banyak proyek.
  const legacy = readText(Deno.env.get("SUPABASE_ANON_KEY"));
  if (legacy) return legacy;

  // Nama variabel publishable key tunggal.
  const single = readText(Deno.env.get("SUPABASE_PUBLISHABLE_KEY"));
  if (single) return single;

  // Format variabel bawaan yang berisi dictionary JSON.
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);

      if (isObject(parsed)) {
        for (const value of Object.values(parsed)) {
          if (
            typeof value === "string" &&
            value.startsWith("sb_publishable_")
          ) {
            return value;
          }
        }
      }
    } catch {
      console.error("SUPABASE_PUBLISHABLE_KEYS bukan JSON valid.");
    }
  }

  return null;
}

function isValidUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/**
 * Mendukung beberapa bentuk hasil RPC:
 * - "uuid"
 * - { id: "uuid" }
 * - { order_id: "uuid" }
 * - [{ id: "uuid" }]
 * - { data: { order_id: "uuid" } }
 *
 * Hanya UUID valid yang diterima sebagai nomor pesanan.
 */
function extractOrderId(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null;

  if (isValidUuid(value)) return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractOrderId(item, depth + 1);
      if (id) return id;
    }
    return null;
  }

  if (!isObject(value)) return null;

  const keys = [
    "order_id",
    "orderId",
    "order_uuid",
    "orderUuid",
    "id",
    "create_marketplace_order",
    "data",
    "result",
    "order",
  ];

  for (const key of keys) {
    if (key in value) {
      const id = extractOrderId(value[key], depth + 1);
      if (id) return id;
    }
  }

  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return reply(
      {
        success: false,
        error: "Gunakan metode POST.",
      },
      405,
    );
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
      return reply(
        {
          success: false,
          error: "Silakan login terlebih dahulu.",
        },
        401,
      );
    }

    const supabaseUrl = readText(Deno.env.get("SUPABASE_URL"));
    const publicKey = readSupabasePublicKey();

    if (!supabaseUrl || !publicKey) {
      console.error("Konfigurasi URL atau public key Supabase tidak tersedia.");

      return reply(
        {
          success: false,
          error: "Konfigurasi server belum lengkap.",
        },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, publicKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Pastikan token pembeli benar-benar valid.
    const {
      data: authData,
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return reply(
        {
          success: false,
          error: "Sesi login tidak valid. Silakan login kembali.",
        },
        401,
      );
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return reply(
        {
          success: false,
          error: "Format JSON tidak valid.",
        },
        400,
      );
    }

    if (!isObject(body)) {
      return reply(
        {
          success: false,
          error: "Data pesanan tidak valid.",
        },
        400,
      );
    }

    const buyerName = readText(body.buyer_name);
    const buyerPhone = readText(body.buyer_phone);
    const shippingAddress = readText(body.shipping_address);

    if (!buyerName || buyerName.length > 120) {
      return reply(
        {
          success: false,
          error: "Nama pembeli wajib diisi, maksimal 120 karakter.",
        },
        400,
      );
    }

    if (
      !buyerPhone ||
      buyerPhone.length > 30 ||
      !/^[0-9+().\-\s]+$/.test(buyerPhone)
    ) {
      return reply(
        {
          success: false,
          error: "Nomor WhatsApp tidak valid.",
        },
        400,
      );
    }

    if (!shippingAddress || shippingAddress.length > 1000) {
      return reply(
        {
          success: false,
          error: "Alamat pengiriman wajib diisi, maksimal 1000 karakter.",
        },
        400,
      );
    }

    if (
      !Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > 50
    ) {
      return reply(
        {
          success: false,
          error: "Pesanan harus berisi 1 sampai 50 jenis produk.",
        },
        400,
      );
    }

    const items: OrderItem[] = [];

    for (const item of body.items) {
      if (!isObject(item)) {
        return reply(
          {
            success: false,
            error: "Format produk tidak valid.",
          },
          400,
        );
      }

      const productId = item.product_id;
      const quantity = item.quantity;

      if (
        typeof productId !== "number" ||
        !Number.isSafeInteger(productId) ||
        productId <= 0 ||
        typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 1000
      ) {
        return reply(
          {
            success: false,
            error: "ID produk atau jumlah barang tidak valid.",
          },
          400,
        );
      }

      items.push({
        product_id: productId,
        quantity,
      });
    }

    const shippingQuoteId = readText(body.shipping_quote_id);
    const physicalItems = items.filter((item) => item.product_id !== 7);

    // Lisensi KasUsaha Lite (produk 7) tidak dapat digabung dengan barang fisik.
    // Fungsi pembuatan pengiriman menolak pesanan campuran; cegah checkout sejak awal
    // agar pembeli tidak membayar barang fisik yang kemudian tidak bisa dikirim.
    if (physicalItems.length > 0 && physicalItems.length !== items.length) {
      return reply({
        success: false,
        error: "Lisensi KasUsaha Lite dan produk fisik harus dibeli dalam pesanan terpisah. Pisahkan keranjang lalu checkout kembali.",
        error_code: "MIXED_DIGITAL_PHYSICAL_CART",
      }, 400);
    }
    let shippingQuote: Record<string, unknown> | null = null;
    let shippingAdmin: ReturnType<typeof createClient> | null = null;
    let shippingProductSnapshot: Array<{product_id:number;quantity:number;weight:number;length:number;width:number;height:number}> = [];
    let verifiedPublicSubtotal = 0;

    if (physicalItems.length > 0) {
      if (!shippingQuoteId || !isValidUuid(shippingQuoteId)) {
        return reply({ success: false, error: "Pilih layanan pengiriman Biteship dan cek ongkir terlebih dahulu." }, 400);
      }
      const serviceRoleKey = readText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
      if (!serviceRoleKey) {
        return reply({ success: false, error: "Konfigurasi server pengiriman belum lengkap." }, 503);
      }
      shippingAdmin = createClient(supabaseUrl!, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: quote, error: quoteError } = await shippingAdmin
        .from("biteship_shipping_quotes")
        .select("id,buyer_id,product_fingerprint,origin_postal_code,destination_postal_code,courier_code,courier_service_code,courier_name,courier_service_name,shipping_amount,expires_at,used_at")
        .eq("id", shippingQuoteId)
        .eq("buyer_id", authData.user.id)
        .maybeSingle();
      if (quoteError || !quote) {
        return reply({ success: false, error: "Tarif pengiriman tidak ditemukan. Silakan cek ongkir kembali." }, 400);
      }
      if (quote.used_at || !quote.expires_at || new Date(String(quote.expires_at)).getTime() <= Date.now()) {
        return reply({ success: false, error: "Tarif pengiriman sudah dipakai atau kedaluwarsa. Silakan cek ongkir kembali." }, 400);
      }
      const submittedDestinationPostal = readText(body.destination_postal_code);
      if (!submittedDestinationPostal || !/^\d{5}$/.test(submittedDestinationPostal) || submittedDestinationPostal !== String(quote.destination_postal_code)) {
        return reply({ success: false, error: "Kode pos tujuan berubah setelah cek ongkir. Silakan cek ongkir kembali." }, 400);
      }
      const submittedFingerprint = physicalItems
        .map((item) => ({ product_id: item.product_id, quantity: item.quantity }))
        .sort((a, b) => a.product_id - b.product_id);
      const savedFingerprint = Array.isArray(quote.product_fingerprint)
        ? quote.product_fingerprint
            .map((item: Record<string, unknown>) => ({ product_id: Number(item.product_id), quantity: Number(item.quantity) }))
            .sort((a: {product_id:number}, b: {product_id:number}) => a.product_id - b.product_id)
        : [];
      if (JSON.stringify(submittedFingerprint) !== JSON.stringify(savedFingerprint)) {
        return reply({ success: false, error: "Keranjang berubah setelah cek ongkir. Silakan hitung ongkir kembali." }, 400);
      }

      const { data: currentProducts, error: currentProductsError } = await shippingAdmin
        .from("produk")
        .select("id,aktif,owner_id,stok,berat_gram,panjang_cm,lebar_cm,tinggi_cm,kode_pos_asal_pengiriman")
        .in("id", physicalItems.map((item) => item.product_id));
      if (currentProductsError || !currentProducts || currentProducts.length !== physicalItems.length) {
        return reply({ success: false, error: "Data paket berubah atau tidak dapat diverifikasi. Silakan cek ongkir kembali." }, 409);
      }
      if (currentProducts.some((p) => p.aktif !== true || !p.owner_id ||
          !Number.isFinite(Number(p.stok)) ||
          Number(p.stok) < (physicalItems.find((i) => i.product_id === Number(p.id))?.quantity || 0))) {
        return reply({ success: false, error: "Produk tidak aktif atau stok berubah setelah cek ongkir. Perbarui keranjang dan hitung ongkir kembali." }, 409);
      }
      const currentOrigins = [...new Set(currentProducts.map((p) => String(p.kode_pos_asal_pengiriman || "").trim()))];
      const currentSellers = [...new Set(currentProducts.map((p) => String(p.owner_id || "")))];
      if (currentOrigins.length !== 1 || !/^\d{5}$/.test(currentOrigins[0]) ||
          String(quote.origin_postal_code || "") !== currentOrigins[0] || currentSellers.length !== 1) {
        return reply({ success: false, error: "Lokasi asal atau penjual berubah setelah cek ongkir. Silakan hitung ongkir kembali." }, 409);
      }
      shippingProductSnapshot = currentProducts.map((p) => ({
        product_id: Number(p.id),
        quantity: physicalItems.find((i) => i.product_id === Number(p.id))?.quantity || 0,
        weight: Math.max(1, Number(p.berat_gram) || 1000),
        length: Math.max(1, Number(p.panjang_cm) || 10),
        width: Math.max(1, Number(p.lebar_cm) || 10),
        height: Math.max(1, Number(p.tinggi_cm) || 10),
      })).sort((a,b) => a.product_id-b.product_id);
      const savedPackageFingerprint = Array.isArray(quote.product_fingerprint)
        ? quote.product_fingerprint.map((item: Record<string, unknown>) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity),
            weight: Number(item.weight),
            length: Number(item.length),
            width: Number(item.width),
            height: Number(item.height),
          })).sort((a,b) => a.product_id-b.product_id)
        : [];
      if (JSON.stringify(shippingProductSnapshot) !== JSON.stringify(savedPackageFingerprint)) {
        return reply({ success: false, error: "Berat atau dimensi produk berubah setelah ongkir dihitung. Silakan cek ongkir kembali." }, 409);
      }
      shippingQuote = quote as Record<string, unknown>;
    } else if (shippingQuoteId) {
      return reply({ success: false, error: "Produk aktivasi digital tidak memerlukan ongkos kirim." }, 400);
    }

    const productIds = items.map((item) => item.product_id);

    if (new Set(productIds).size !== productIds.length) {
      return reply(
        {
          success: false,
          error: "Gabungkan jumlah jika produk yang sama muncul berulang.",
        },
        400,
      );
    }

    // Pastikan konfigurasi RPC tersedia SEBELUM mengklaim quote agar tarif
    // tidak terkunci ketika checkout tidak dapat diteruskan.
    const rpcServiceKey = readText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!rpcServiceKey) {
      return reply({ success: false, error: "Konfigurasi server pesanan belum lengkap." }, 503);
    }

    // Klaim tarif secara atomik setelah validasi keranjang dan SEBELUM membuat pesanan.
    // Satu quote tidak dapat dipakai dua checkout bersamaan oleh pembeli yang sama.
    let claimedQuoteAt: string | null = null;
    if (shippingQuote && shippingAdmin && shippingQuoteId) {
      const quoteClaimTime = new Date().toISOString();
      const { data: claimedQuote, error: quoteClaimError } = await shippingAdmin
        .from("biteship_shipping_quotes")
        .update({ used_at: quoteClaimTime })
        .eq("id", shippingQuoteId)
        .eq("buyer_id", authData.user.id)
        .is("used_at", null)
        .gt("expires_at", quoteClaimTime)
        .select("id")
        .maybeSingle();
      if (quoteClaimError || !claimedQuote) {
        return reply({
          success: false,
          error: "Tarif pengiriman sedang dipakai atau sudah kedaluwarsa. Silakan hitung ongkir kembali.",
        }, 409);
      }
      claimedQuoteAt = quoteClaimTime;
    }

    // RPC privileged hanya dipanggil dari backend setelah sesi pembeli diverifikasi.
    // Fungsi SQL secure hanya memberi hak EXECUTE kepada service_role.
    const orderAdmin = shippingAdmin ?? createClient(supabaseUrl!, rpcServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await orderAdmin.rpc(
      "create_marketplace_order_secure",
      {
        p_items: items,
        p_buyer_id: authData.user.id,
        p_buyer_name: buyerName,
        p_buyer_phone: buyerPhone,
        p_shipping_address: shippingAddress,
      },
    );

    if (error) {
      // RPC yang mengembalikan error tidak membuat pesanan; lepaskan quote
      // hanya jika masih dipegang oleh klaim checkout ini.
      if (claimedQuoteAt && shippingAdmin && shippingQuoteId) {
        const { error: releaseError } = await shippingAdmin
          .from("biteship_shipping_quotes")
          .update({ used_at: null })
          .eq("id", shippingQuoteId)
          .eq("buyer_id", authData.user.id)
          .eq("used_at", claimedQuoteAt);
        if (releaseError) {
          console.error("Gagal melepas quote setelah RPC gagal:", releaseError.message);
        }
      }
      console.error("create_marketplace_order RPC gagal:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      const status =
        error.code === "23505"
          ? 409
          : error.code === "42501"
            ? 403
            : error.code === "PGRST202"
              ? 500
              : 400;

      return reply(
        {
          success: false,
          error:
            error.code === "PGRST202"
              ? "Fungsi database create_marketplace_order_secure tidak ditemukan atau parameternya tidak cocok."
              : error.code === "P0001" && error.message === "Anda tidak dapat membeli produk milik sendiri."
                ? "Checkout tidak dapat dilanjutkan karena keranjang berisi produk milik akun penjual yang sedang login. Untuk membeli produk sendiri saat pengujian, gunakan akun pembeli lain; aturan ini melindungi transaksi dan komisi marketplace."
                : error.code === "P0001" && typeof error.message === "string" && error.message.trim()
                  ? error.message
                  : "Pesanan gagal diproses. Periksa log server dan konfigurasi database.",
          error_code: error.code ?? null,
        },
        status,
      );
    }

    const orderId = extractOrderId(data);

    if (!orderId) {
      // RPC sudah dipanggil, tetapi bentuk hasilnya belum memberikan UUID.
      // Jangan langsung mencoba ulang karena pesanan mungkin sudah tersimpan.
      console.error(
        "RPC tidak mengembalikan UUID pesanan. Periksa bentuk hasil RPC.",
        JSON.stringify(data),
      );

      return reply(
        {
          success: false,
          order_created_unknown: true,
          error:
            "Server menerima proses checkout, tetapi nomor pesanan tidak ditemukan dalam hasil database. Periksa marketplace_orders sebelum mencoba lagi.",
          message:
            "Jangan kirim ulang pesanan sampai hasil database diperiksa.",
        },
        502,
      );
    }

    let finalTotalAmount: number | null = null;
    if (shippingQuote && shippingAdmin) {
      const { data: orderRow, error: orderReadError } = await shippingAdmin
        .from("marketplace_orders")
        .select("id,buyer_id,status,item_subtotal")
        .eq("id", orderId)
        .eq("buyer_id", authData.user.id)
        .maybeSingle();
      if (orderReadError || !orderRow || orderRow.status !== "pending_payment") {
        console.error("Pesanan tidak dapat diverifikasi setelah dibuat.", orderReadError?.message);
        return reply({
          success: false,
          order_created_unknown: true,
          order_id: orderId,
          error: "Pesanan telah dibuat tetapi belum dapat dipasangkan dengan tarif pengiriman. Jangan buat ulang; hubungi dukungan dengan nomor pesanan.",
        }, 502);
      }
      const { data: finalProducts, error: finalProductsError } = await shippingAdmin
        .from("produk")
        .select("id,aktif,owner_id,berat_gram,panjang_cm,lebar_cm,tinggi_cm,kode_pos_asal_pengiriman")
        .in("id", shippingProductSnapshot.map((p) => p.product_id));
      const finalSnapshot = (finalProducts || []).map((p) => ({
        product_id: Number(p.id),
        quantity: shippingProductSnapshot.find((x) => x.product_id === Number(p.id))?.quantity || 0,
        weight: Math.max(1, Number(p.berat_gram) || 1000),
        length: Math.max(1, Number(p.panjang_cm) || 10),
        width: Math.max(1, Number(p.lebar_cm) || 10),
        height: Math.max(1, Number(p.tinggi_cm) || 10),
      })).sort((a,b) => a.product_id-b.product_id);
      const finalOrigins = [...new Set((finalProducts || []).map((p) => String(p.kode_pos_asal_pengiriman || "").trim()))];
      const finalSellers = [...new Set((finalProducts || []).map((p) => String(p.owner_id || "")))];
      if (finalProductsError || !finalProducts || finalProducts.length !== shippingProductSnapshot.length ||
          finalProducts.some((p) => p.aktif !== true) ||
          finalOrigins.length !== 1 || finalOrigins[0] !== String(shippingQuote.origin_postal_code || "") ||
          finalSellers.length !== 1 ||
          JSON.stringify(finalSnapshot) !== JSON.stringify(shippingProductSnapshot)) {
        await shippingAdmin.from("marketplace_orders").update({
          payment_review_required: true,
          payment_review_note: "Data berat, dimensi, lokasi asal, atau status produk berubah selama checkout; tarif Biteship harus diperiksa ulang.",
        }).eq("id", orderId).eq("buyer_id", authData.user.id).eq("status", "pending_payment");
        return reply({ success: false, order_created_unknown: true, order_id: orderId, error: "Data paket berubah selama checkout. Pesanan ditahan untuk pemeriksaan; jangan membayar atau membuat pesanan ulang." }, 409);
      }

      const shippingAmount = Math.round(Number(shippingQuote.shipping_amount));
      const itemSubtotal = Number(orderRow.item_subtotal);
      if (!Number.isFinite(shippingAmount) || shippingAmount < 0 || !Number.isFinite(itemSubtotal) || itemSubtotal <= 0) {
        await shippingAdmin.from("marketplace_orders").update({
          payment_review_required: true,
          payment_review_note: "Tarif Biteship atau subtotal tidak valid; pemeriksaan manual diperlukan.",
        }).eq("id", orderId);
        return reply({ success: false, order_created_unknown: true, order_id: orderId, error: "Pesanan dibuat tetapi nominal perlu pemeriksaan manual. Jangan mencoba checkout ulang." }, 502);
      }
      const { data: updatedOrder, error: shippingUpdateError } = await shippingAdmin
        .from("marketplace_orders")
        .update({
          shipping_amount: shippingAmount,
          total_amount: itemSubtotal + shippingAmount,
          shipping_provider: "Biteship",
          shipping_courier_code: String(shippingQuote.courier_code),
          shipping_service_code: String(shippingQuote.courier_service_code),
          shipping_service: String(shippingQuote.courier_name) + " — " + String(shippingQuote.courier_service_name),
          destination_postal_code: String(shippingQuote.destination_postal_code),
          payment_review_required: false,
          payment_review_note: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("buyer_id", authData.user.id)
        .eq("status", "pending_payment")
        .select("id,total_amount")
        .maybeSingle();
      if (shippingUpdateError || !updatedOrder) {
        console.error("Gagal memasangkan ongkir Biteship ke pesanan.", shippingUpdateError?.message);
        await shippingAdmin.from("marketplace_orders").update({
          payment_review_required: true,
          payment_review_note: "Gagal menerapkan tarif Biteship; jangan lakukan pembayaran sebelum diperiksa.",
        }).eq("id", orderId).eq("buyer_id", authData.user.id);
        return reply({ success: false, order_created_unknown: true, order_id: orderId, error: "Pesanan dibuat tetapi ongkir belum berhasil diterapkan. Pembayaran harus ditunda; jangan buat ulang pesanan." }, 502);
      }
      finalTotalAmount = Number(updatedOrder.total_amount);
      // Quote sudah dikunci atomik sebelum RPC pembuatan pesanan dijalankan.
    }

    // Format kompatibel: UUID tersedia di tingkat teratas dan di dalam data.
    return reply(
      {
        success: true,
        message: "Pesanan berhasil dibuat.",
        order_id: orderId,
        id: orderId,
        status: "pending_payment",
        total_amount: finalTotalAmount,
        shipping_amount: shippingQuote ? Number(shippingQuote.shipping_amount) : 0,
        shipping_provider: shippingQuote ? "Biteship" : null,
        data: {
          id: orderId,
          order_id: orderId,
          status: "pending_payment",
          result: data,
        },
      },
      201,
    );
  } catch (error) {
    console.error(
      "Kesalahan create-marketplace-order:",
      error instanceof Error ? error.message : String(error),
    );

    return reply(
      {
        success: false,
        error: "Terjadi kesalahan server saat memproses pesanan.",
      },
      500,
    );
  }
});
