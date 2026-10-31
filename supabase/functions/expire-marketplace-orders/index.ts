
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, message: "Gunakan POST." }, 405);
  }

  const cronSecret = Deno.env.get("EXPIRY_CRON_SECRET");
  const suppliedSecret = req.headers.get("x-cron-secret");

  if (!cronSecret || !suppliedSecret || suppliedSecret !== cronSecret) {
    return jsonResponse({ success: false, message: "Akses ditolak." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  const isProduction =
    String(Deno.env.get("MIDTRANS_IS_PRODUCTION") ?? "").trim().toLowerCase() === "true";

  if (!supabaseUrl || !serviceRoleKey || !serverKey) {
    return jsonResponse({
      success: false,
      message: "Konfigurasi secret server belum lengkap.",
    }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const baseUrl = isProduction
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";

  // Umur pesanan hanya untuk memilih kandidat, bukan bukti bahwa pembayaran kedaluwarsa.
  const expiryHours = 24;
  const cutoff = new Date(
    Date.now() - expiryHours * 60 * 60 * 1000,
  ).toISOString();

  const { data: orders, error: queryError } = await supabase
    .from("marketplace_orders")
    .select("id, provider_transaction_id, created_at, status, payment_provider")
    .eq("status", "pending_payment")
    .eq("payment_provider", "midtrans")
    .not("provider_transaction_id", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(50);

  if (queryError) {
    console.error("Gagal mengambil kandidat pesanan:", queryError.message);
    return jsonResponse({
      success: false,
      message: "Gagal mengambil data pesanan.",
    }, 500);
  }

  let cancelled = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders ?? []) {
    const transactionId = order.provider_transaction_id;

    if (!transactionId || typeof transactionId !== "string") {
      skipped++;
      continue;
    }

    try {
      const statusResponse = await fetch(
        `${baseUrl}/v2/${encodeURIComponent(transactionId)}/status`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${btoa(`${serverKey}:`)}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!statusResponse.ok) {
        // Jangan membatalkan pesanan berdasarkan respons error, termasuk 404.
        console.warn(
          "Status Midtrans tidak dapat diverifikasi:",
          order.id,
          statusResponse.status,
        );
        skipped++;
        continue;
      }

      const payment = await statusResponse.json();

      // Pastikan respons memang untuk transaksi yang sedang diperiksa.
      if (
        payment.order_id !== transactionId ||
        typeof payment.transaction_status !== "string"
      ) {
        console.warn("Identitas transaksi tidak cocok:", order.id);
        skipped++;
        continue;
      }

      const paymentStatus = payment.transaction_status.toLowerCase();

      // Status ini tidak boleh dibatalkan oleh proses expiry.
      if (
        paymentStatus === "settlement" ||
        (
          paymentStatus === "capture" &&
          payment.fraud_status?.toLowerCase() === "accept"
        )
      ) {
        console.info("Transaksi berhasil; menunggu sinkronisasi webhook:", order.id);
        skipped++;
        continue;
      }

      // Hanya status terminal eksplisit dari Midtrans yang diproses.
      const terminalStatuses = ["expire", "cancel", "deny", "failure"];

      if (!terminalStatuses.includes(paymentStatus)) {
        skipped++;
        continue;
      }

      const { data: result, error: rpcError } = await supabase.rpc(
        "expire_marketplace_order",
        {
          p_order_id: order.id,
          p_transaction_id: transactionId,
        },
      );

      if (rpcError) {
        console.error("RPC pembatalan gagal:", order.id, rpcError.message);
        failed++;
        continue;
      }

      if (result?.success === true) {
        cancelled++;
        console.info("Pemrosesan expiry berhasil:", order.id, paymentStatus);
      } else {
        // Misalnya webhook sudah lebih dahulu menandai pesanan sebagai paid.
        console.info("Pesanan dilewati:", order.id, result?.message ?? "Status berubah");
        skipped++;
      }
    } catch (error) {
      console.error(
        "Pemeriksaan transaksi gagal:",
        order.id,
        error instanceof Error ? error.message : "Kesalahan tidak diketahui",
      );
      failed++;
    }
  }

  return jsonResponse({
    success: true,
    scanned: orders?.length ?? 0,
    cancelled,
    skipped,
    failed,
    message: "Pemeriksaan pesanan selesai.",
  });
});
