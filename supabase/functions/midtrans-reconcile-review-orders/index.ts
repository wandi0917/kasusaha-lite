import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kasusaha-lite.pages.dev",
  "https://wandi0917.github.io",
]);

function headers(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://kasusaha-lite.pages.dev";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function reply(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function amountMatches(databaseAmount: unknown, midtransAmount: unknown): boolean {
  const a = Number(databaseAmount);
  const b = Number(midtransAmount);
  return Number.isFinite(a) && Number.isFinite(b) &&
    Math.round(a * 100) === Math.round(b * 100);
}

function isPaidStatus(status: Record<string, unknown>): boolean {
  const transactionStatus = String(status.transaction_status ?? "").toLowerCase();
  const fraudStatus = String(status.fraud_status ?? "").toLowerCase();
  const statusCode = String(status.status_code ?? "");
  const fraudStatusAcceptable = fraudStatus === "" || fraudStatus === "accept";
  return statusCode === "200" && fraudStatusAcceptable &&
    (transactionStatus === "settlement" ||
      (transactionStatus === "capture" && fraudStatus === "accept"));
}

async function sha512(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return reply({ success: false, message: "Origin tidak diizinkan." }, 403, origin);
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return reply({ success: false, message: "Gunakan POST." }, 405, origin);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply({ success: false, message: "Silakan login terlebih dahulu." }, 401, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
    const configuredMode = String(Deno.env.get("MIDTRANS_IS_PRODUCTION") ?? "").trim().toLowerCase();

    // Reconciliation is strictly Sandbox-only. No Production API calls are possible.
    if (configuredMode !== "false") {
      return reply({
        success: false,
        code: "SANDBOX_ONLY",
        message: "Rekonsiliasi dikunci ke Sandbox. Periksa MIDTRANS_IS_PRODUCTION di Supabase.",
      }, 503, origin);
    }
    if (!supabaseUrl || !anonKey || !serviceKey || !serverKey.trim()) {
      return reply({ success: false, message: "Konfigurasi server belum lengkap." }, 500, origin);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user?.email_confirmed_at) {
      return reply({ success: false, message: "Sesi login tidak valid atau email belum dikonfirmasi." }, 401, origin);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: platformOwner, error: ownerError } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", authData.user.id)
      .eq("active", true)
      .eq("role", "platform_owner")
      .maybeSingle();

    if (ownerError) return reply({ success: false, message: "Pemeriksaan hak akses gagal." }, 500, origin);
    if (!platformOwner) return reply({ success: false, message: "Hanya Owner Platform yang dapat merekonsiliasi pembayaran." }, 403, origin);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reply({ success: false, message: "Format permintaan tidak valid." }, 400, origin);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return reply({ success: false, message: "JSON permintaan tidak valid." }, 400, origin);
    }

    if (body.action !== "reconcile_review_orders") {
      return reply({ success: false, message: "Aksi rekonsiliasi tidak dikenal." }, 400, origin);
    }

    // Only the 31-10 audit-held paid orders are considered. Cancelled and pending
    // orders are never changed by this batch operation.
    const auditReviewNote = "Audit 31-10-2026: status pesanan paid belum didukung event Midtrans berstatus verified dan processed. Tahan pengiriman, aktivasi lisensi dari pesanan ini, dan pencairan sampai rekonsiliasi pembayaran selesai.";
    const { data: orders, error: ordersError } = await admin
      .from("marketplace_orders")
      .select("id,status,payment_provider,provider_transaction_id,total_amount,payment_review_required,payment_review_note")
      .eq("status", "paid")
      .eq("payment_provider", "midtrans")
      .eq("payment_review_required", true)
      .eq("payment_review_note", auditReviewNote)
      .order("created_at", { ascending: true })
      .limit(50);

    if (ordersError) {
      console.error("Review order lookup failed:", ordersError.message);
      return reply({ success: false, message: "Daftar pesanan tertahan tidak dapat dibaca." }, 500, origin);
    }

    const results: Array<Record<string, unknown>> = [];
    const apiBase = "https://api.sandbox.midtrans.com";

    for (const order of orders || []) {
      const hasStoredMidtransOrderId = Boolean(order.provider_transaction_id);
      // Older orders may have used the database UUID as Midtrans order_id.
      // The Status API must confirm this exact candidate before it is trusted.
      const midtransOrderId = String(order.provider_transaction_id || order.id);
      const canAutoReconcile = hasStoredMidtransOrderId &&
        String(order.payment_review_note || "").trim() === auditReviewNote;

      let statusResponse: Response;
      let status: Record<string, unknown>;
      try {
        statusResponse = await fetch(
          `${apiBase}/v2/${encodeURIComponent(midtransOrderId)}/status`,
          {
            method: "GET",
            headers: {
              "Authorization": `Basic ${btoa(serverKey.trim() + ":")}`,
              "Accept": "application/json",
            },
          },
        );
        if (!statusResponse.ok) {
          results.push({
            order_id: order.id,
            result: statusResponse.status === 404 ? "not_found_in_sandbox" : "status_api_error",
            http_status: statusResponse.status,
          });
          continue;
        }
        const parsed = await statusResponse.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          results.push({ order_id: order.id, result: "invalid_status_response" });
          continue;
        }
        status = parsed as Record<string, unknown>;
      } catch (error) {
        console.error("Midtrans status lookup failed:", order.id, error);
        results.push({ order_id: order.id, result: "status_api_network_error" });
        continue;
      }

      const identityMatches = String(status.order_id ?? "") === midtransOrderId;
      const amountIsCorrect = amountMatches(order.total_amount, status.gross_amount);
      const currencyIsCorrect = String(status.currency ?? "IDR").toUpperCase() === "IDR";
      const statusCodeIsCorrect = String(status.status_code ?? "") === "200";

      if (!identityMatches || !amountIsCorrect || !currencyIsCorrect || !statusCodeIsCorrect) {
        results.push({
          order_id: order.id,
          result: "status_data_mismatch",
          identity_matches: identityMatches,
          amount_matches: amountIsCorrect,
          currency_matches: currencyIsCorrect,
          status_code_valid: statusCodeIsCorrect,
        });
        continue;
      }

      if (!isPaidStatus(status)) {
        results.push({
          order_id: order.id,
          result: "not_paid_in_sandbox",
          transaction_status: String(status.transaction_status ?? "unknown"),
        });
        continue;
      }

      const statusCode = String(status.status_code);
      const grossAmount = String(status.gross_amount);
      if (!canAutoReconcile) {
        results.push({
          order_id: order.id,
          result: "verified_but_manual_review_required",
          transaction_status: String(status.transaction_status ?? ""),
          reason: hasStoredMidtransOrderId
            ? "Catatan review memuat alasan manual tambahan; tidak dibersihkan otomatis."
            : "ID transaksi tidak tersimpan; Status API hanya diperiksa menggunakan UUID pesanan dan perlu pemeriksaan manual.",
        });
        continue;
      }

      const notification: Record<string, unknown> = {
        order_id: midtransOrderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: await sha512(midtransOrderId + statusCode + grossAmount + serverKey.trim()),
        transaction_id: String(status.transaction_id ?? ""),
        transaction_status: String(status.transaction_status ?? ""),
        fraud_status: String(status.fraud_status ?? ""),
        payment_type: String(status.payment_type ?? ""),
        transaction_time: status.transaction_time ?? "",
        settlement_time: status.settlement_time ?? "",
      };

      try {
        // Route through the main webhook so its locking, idempotency, commission,
        // license, and audit-review rules remain the single source of truth.
        const webhookResponse = await fetch(
          `${supabaseUrl}/functions/v1/midtrans-webhook`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": anonKey,
            },
            body: JSON.stringify(notification),
          },
        );
        let webhookBody: Record<string, unknown> = {};
        try {
          const parsed = await webhookResponse.json();
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            webhookBody = parsed as Record<string, unknown>;
          }
        } catch {
          // Keep the HTTP status as the diagnostic result.
        }

        if (webhookResponse.ok && webhookBody.success === true) {
          results.push({
            order_id: order.id,
            result: "verified_and_reconciled",
            transaction_status: String(status.transaction_status ?? ""),
          });
        } else {
          results.push({
            order_id: order.id,
            result: "webhook_processing_failed",
            webhook_http_status: webhookResponse.status,
            message: String(webhookBody.message ?? "Webhook belum mengonfirmasi pemrosesan."),
          });
        }
      } catch (error) {
        console.error("Webhook forwarding failed:", order.id, error);
        results.push({ order_id: order.id, result: "webhook_network_error" });
      }
    }

    const verified = results.filter(x => x.result === "verified_and_reconciled").length;
    const notPaid = results.filter(x => x.result === "not_paid_in_sandbox").length;
    const failed = results.length - verified - notPaid;

    return reply({
      success: true,
      environment: "sandbox",
      checked: results.length,
      verified_and_reconciled: verified,
      not_paid_in_sandbox: notPaid,
      needs_manual_review: failed,
      results,
      message: "Rekonsiliasi selesai. Hanya transaksi yang dikonfirmasi Midtrans Sandbox yang diteruskan ke webhook utama.",
    }, 200, origin);
  } catch (error) {
    console.error("Sandbox reconciliation error:", error);
    return reply({ success: false, message: "Terjadi kesalahan saat merekonsiliasi pembayaran." }, 500, req.headers.get("origin"));
  }
});
