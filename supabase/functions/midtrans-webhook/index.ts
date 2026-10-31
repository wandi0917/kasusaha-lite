
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonObject = Record<string, unknown>;

type WebhookOrder = {
  id: string;
  status: string;
  total_amount: number | string;
  currency: string | null;
  payment_provider: string | null;
  provider_transaction_id: string | null;
  paid_at: string | null;
  payment_review_required: boolean;
  payment_review_note: string | null;
};

function reply(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function sha512(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-512",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function amountMatches(
  databaseAmount: unknown,
  midtransAmount: unknown,
): boolean {
  const a = Number(databaseAmount);
  const b = Number(midtransAmount);

  return Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.round(a * 100) === Math.round(b * 100);
}

function isPaidStatus(status: JsonObject): boolean {
  const transactionStatus = String(
    status.transaction_status ?? "",
  ).toLowerCase();
  const fraudStatus = String(
    status.fraud_status ?? "",
  ).toLowerCase();
  const statusCode = String(status.status_code ?? "");

  // Sebagian metode pembayaran tidak dievaluasi FDS dan tidak mengirim fraud_status.
  // Settlement tetap sah bila fraud_status tidak ada; jika ada, nilainya wajib ACCEPT.
  // Capture hanya diterima bila fraud_status secara eksplisit ACCEPT.
  const fraudStatusAcceptable = fraudStatus === "" || fraudStatus === "accept";
  return statusCode === "200" &&
    fraudStatusAcceptable &&
    (transactionStatus === "settlement" ||
      (transactionStatus === "capture" && fraudStatus === "accept"));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(value);
}

function safeNotificationPayload(
  notification: JsonObject,
): JsonObject {
  const safePayload: JsonObject = { ...notification };

  // Jangan menyimpan signature_key ke dalam tabel peristiwa.
  delete safePayload.signature_key;

  return safePayload;
}

async function recordVerifiedPaymentEvent(
  supabase: ReturnType<typeof createClient>,
  args: {
    orderId: string;
    midtransOrderId: string;
    notification: JsonObject;
    midtransStatus: JsonObject;
  },
): Promise<{ id: string | null; error: string | null }> {
  const {
    orderId,
    midtransOrderId,
    notification,
    midtransStatus,
  } = args;

  const transactionStatus = String(
    midtransStatus.transaction_status ?? "unknown",
  ).toLowerCase();

  const fingerprintSource = JSON.stringify({
    order_id: midtransOrderId,
    transaction_id: String(
      midtransStatus.transaction_id ??
        notification.transaction_id ??
        "",
    ),
    transaction_status: transactionStatus,
    status_code: String(notification.status_code ?? ""),
    gross_amount: String(
      midtransStatus.gross_amount ??
        notification.gross_amount ??
        "",
    ),
    fraud_status: String(
      midtransStatus.fraud_status ??
        notification.fraud_status ??
        "",
    ).toLowerCase(),
    transaction_time: String(
      midtransStatus.transaction_time ??
        notification.transaction_time ??
        "",
    ),
    settlement_time: String(
      midtransStatus.settlement_time ??
        notification.settlement_time ??
        "",
    ),
    payment_type: String(
      midtransStatus.payment_type ??
        notification.payment_type ??
        "",
    ),
  });

  const providerEventId = await sha256(fingerprintSource);

  const payload: JsonObject = {
    notification: safeNotificationPayload(notification),
    verified_status: midtransStatus,
  };

  const { error: insertError } = await supabase
    .from("marketplace_payment_events")
    .upsert(
      {
        provider: "midtrans",
        provider_event_id: providerEventId,
        provider_transaction_id: String(
          midtransStatus.transaction_id ??
            notification.transaction_id ??
            midtransOrderId,
        ),
        order_id: orderId,
        event_type: transactionStatus,
        verification_status: "verified",
        payload,
      },
      {
        onConflict: "provider,provider_event_id",
        ignoreDuplicates: true,
      },
    );

  if (insertError) {
    console.error(
      "Gagal menyimpan peristiwa pembayaran:",
      insertError.message,
    );

    return {
      id: null,
      error: insertError.message,
    };
  }

  // Pada notifikasi duplikat, upsert di atas mungkin tidak
  // mengembalikan baris. Ambil ID peristiwa yang sudah ada.
  const { data: event, error: readError } = await supabase
    .from("marketplace_payment_events")
    .select("id")
    .eq("provider", "midtrans")
    .eq("provider_event_id", providerEventId)
    .maybeSingle();

  if (readError || !event?.id) {
    const message = readError?.message ??
      "ID peristiwa pembayaran tidak ditemukan.";

    console.error(message);

    return {
      id: null,
      error: message,
    };
  }

  return {
    id: String(event.id),
    error: null,
  };
}

async function markPaymentEventProcessed(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
): Promise<string | null> {
  // Pastikan baris event benar-benar ditemukan dan berhasil diperbarui.
  const { data, error } = await supabase
    .from("marketplace_payment_events")
    .update({
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    const message = error?.message ??
      "Baris peristiwa tidak ditemukan saat menandai selesai.";
    console.error(
      "Gagal menandai peristiwa pembayaran selesai:",
      message,
    );
    return message;
  }

  return null;
}

async function recordCommissionForPaidOrder(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  paymentEventId: string,
): Promise<{ success: boolean; error: string | null }> {
  // Komisi 2,5% = 0,025.
  // Dasar perhitungan hanya subtotal produk, bukan ongkos kirim.
  const COMMISSION_RATE = 0.025;

  const { data: items, error: itemsError } = await supabase
    .from("marketplace_order_items")
    .select("id, item_subtotal, product_id")
    .eq("order_id", orderId);

  if (itemsError) {
    console.error(
      "Gagal membaca rincian untuk komisi:",
      itemsError.message,
    );

    return {
      success: false,
      error: itemsError.message,
    };
  }

  if (!items || items.length === 0) {
    const message =
      "Rincian produk pesanan tidak ditemukan; komisi belum dicatat.";

    console.error(message);

    return {
      success: false,
      error: message,
    };
  }

  const ledgerRows = [];

  for (const item of items) {
    // Lisensi KasUsaha Lite adalah produk aktivasi platform, bukan transaksi marketplace seller.
    if (Number(item.product_id) === 7) continue;

    const base = Number(item.item_subtotal);

    if (!Number.isFinite(base) || base < 0) {
      const message =
        `Subtotal produk tidak valid untuk item ${item.id}.`;

      console.error(message);

      return {
        success: false,
        error: message,
      };
    }

    const commissionAmount = Math.round(base * COMMISSION_RATE);

    // Tidak membuat catatan komisi bernilai nol.
    if (commissionAmount === 0) continue;

    ledgerRows.push({
      order_item_id: item.id,
      entry_type: "commission",
      commission_rate: COMMISSION_RATE,
      calculation_base: base,
      amount: commissionAmount,
      idempotency_key: `commission:${item.id}`,
      payment_event_id: paymentEventId,
      notes:
        "Komisi platform 2,5% dari subtotal produk; tidak termasuk ongkos kirim.",
    });
  }

  if (ledgerRows.length === 0) {
    console.log(
      "Tidak ada komisi positif yang perlu dicatat untuk pesanan:",
      orderId,
    );

    return {
      success: true,
      error: null,
    };
  }

  // Kunci idempotency_key mencegah komisi ganda ketika
  // Midtrans mengirim notifikasi yang sama lebih dari sekali.
  const { error: ledgerError } = await supabase
    .from("marketplace_commission_ledger")
    .upsert(ledgerRows, {
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
    });

  if (ledgerError) {
    console.error(
      "Gagal menyimpan catatan komisi:",
      ledgerError.message,
    );

    return {
      success: false,
      error: ledgerError.message,
    };
  }

  // Upsert dengan ignoreDuplicates mencegah baris ganda, tetapi tidak
  // membuktikan bahwa baris lama memiliki nominal yang benar. Baca ulang
  // ledger dan cocokkan setiap baris terhadap perhitungan saat ini.
  const { data: savedLedgerRows, error: verifyLedgerError } = await supabase
    .from("marketplace_commission_ledger")
    .select(
      "order_item_id, entry_type, commission_rate, calculation_base, amount, idempotency_key",
    )
    .in("idempotency_key", ledgerRows.map((row) => row.idempotency_key));

  if (verifyLedgerError) {
    console.error(
      "Gagal memverifikasi catatan komisi:",
      verifyLedgerError.message,
    );
    return {
      success: false,
      error: verifyLedgerError.message,
    };
  }

  const savedByKey = new Map(
    (savedLedgerRows ?? []).map((row) => [String(row.idempotency_key), row]),
  );

  for (const expected of ledgerRows) {
    const saved = savedByKey.get(expected.idempotency_key);
    const matches = saved &&
      String(saved.order_item_id) === String(expected.order_item_id) &&
      String(saved.entry_type) === expected.entry_type &&
      Number(saved.commission_rate) === COMMISSION_RATE &&
      Number(saved.calculation_base) === Number(expected.calculation_base) &&
      Number(saved.amount) === Number(expected.amount);

    if (!matches) {
      const message =
        `Catatan komisi tidak cocok atau tidak ditemukan untuk item ${expected.order_item_id}; perlu pemeriksaan manual.`;
      console.error(message);
      return { success: false, error: message };
    }
  }

  console.log(
    "Pencatatan komisi diverifikasi untuk pesanan:",
    orderId,
    "jumlah item komisi:",
    ledgerRows.length,
  );

  return {
    success: true,
    error: null,
  };
}

async function issueLicenseIfApplicable(
  supabase: ReturnType<typeof createClient>,
  databaseOrderId: string,
) {
  const { data: items, error: itemError } = await supabase
    .from("marketplace_order_items")
    .select("id, product_id")
    .eq("order_id", databaseOrderId)
    .eq("product_id", 7)
    .limit(1);

  if (itemError) {
    console.error(
      "Gagal memeriksa rincian produk lisensi:",
      itemError.message,
    );

    return {
      error: itemError.message,
      applicable: false,
    };
  }

  if (!items || items.length === 0) {
    return {
      error: null,
      applicable: false,
    };
  }

  const { data, error } = await supabase.rpc(
    "issue_kasusaha_license",
    {
      p_order_id: databaseOrderId,
    },
  );

  if (error) {
    console.error(
      "Gagal menerbitkan lisensi:",
      error.message,
    );

    return {
      error: error.message,
      applicable: true,
    };
  }

  if (
    typeof data !== "object" ||
    data === null ||
    (data as JsonObject).success !== true ||
    (data as JsonObject).license_issued !== true
  ) {
    const message =
      "Fungsi penerbitan lisensi tidak mengonfirmasi lisensi berhasil diterbitkan.";
    console.error(message, JSON.stringify(data));
    return {
      error: message,
      applicable: true,
      result: data,
    };
  }

  console.log(
    "Hasil penerbitan lisensi:",
    JSON.stringify(data),
  );

  return {
    error: null,
    applicable: true,
    result: data,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return reply({
      success: false,
      message: "Metode tidak diizinkan.",
    }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  const isProduction =
    String(Deno.env.get("MIDTRANS_IS_PRODUCTION") ?? "").trim().toLowerCase() === "true";

  if (!supabaseUrl || !serviceRoleKey || !serverKey) {
    console.error("Konfigurasi server belum lengkap.");

    return reply({
      success: false,
      message: "Konfigurasi server belum lengkap.",
    }, 500);
  }

  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  let notification: JsonObject;

  try {
    const parsed: unknown = await req.json();

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return reply({
        success: false,
        message: "Format JSON notifikasi tidak valid.",
      }, 400);
    }

    notification = parsed as JsonObject;
  } catch {
    return reply({
      success: false,
      message: "JSON notifikasi tidak valid.",
    }, 400);
  }

  const midtransOrderId = String(
    notification.order_id ?? "",
  );
  const statusCode = String(notification.status_code ?? "");
  const grossAmount = String(notification.gross_amount ?? "");
  const signatureKey = String(notification.signature_key ?? "");

  if (
    !midtransOrderId ||
    !statusCode ||
    !grossAmount ||
    !signatureKey
  ) {
    return reply({
      success: false,
      message: "Data notifikasi Midtrans tidak lengkap.",
    }, 400);
  }

  // 1. Verifikasi signature notifikasi Midtrans.
  const expectedSignature = await sha512(
    midtransOrderId + statusCode + grossAmount + serverKey,
  );

  if (!constantTimeEqual(expectedSignature, signatureKey)) {
    console.error("Signature notifikasi tidak valid.");

    return reply({
      success: false,
      message: "Tanda tangan tidak valid.",
    }, 401);
  }

  // Pembayaran aktivasi ID Karyawan (KSEMP/KSDEV) tidak disimpan sebagai
  // marketplace_orders. Endpoint employee-device-activation memverifikasi
  // status transaksi langsung ke Midtrans saat Owner memuat daftar aktivasi.
  // Akui notifikasi bertanda tangan valid agar Midtrans tidak terus mengulang
  // callback yang memang bukan pesanan marketplace.
  if (/^(?:KSEMP|KSDEV)-[A-F0-9]{32}$/i.test(midtransOrderId)) {
    return reply({
      success: true,
      received: true,
      handled_by: "employee-device-activation",
      message: "Notifikasi aktivasi ID Karyawan diterima. Status pembayaran diverifikasi melalui menu aktivasi Owner.",
    }, 200);
  }

  const orderSelect =
    "id, status, total_amount, currency, payment_provider, provider_transaction_id, paid_at, payment_review_required, payment_review_note";

  // 2. Cari pesanan berdasarkan ID transaksi Midtrans.
  const {
    data: orderByTransactionId,
    error: transactionLookupError,
  } = await supabase
    .from("marketplace_orders")
    .select(orderSelect)
    .eq("provider_transaction_id", midtransOrderId)
    .maybeSingle();

  if (transactionLookupError) {
    console.error(
      "Gagal membaca pesanan:",
      transactionLookupError.message,
    );

    return reply({
      success: false,
      message: "Gagal membaca data pesanan.",
    }, 500);
  }

  let order: WebhookOrder | null = orderByTransactionId as
    WebhookOrder | null;

  // Dukungan untuk pesanan lama yang menggunakan UUID database
  // sebagai order_id Midtrans.
  if (!order && isUuid(midtransOrderId)) {
    const {
      data: orderByDatabaseId,
      error: databaseIdLookupError,
    } = await supabase
      .from("marketplace_orders")
      .select(orderSelect)
      .eq("id", midtransOrderId)
      .maybeSingle();

    if (databaseIdLookupError) {
      console.error(
        "Gagal membaca pesanan berdasarkan UUID:",
        databaseIdLookupError.message,
      );

      return reply({
        success: false,
        message: "Gagal membaca data pesanan.",
      }, 500);
    }

    order = orderByDatabaseId as WebhookOrder | null;
  }

  if (!order) {
    console.error("Pesanan tidak ditemukan:", midtransOrderId);

    return reply({
      success: false,
      message: "Pesanan tidak ditemukan.",
    }, 404);
  }

  const databaseOrderId = String(order.id);

  if (order.payment_provider !== "midtrans") {
    return reply({
      success: false,
      message: "Penyedia pembayaran tidak cocok.",
    }, 400);
  }

  if (
    order.provider_transaction_id != null &&
    String(order.provider_transaction_id) !== midtransOrderId
  ) {
    return reply({
      success: false,
      message: "Identitas pembayaran tidak cocok.",
    }, 400);
  }

  if (String(order.currency ?? "IDR").toUpperCase() !== "IDR") {
    return reply({
      success: false,
      message: "Mata uang pesanan tidak cocok.",
    }, 400);
  }

  if (!amountMatches(order.total_amount, grossAmount)) {
    console.error(
      "Nominal notifikasi tidak cocok:",
      databaseOrderId,
    );

    return reply({
      success: false,
      message: "Jumlah pembayaran tidak cocok.",
    }, 400);
  }

  // 3. Verifikasi ulang langsung ke API Midtrans.
  const apiBase = isProduction
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";

  let midtransStatus: JsonObject;

  try {
    const statusResponse = await fetch(
      `${apiBase}/v2/${encodeURIComponent(midtransOrderId)}/status`,
      {
        method: "GET",
        headers: {
          "Authorization": `Basic ${btoa(serverKey + ":")}`,
          "Accept": "application/json",
        },
      },
    );

    const responseText = await statusResponse.text();

    if (!statusResponse.ok) {
      console.error(
        "Status API Midtrans gagal:",
        statusResponse.status,
        responseText,
      );

      return reply({
        success: false,
        message: "Status pembayaran belum dapat diverifikasi.",
      }, 502);
    }

    const parsedStatus: unknown = JSON.parse(responseText);

    if (
      typeof parsedStatus !== "object" ||
      parsedStatus === null ||
      Array.isArray(parsedStatus)
    ) {
      return reply({
        success: false,
        message: "Respons status Midtrans tidak valid.",
      }, 502);
    }

    midtransStatus = parsedStatus as JsonObject;
  } catch (error) {
    console.error(
      "Kesalahan menghubungi Midtrans:",
      error instanceof Error ? error.message : String(error),
    );

    return reply({
      success: false,
      message: "Gagal memverifikasi pembayaran ke Midtrans.",
    }, 502);
  }

  if (
    String(midtransStatus.order_id ?? "") !== midtransOrderId ||
    !amountMatches(order.total_amount, midtransStatus.gross_amount)
  ) {
    console.error(
      "Data Status API tidak cocok:",
      databaseOrderId,
    );

    return reply({
      success: false,
      message: "Data transaksi Midtrans tidak cocok.",
    }, 400);
  }

  const transactionStatus = String(
    midtransStatus.transaction_status ?? "",
  ).toLowerCase();

  const paid = isPaidStatus(midtransStatus);

  // 4. Simpan peristiwa yang telah lolos verifikasi.
  // Fingerprint stabil + indeks unik mencegah event duplikat.
  const eventResult = await recordVerifiedPaymentEvent(
    supabase,
    {
      orderId: databaseOrderId,
      midtransOrderId,
      notification,
      midtransStatus,
    },
  );

  if (eventResult.error || !eventResult.id) {
    return reply({
      success: false,
      message: "Gagal mencatat peristiwa pembayaran.",
      order_id: databaseOrderId,
    }, 500);
  }

  const paymentEventId = eventResult.id;

  // 5. Pesanan yang sudah dibatalkan tidak boleh otomatis
  // berubah menjadi paid kembali.
  if (order.status === "cancelled") {
    if (paid) {
      const { data: reviewOrder, error: reviewError } = await supabase
        .from("marketplace_orders")
        .update({
          payment_review_required: true,
          payment_review_note:
            "Midtrans melaporkan pembayaran berhasil setelah pesanan dibatalkan. Perlu pemeriksaan manual.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", databaseOrderId)
        .eq("status", "cancelled")
        .select("id")
        .maybeSingle();

      if (reviewError || !reviewOrder?.id) {
        console.error(
          "Gagal menandai pemeriksaan manual:",
          reviewError?.message ?? "Status pesanan berubah sebelum penandaan manual tersimpan.",
        );

        return reply({
          success: false,
          message: "Gagal mencatat pemeriksaan pembayaran.",
        }, 500);
      }

      const processedError = await markPaymentEventProcessed(
        supabase,
        paymentEventId,
      );

      if (processedError) {
        return reply({
          success: false,
          message: "Pemeriksaan manual tercatat, tetapi pencatatan event belum selesai.",
          order_id: databaseOrderId,
        }, 500);
      }

      return reply({
        success: true,
        message:
          "Pesanan dibatalkan; pembayaran perlu pemeriksaan manual.",
        order_id: databaseOrderId,
        license_issued: false,
        manual_review: true,
      });
    }

    const processedError = await markPaymentEventProcessed(
      supabase,
      paymentEventId,
    );

    if (processedError) {
      return reply({
        success: false,
        message: "Gagal menyelesaikan pencatatan peristiwa pembayaran.",
      }, 500);
    }

    return reply({
      success: true,
      message: "Pesanan tetap dibatalkan.",
      order_id: databaseOrderId,
      transaction_status: transactionStatus,
      license_issued: false,
    });
  }

  // 6. Jalur pembayaran berhasil.
  if (paid) {
    let paidOrder: WebhookOrder = order;

    if (order.status === "pending_payment") {
      const paidAt = new Date().toISOString();

      const {
        data: updatedOrder,
        error: updateError,
      } = await supabase
        .from("marketplace_orders")
        .update({
          status: "paid",
          provider_transaction_id: midtransOrderId,
          paid_at: paidAt,
          updated_at: paidAt,
        })
        .eq("id", databaseOrderId)
        .eq("status", "pending_payment")
        .select(orderSelect)
        .maybeSingle();

      if (updateError) {
        console.error(
          "Gagal memperbarui status pembayaran:",
          updateError.message,
        );

        return reply({
          success: false,
          message: "Gagal memperbarui status pembayaran.",
        }, 500);
      }

      if (updatedOrder) {
        paidOrder = updatedOrder as WebhookOrder;
      } else {
        const {
          data: latestOrder,
          error: latestError,
        } = await supabase
          .from("marketplace_orders")
          .select(orderSelect)
          .eq("id", databaseOrderId)
          .maybeSingle();

        if (latestError || !latestOrder) {
          console.error(
            "Gagal membaca ulang pesanan:",
            latestError?.message,
          );

          return reply({
            success: false,
            message: "Status pesanan perlu diperiksa ulang.",
          }, 500);
        }

        paidOrder = latestOrder as WebhookOrder;
      }
    }

    if (paidOrder.status === "cancelled") {
      // Pembayaran berhasil tiba saat pesanan dibatalkan (race condition).
      // Jangan mengubah pesanan kembali menjadi paid secara otomatis.
      const { data: reviewOrder, error: reviewError } = await supabase
        .from("marketplace_orders")
        .update({
          payment_review_required: true,
          payment_review_note:
            "Midtrans mengonfirmasi pembayaran saat status pesanan berubah menjadi cancelled. Perlu pemeriksaan manual sebelum komisi/lisensi diproses.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", databaseOrderId)
        .eq("status", "cancelled")
        .select("id")
        .maybeSingle();

      if (reviewError || !reviewOrder?.id) {
        console.error(
          "Gagal menandai pembayaran untuk pemeriksaan manual:",
          reviewError?.message ?? "Status pesanan berubah sebelum penandaan manual tersimpan.",
        );
        return reply({
          success: false,
          message: "Pembayaran terverifikasi tetapi penandaan pemeriksaan manual gagal.",
          order_id: databaseOrderId,
        }, 500);
      }

      const processedError = await markPaymentEventProcessed(
        supabase,
        paymentEventId,
      );
      if (processedError) {
        return reply({
          success: false,
          message: "Pemeriksaan manual tercatat, tetapi event belum ditandai selesai.",
          order_id: databaseOrderId,
        }, 500);
      }

      return reply({
        success: true,
        message: "Pembayaran terverifikasi pada pesanan batal; perlu pemeriksaan manual.",
        order_id: databaseOrderId,
        order_status: "cancelled",
        manual_review: true,
        license_issued: false,
      });
    }

    if (paidOrder.status !== "paid") {
      // Jangan ACK notifikasi pembayaran sebagai sukses bila status order
      // belum konsisten. HTTP 500 meminta pengiriman ulang untuk pemulihan.
      console.error(
        "Pembayaran terverifikasi tetapi status pesanan belum paid:",
        databaseOrderId,
        paidOrder.status,
      );
      return reply({
        success: false,
        message:
          "Pembayaran terverifikasi, tetapi status pesanan belum konsisten. Perlu percobaan ulang atau pemeriksaan.",
        order_id: databaseOrderId,
        order_status: paidOrder.status,
      }, 500);
    }

    const auditReviewNote =
      "Audit 31-10-2026: status pesanan paid belum didukung event Midtrans berstatus verified dan processed. Tahan pengiriman, aktivasi lisensi dari pesanan ini, dan pencairan sampai rekonsiliasi pembayaran selesai.";

    // Lepaskan hanya penanda audit otomatis ini setelah webhook saat ini
    // lolos signature, Status API, nominal, mata uang, dan identitas transaksi.
    // Catatan pemeriksaan manual lain tidak pernah dibersihkan otomatis.
    if (
      paidOrder.payment_review_required &&
      paidOrder.payment_review_note?.trim() === auditReviewNote
    ) {
      const { data: clearedOrder, error: clearReviewError } = await supabase
        .from("marketplace_orders")
        .update({
          payment_review_required: false,
          payment_review_note: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", databaseOrderId)
        .eq("status", "paid")
        .eq("payment_review_required", true)
        .eq("payment_review_note", auditReviewNote)
        .select(orderSelect)
        .maybeSingle();

      if (clearReviewError || !clearedOrder) {
        console.error(
          "Gagal menyelesaikan penanda audit setelah verifikasi Midtrans:",
          clearReviewError?.message ?? "Pesanan berubah sebelum penanda audit dilepas.",
        );
        return reply({
          success: false,
          message: "Pembayaran terverifikasi, tetapi penanda pemeriksaan belum dapat diperbarui. Kirim ulang notifikasi.",
          order_id: databaseOrderId,
        }, 500);
      }

      paidOrder = clearedOrder as WebhookOrder;
    }

    if (paidOrder.payment_review_required) {
      const processedError = await markPaymentEventProcessed(
        supabase,
        paymentEventId,
      );

      if (processedError) {
        return reply({
          success: false,
          message: "Gagal menyelesaikan pencatatan peristiwa pembayaran.",
        }, 500);
      }

      return reply({
        success: true,
        message:
          "Pesanan memerlukan pemeriksaan manual; komisi dan lisensi tidak diproses otomatis.",
        order_id: databaseOrderId,
        license_issued: false,
        manual_review: true,
      });
    }

    // Perbaikan untuk pesanan lama yang sudah paid tetapi
    // ID transaksi belum tersimpan.
    if (paidOrder.provider_transaction_id == null) {
      const {
        error: transactionIdUpdateError,
      } = await supabase
        .from("marketplace_orders")
        .update({
          provider_transaction_id: midtransOrderId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", databaseOrderId)
        .is("provider_transaction_id", null);

      if (transactionIdUpdateError) {
        console.error(
          "Gagal menyimpan ID transaksi:",
          transactionIdUpdateError.message,
        );

        return reply({
          success: false,
          message: "Gagal menyimpan ID transaksi pembayaran.",
          order_id: databaseOrderId,
        }, 500);
      }
    } else if (
      String(paidOrder.provider_transaction_id) !== midtransOrderId
    ) {
      return reply({
        success: false,
        message: "ID transaksi pembayaran tidak cocok.",
        order_id: databaseOrderId,
      }, 400);
    }

    if (!paidOrder.paid_at) {
      console.error(
        "Pesanan paid tidak memiliki paid_at:",
        databaseOrderId,
      );

      return reply({
        success: false,
        message: "Waktu pembayaran belum tercatat. Perlu pemeriksaan.",
      }, 500);
    }

    // 7. Catat komisi setelah status paid terverifikasi.
    // Bila gagal, webhook mengembalikan 500 agar bisa dicoba ulang.
    // Kunci idempotency_key mencegah komisi ganda saat percobaan ulang.
    const commissionResult = await recordCommissionForPaidOrder(
      supabase,
      databaseOrderId,
      paymentEventId,
    );

    if (!commissionResult.success) {
      return reply({
        success: false,
        message:
          "Pembayaran berhasil, tetapi pencatatan komisi gagal dan perlu dicoba ulang.",
        order_id: databaseOrderId,
      }, 500);
    }

    // 8. Pertahankan aktivasi lisensi produk ID 7.
    const licenseResult = await issueLicenseIfApplicable(
      supabase,
      databaseOrderId,
    );

    if (licenseResult.error) {
      // Pembayaran dan komisi sudah diverifikasi. Jangan memaksa lisensi
      // melewati validasi; tandai untuk pemeriksaan manual dan ACK webhook
      // agar Midtrans tidak terus mengulang notifikasi yang sama.
      const { data: reviewOrder, error: reviewError } = await supabase
        .from("marketplace_orders")
        .update({
          payment_review_required: true,
          payment_review_note:
            "Pembayaran terverifikasi, tetapi penerbitan lisensi gagal divalidasi. Perlu pemeriksaan manual sebelum lisensi diterbitkan.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", databaseOrderId)
        .eq("status", "paid")
        .select("id")
        .maybeSingle();

      if (reviewError || !reviewOrder?.id) {
        console.error(
          "Gagal menandai pesanan untuk pemeriksaan lisensi manual:",
          reviewError?.message ?? "Baris pesanan tidak diperbarui.",
        );
        return reply({
          success: false,
          message: "Penerbitan lisensi gagal dan penandaan pemeriksaan manual belum tersimpan.",
          order_id: databaseOrderId,
        }, 500);
      }

      const processedError = await markPaymentEventProcessed(
        supabase,
        paymentEventId,
      );

      if (processedError) {
        return reply({
          success: false,
          message: "Pesanan ditandai untuk pemeriksaan manual, tetapi event belum ditandai selesai.",
          order_id: databaseOrderId,
        }, 500);
      }

      console.error(
        "Lisensi perlu pemeriksaan manual; validasi tetap diberlakukan:",
        databaseOrderId,
        licenseResult.error,
      );

      return reply({
        success: true,
        message: "Pembayaran terverifikasi. Penerbitan lisensi ditahan untuk pemeriksaan manual.",
        order_id: databaseOrderId,
        order_status: "paid",
        license_issued: false,
        manual_review: true,
      });
    }

    // Tandai event selesai hanya setelah pekerjaan utamanya berhasil.
    const processedError = await markPaymentEventProcessed(
      supabase,
      paymentEventId,
    );

    if (processedError) {
      return reply({
        success: false,
        message:
          "Pembayaran terverifikasi; komisi tercatat, tetapi penanda event belum selesai.",
        order_id: databaseOrderId,
      }, 500);
    }

    return reply({
      success: true,
      message:
        "Pembayaran terverifikasi; pencatatan peristiwa dan komisi selesai.",
      order_id: databaseOrderId,
      order_status: "paid",
      commission_rate: 0.025,
      commission_recorded: true,
      license_issued: licenseResult.applicable,
      license_result: licenseResult.result ?? null,
    });
  }

  // 9. Proses transaksi yang batal/kedaluwarsa.
  const terminalStatuses = [
    "expire",
    "cancel",
    "deny",
    "failure",
  ];

  if (
    terminalStatuses.includes(transactionStatus) &&
    order.status === "pending_payment"
  ) {
    const {
      data: expireResult,
      error: expireError,
    } = await supabase.rpc("expire_marketplace_order", {
      p_order_id: databaseOrderId,
      p_transaction_id: midtransOrderId,
    });

    if (expireError) {
      console.error(
        "Gagal memproses pesanan batal/kedaluwarsa:",
        expireError.message,
      );

      return reply({
        success: false,
        message: "Gagal memproses pesanan yang batal.",
      }, 500);
    }

    // RPC dapat berhasil pada level SQL tetapi mengembalikan success:false
    // di JSON. Jangan tandai event selesai kecuali pembatalan terkonfirmasi.
    if (
      typeof expireResult !== "object" ||
      expireResult === null ||
      (expireResult as JsonObject).success !== true
    ) {
      console.error(
        "Pembatalan/kedaluwarsa tidak dikonfirmasi:",
        JSON.stringify(expireResult),
      );
      return reply({
        success: false,
        message:
          "Pembatalan belum berhasil dikonfirmasi. Event belum ditandai selesai.",
        order_id: databaseOrderId,
        result: expireResult ?? null,
      }, 500);
    }

    const processedError = await markPaymentEventProcessed(
      supabase,
      paymentEventId,
    );

    if (processedError) {
      return reply({
        success: false,
        message: "Status pesanan diproses, tetapi pencatatan event belum selesai.",
      }, 500);
    }

    return reply({
      success: true,
      message: "Status pesanan batal/kedaluwarsa telah diproses.",
      order_id: databaseOrderId,
      transaction_status: transactionStatus,
      result: expireResult ?? null,
    });
  }

  const processedError = await markPaymentEventProcessed(
    supabase,
    paymentEventId,
  );

  if (processedError) {
    return reply({
      success: false,
      message: "Gagal menyelesaikan pencatatan peristiwa pembayaran.",
    }, 500);
  }

  return reply({
    success: true,
    message:
      "Notifikasi diterima; pembayaran belum terverifikasi lunas.",
    order_id: databaseOrderId,
    transaction_status: transactionStatus,
    license_issued: false,
  });
});
