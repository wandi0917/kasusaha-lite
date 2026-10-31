import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ success: false, message: "Gunakan POST." }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ success: false, message: "Silakan login terlebih dahulu." }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      return respond({ success: false, message: "Konfigurasi server belum lengkap." }, 500);
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return respond({ success: false, message: "Sesi login tidak valid. Login kembali." }, 401);
    }

    const userId = authData.user.id;
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json();
    const action = body?.action;

    if (action !== "status" && action !== "activate") {
      return respond({ success: false, message: "Jenis permintaan tidak dikenal." }, 400);
    }

    if (action === "status") {
      const { data: licenses, error: le } = await admin
        .from("kasusaha_licenses")
        .select("id, order_id, product_name, status, activated_at, activation_user_id, activation_confirmed_at")
        .eq("buyer_id", userId)
        .eq("status", "active")
        .limit(50);

      if (le) {
        console.error("License status lookup:", le.message);
        return respond({ success: false, message: "Status lisensi belum dapat diperiksa." }, 500);
      }

      const validLicenses = (licenses || []).filter(
        (l) => String(l.product_name || "").trim().toLowerCase() === "kasusaha lite"
      );
      if (validLicenses.length === 0) {
        return respond({ success: true, active: false, message: "Belum ada lisensi aktif untuk akun ini. Masukkan kode lisensi." });
      }

      const orderIds = validLicenses.map((l) => l.order_id).filter(Boolean);
      const { data: orders, error: oe } = await admin
        .from("marketplace_orders")
        .select("id, buyer_id, status, paid_at, payment_review_required")
        .in("id", orderIds)
        .eq("buyer_id", userId)
        .eq("status", "paid")
        .not("paid_at", "is", null);

      if (oe) {
        console.error("Paid order lookup:", oe.message);
        return respond({ success: false, message: "Status pembayaran belum dapat diperiksa." }, 500);
      }

      const paidOrderIds = (orders || [])
        .filter((o) => o.payment_review_required !== true)
        .map((o) => o.id);
      const verifiedOrderIds = new Set<string>();
      if (paidOrderIds.length) {
        const { data: verifiedEvents, error: verifiedEventError } = await admin
          .from("marketplace_payment_events")
          .select("order_id")
          .in("order_id", paidOrderIds)
          .eq("verification_status", "verified")
          .not("processed_at", "is", null);
        if (verifiedEventError) {
          console.error("Verified payment-event lookup:", verifiedEventError.message);
          return respond({ success: false, active: false, message: "Verifikasi pembayaran belum dapat diselesaikan." }, 500);
        }
        for (const event of verifiedEvents || []) verifiedOrderIds.add(event.order_id);
      }
      const validOrderIds = new Set(
        paidOrderIds.filter((id) => verifiedOrderIds.has(id))
      );
      const matchingLicense = validLicenses.find((l) => validOrderIds.has(l.order_id));
      if (!matchingLicense) {
        return respond({ success: true, active: false, message: "Belum ditemukan lisensi dengan pembayaran terverifikasi." });
      }

      // Backfill metadata for a valid license previously activated by this endpoint.
      if (!matchingLicense.activation_user_id || !matchingLicense.activation_confirmed_at) {
        const now = new Date().toISOString();
        const { error: metadataError } = await admin
          .from("kasusaha_licenses")
          .update({
            activation_user_id: userId,
            activation_confirmed_at: matchingLicense.activation_confirmed_at || matchingLicense.activated_at || now,
          })
          .eq("id", matchingLicense.id)
          .eq("buyer_id", userId)
          .eq("status", "active");
        if (metadataError) console.error("License metadata update:", metadataError.message);
      }

      return respond({ success: true, active: true, message: "Lisensi KasUsaha Lite aktif dan pembayaran terverifikasi." });
    }

    const licenseKey = typeof body.license_key === "string" ? body.license_key.trim() : "";
    if (!licenseKey || licenseKey.length > 200) {
      return respond({ success: false, active: false, message: "Masukkan kode lisensi yang valid." }, 400);
    }

    const { data: license, error: licenseError } = await admin
      .from("kasusaha_licenses")
      .select("id, order_id, buyer_id, product_name, status, activated_at, activation_user_id, activation_confirmed_at")
      .eq("license_key", licenseKey)
      .maybeSingle();

    if (licenseError) {
      console.error("License lookup:", licenseError.message);
      return respond({ success: false, active: false, message: "Lisensi belum dapat diperiksa." }, 500);
    }
    if (!license || license.buyer_id !== userId ||
        String(license.product_name || "").trim().toLowerCase() !== "kasusaha lite") {
      return respond({ success: false, active: false, message: "Lisensi tidak ditemukan untuk akun pembeli ini." }, 403);
    }
    if (license.status !== "active") {
      return respond({ success: false, active: false, message: "Lisensi tidak aktif atau telah dicabut." }, 403);
    }

    const { data: order, error: orderError } = await admin
      .from("marketplace_orders")
      .select("id, buyer_id, status, paid_at, payment_review_required")
      .eq("id", license.order_id)
      .eq("buyer_id", userId)
      .maybeSingle();

    if (orderError) {
      console.error("Order lookup:", orderError.message);
      return respond({ success: false, active: false, message: "Pembayaran belum dapat diperiksa." }, 500);
    }
    if (!order || order.status !== "paid" || !order.paid_at || order.payment_review_required === true) {
      return respond({ success: false, active: false, message: "Pesanan belum memenuhi syarat aktivasi." }, 403);
    }

    const { data: verifiedEvent, error: verifiedEventError } = await admin
      .from("marketplace_payment_events")
      .select("id")
      .eq("order_id", license.order_id)
      .eq("verification_status", "verified")
      .not("processed_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (verifiedEventError) {
      console.error("Verified payment-event lookup:", verifiedEventError.message);
      return respond({ success: false, active: false, message: "Verifikasi pembayaran belum dapat diselesaikan." }, 500);
    }
    if (!verifiedEvent) {
      return respond({ success: false, active: false, message: "Pembayaran belum memiliki event Midtrans terverifikasi. Aktivasi ditahan sampai rekonsiliasi pembayaran selesai." }, 403);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("kasusaha_licenses")
      .update({
        activated_at: license.activated_at || now,
        activation_user_id: userId,
        activation_confirmed_at: license.activation_confirmed_at || now,
      })
      .eq("id", license.id)
      .eq("buyer_id", userId)
      .eq("status", "active");

    if (updateError) {
      console.error("Activation update:", updateError.message);
      return respond({ success: false, active: false, message: "Aktivasi belum berhasil disimpan." }, 500);
    }

    return respond({ success: true, active: true, message: "Lisensi KasUsaha Lite berhasil diverifikasi dan diaktifkan." });
  } catch (error) {
    console.error("Activation error:", error);
    return respond({ success: false, active: false, message: "Terjadi kesalahan saat memproses lisensi." }, 500);
  }
});