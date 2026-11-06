
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

// Midtrans mengirim waktu transaksi dalam WIB (GMT+7). settlement_time
// lebih tepat untuk urutan pembayaran; transaction_time menjadi fallback.
function midtransPaidAt(status: JsonObject): string | null {
  const candidates = [status.settlement_time, status.transaction_time]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);

  for (const raw of candidates) {
    const match = raw.match(
      /^(\\d{4})-(\\d{2})-(\\d{2})[ Tt](\\d{2}):(\\d{2}):(\\d{2})(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})?$/i,
    );
    if (!match) continue;

    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , timezone] = match;
    const year = Number(yearText), month = Number(monthText), day = Number(dayText);
    const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
    if (year < 1000 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) continue;

    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year ||
        calendarDate.getUTCMonth() !== month - 1 ||
        calendarDate.getUTCDate() !== day) continue;

    if (timezone && !/^Z$/i.test(timezone)) {
      const offset = timezone.match(/^[+-](\\d{2}):?(\\d{2})$/);
      if (!offset) continue;
      const offsetHours = Number(offset[1]), offsetMinutes = Number(offset[2]);
      if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) continue;
    }

    const normalized = raw.replace(/[ Tt]/, "T");
    const iso = timezone ? normalized : normalized + "+07:00";
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
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
    refund_amount: String(midtransStatus.refund_amount ?? notification.refund_amount ?? ""),
    refund_chargeback_id: String(midtransStatus.refund_chargeback_id ?? notification.refund_chargeback_id ?? ""),
    refund_key: String(midtransStatus.refund_key ?? notification.refund_key ?? ""),
    bank_confirmed_at: String(midtransStatus.bank_confirmed_at ?? notification.bank_confirmed_at ?? ""),
    refunds: midtransStatus.refunds ?? notification.refunds ?? null,
  });

  const providerEventId = await sha256(fingerprintSource);

  const safeStatusPayload: JsonObject = { ...midtransStatus };
  delete safeStatusPayload.signature_key;
  const payload: JsonObject = {
    notification: safeNotificationPayload(notification),
    verified_status: safeStatusPayload,
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

  // Komisi hanya boleh dikaitkan ke event pembayaran yang telah diverifikasi
  // untuk pesanan yang sama. Event masih boleh belum processed karena fungsi
  // ini dipanggil sebelum markPaymentEventProcessed pada alur webhook.
  const { data: verifiedEvent, error: verifiedEventError } = await supabase
    .from("marketplace_payment_events")
    .select("id, order_id, verification_status")
    .eq("id", paymentEventId)
    .eq("order_id", orderId)
    .eq("verification_status", "verified")
    .maybeSingle();

  if (verifiedEventError || !verifiedEvent) {
    const message = verifiedEventError?.message ??
      "Event pembayaran tidak terverifikasi untuk pesanan ini.";
    console.error("Komisi ditahan karena event pembayaran belum terverifikasi:", message);
    return { success: false, error: message };
  }

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
    if ([7, 8, 9, 10].includes(Number(item.product_id))) continue;

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
      // Perbarui event pembayaran pada baris lama dengan event terverifikasi
      // terbaru; kunci unik tetap mencegah pembuatan komisi ganda.
      ignoreDuplicates: false,
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
      "order_item_id, entry_type, commission_rate, calculation_base, amount, idempotency_key, payment_event_id",
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
      Number(saved.amount) === Number(expected.amount) &&
      String(saved.payment_event_id) === String(expected.payment_event_id);

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
    .in("product_id", [7, 8, 9, 10])
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
  // Mode harus eksplisit. Production memakai secret khusus agar kunci Sandbox
  // tidak pernah dipakai untuk memproses pembayaran uang sungguhan.
  const configuredMode = String(Deno.env.get("MIDTRANS_IS_PRODUCTION") ?? "").trim().toLowerCase();
  if (configuredMode !== "false" && configuredMode !== "true") {
    return reply({
      success: false,
      code: "PAYMENT_MODE_INVALID",
      message: "Mode pembayaran belum dikonfigurasi dengan benar.",
    }, 503);
  }
  const isProduction = configuredMode === "true";
  const serverKey = isProduction
    ? Deno.env.get("MIDTRANS_SERVER_KEY_PRODUCTION")
    : (Deno.env.get("MIDTRANS_SERVER_KEY_SANDBOX") || Deno.env.get("MIDTRANS_SERVER_KEY"));
  if (isProduction && !serverKey) {
    return reply({
      success: false,
      code: "PRODUCTION_KEY_MISSING",
      message: "Kunci server Midtrans Production belum dikonfigurasi.",
    }, 503);
  }

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
  // Normalize harmless formatting differences while preserving the exact signed fields.
  const signatureKey = String(notification.signature_key ?? "").trim().toLowerCase();

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

  const notificationSignatureValid = constantTimeEqual(
    expectedSignature,
    signatureKey,
  );

  // Jika signature notifikasi tidak cocok, jangan langsung mengubah pesanan.
  // Lanjutkan hanya untuk melakukan verifikasi independen ke Status API Midtrans
  // menggunakan Server Key. Status API harus mengonfirmasi identitas dan nominal
  // transaksi sebelum event dapat disimpan atau pesanan diproses.
  if (!notificationSignatureValid) {
    console.warn(
      "Signature notifikasi tidak cocok; verifikasi independen Status API diwajibkan.",
    );
  }

  // Pembayaran aktivasi ID Karyawan (KSEMP/KSDEV) tidak disimpan sebagai
  // marketplace_orders. Endpoint employee-device-activation memverifikasi
  // status transaksi langsung ke Midtrans saat Owner memuat daftar aktivasi.
  // Akui notifikasi bertanda tangan valid agar Midtrans tidak terus mengulang
  // callback yang memang bukan pesanan marketplace.
  if (/^(?:KSEMP|KSDEV)-[A-F0-9]{32}$/i.test(midtransOrderId)) {
    // Notifikasi aktivasi karyawan tidak diproses sebagai pesanan marketplace,
    // tetapi tetap wajib memiliki signature Midtrans yang valid sebelum diakui.
    // Verifikasi status/nominal pembayaran tetap dilakukan terpisah oleh
    // employee-device-activation melalui Status API Midtrans.
    if (!notificationSignatureValid) {
      return reply({
        success: false,
        code: "INVALID_NOTIFICATION_SIGNATURE",
        message: "Signature notifikasi aktivasi karyawan tidak valid.",
      }, 401);
    }

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

  const statusApiOrderMatches =
    String(midtransStatus.order_id ?? "") === midtransOrderId;
  const statusApiAmountMatches =
    amountMatches(order.total_amount, midtransStatus.gross_amount);
  const statusApiCurrencyMatches =
    String(midtransStatus.currency ?? "IDR").toUpperCase() === "IDR";
  const statusApiCodeValid =
    String(midtransStatus.status_code ?? "") === "200";
  const notificationTransactionId = String(
    notification.transaction_id ?? "",
  );
  const statusApiTransactionId = String(
    midtransStatus.transaction_id ?? "",
  );
  const transactionIdMatches =
    Boolean(statusApiTransactionId) &&
    (!notificationTransactionId || notificationTransactionId === statusApiTransactionId);

  if (
    !statusApiOrderMatches ||
    !statusApiAmountMatches ||
    !statusApiCurrencyMatches ||
    !statusApiCodeValid ||
    !transactionIdMatches
  ) {
    console.error(
      "Data Status API tidak cocok atau tidak sah:",
      databaseOrderId,
      {
        order_matches: statusApiOrderMatches,
        amount_matches: statusApiAmountMatches,
        currency_matches: statusApiCurrencyMatches,
        status_code_valid: statusApiCodeValid,
        transaction_id_matches: transactionIdMatches,
      },
    );

    return reply({
      success: false,
      message: "Data transaksi Midtrans tidak cocok atau belum dapat diverifikasi.",
    }, 400);
  }

  if (!notificationSignatureValid) {
    console.warn(
      "Notifikasi diterima melalui verifikasi independen Status API Midtrans:",
      databaseOrderId,
    );
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
    const providerPaidAt = midtransPaidAt(midtransStatus);
    if (!providerPaidAt) {
      console.error("Midtrans tidak memberikan waktu transaksi pembayaran yang valid:", databaseOrderId);
      return reply({
        success: false,
        message: "Waktu pembayaran dari Midtrans belum dapat dipastikan. Pesanan belum diproses.",
        order_id: databaseOrderId,
      }, 500);
    }

    if (order.status === "pending_payment") {
      const paidAt = providerPaidAt;

      const {
        data: updatedOrder,
        error: updateError,
      } = await supabase
        .from("marketplace_orders")
        .update({
          status: "paid",
          provider_transaction_id: midtransOrderId,
          paid_at: paidAt,
          updated_at: new Date().toISOString(),
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

    // paid_at harus mengikuti waktu Midtrans, bukan urutan kedatangan webhook.
    // Ini memperbaiki urutan pembelian pertama ketika notifikasi datang terlambat.
    if (paidOrder.paid_at !== providerPaidAt) {
      const { data: timestampOrder, error: timestampError } = await supabase
        .from("marketplace_orders")
        .update({ paid_at: providerPaidAt, updated_at: new Date().toISOString() })
        .eq("id", databaseOrderId)
        .eq("status", "paid")
        .eq("payment_review_required", false)
        .select(orderSelect)
        .maybeSingle();

      if (timestampError || !timestampOrder) {
        console.error("Gagal menyelaraskan waktu pembayaran dari Midtrans:", timestampError?.message);
        return reply({
          success: false,
          message: "Waktu pembayaran belum dapat diselaraskan. Webhook perlu dicoba ulang.",
          order_id: databaseOrderId,
        }, 500);
      }
      paidOrder = timestampOrder as WebhookOrder;
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

    // Komisi mitra lisensi terpisah dari komisi marketplace 2,5%.
    const licensePartnerCommission = await supabase.rpc("record_license_partner_commission", {
      p_order_id: databaseOrderId,
      p_payment_event_id: paymentEventId,
    });
    if (
      licensePartnerCommission.error ||
      !licensePartnerCommission.data ||
      (licensePartnerCommission.data as JsonObject).success !== true
    ) {
      console.error(
        "Komisi mitra lisensi gagal:",
        licensePartnerCommission.error?.message ?? JSON.stringify(licensePartnerCommission.data),
      );
      return reply({
        success: false,
        message: "Pembayaran berhasil, tetapi pencatatan komisi mitra lisensi belum selesai. Webhook perlu dicoba ulang.",
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

    // Pastikan tipe barang diketahui sebelum menandai event selesai.
    const { data: paidItems, error: paidItemsError } = await supabase
      .from("marketplace_order_items")
      .select("product_id")
      .eq("order_id", databaseOrderId);
    if (paidItemsError || !paidItems?.length) {
      console.error("Gagal memeriksa item untuk otomatisasi pengiriman:", paidItemsError?.message ?? "Rincian item kosong.");
      return reply({
        success: false,
        message: "Pembayaran terverifikasi, tetapi rincian barang belum dapat diperiksa untuk pengiriman.",
        order_id: databaseOrderId,
      }, 500);
    }
    const hasPhysicalItems = paidItems.some((item) => ![7, 8, 9, 10].includes(Number(item.product_id)));

    // Tandai event selesai setelah verifikasi pembayaran, komisi, lisensi,
    // dan rincian pesanan berhasil dipastikan. Fungsi pengiriman mensyaratkan
    // event ini sudah processed sebelum menerima perintah booking internal.
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

    let shipmentBooking: Record<string, unknown> | null = null;
    if (hasPhysicalItems) {
      const biteshipKeyForBooking = Deno.env.get("BITESHIP_API_KEY") || "";
      const isTestBiteshipKey = biteshipKeyForBooking.startsWith("biteship_test.");
      const isLiveBiteshipKey = biteshipKeyForBooking.startsWith("biteship_live.");
      const biteshipBookingEnabled =
        String(Deno.env.get("BITESHIP_ENABLE_SHIPMENT_BOOKING") ?? "").trim().toLowerCase() === "true" &&
        (isTestBiteshipKey ||
          (isLiveBiteshipKey && Deno.env.get("BITESHIP_PRODUCTION_BOOKING_ENABLED") === "true"));
      if (!biteshipBookingEnabled) {
        shipmentBooking = {
          attempted: false,
          enabled: false,
          message: "Pengiriman otomatis belum diaktifkan. Pesanan tetap paid; lengkapi konfigurasi Biteship sebelum booking.",
        };
      } else {
        try {
          const shipmentResponse = await fetch(
            supabaseUrl + "/functions/v1/biteship-create-shipment",
            {
              method: "POST",
              headers: {
                "Authorization": "Bearer " + serviceRoleKey,
                "apikey": serviceRoleKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ order_id: databaseOrderId }),
              signal: AbortSignal.timeout(25000),
            },
          );
          const shipmentData: unknown = await shipmentResponse.json().catch(() => null);
          if (shipmentResponse.ok && typeof shipmentData === "object" && shipmentData !== null && (shipmentData as JsonObject).success === true) {
            shipmentBooking = { attempted: true, success: true, result: shipmentData };
          } else {
            console.error("Booking Biteship otomatis belum berhasil:", {
              status: shipmentResponse.status,
              order_id: databaseOrderId,
              response: shipmentData,
            });
            shipmentBooking = {
              attempted: true,
              success: false,
              retry_or_manual_action_required: true,
              message: "Pembayaran sudah terverifikasi. Booking pengiriman belum berhasil; periksa data pengirim dan dashboard Biteship sebelum mencoba ulang.",
            };
          }
        } catch (shipmentError) {
          console.error("Panggilan internal Biteship gagal:", shipmentError instanceof Error ? shipmentError.message : String(shipmentError));
          shipmentBooking = {
            attempted: true,
            success: false,
            retry_or_manual_action_required: true,
            message: "Pembayaran sudah terverifikasi. Koneksi booking Biteship belum dapat dipastikan; periksa dashboard Biteship sebelum mencoba ulang.",
          };
        }
      }
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
      shipment_booking: shipmentBooking,
    });
  }

  // Refund/chargeback dapat terjadi setelah settlement. Jangan menganggapnya
  // sebagai notifikasi pending biasa: tahan akses dan komisi yang belum dibayar
  // untuk pemeriksaan manual. Tidak ada clawback otomatis untuk dana yang sudah
  // dibayarkan, dan refund parsial tidak otomatis mencabut seluruh lisensi.
  const reviewStatuses = [
    "refund",
    "partial_refund",
    "chargeback",
    "partial_chargeback",
  ];
  if (reviewStatuses.includes(transactionStatus)) {
    const refundAmount = String(midtransStatus.refund_amount ?? notification.refund_amount ?? "");
    const refundRows = Array.isArray(midtransStatus.refunds)
      ? midtransStatus.refunds
      : Array.isArray(notification.refunds)
      ? notification.refunds
      : [];
    const confirmedRefundRow = refundRows.find((row) =>
      typeof row === "object" &&
      row !== null &&
      Boolean(String((row as JsonObject).bank_confirmed_at ?? "").trim())
    ) as JsonObject | undefined;
    const bankConfirmedAt = String(
      midtransStatus.bank_confirmed_at ??
        notification.bank_confirmed_at ??
        confirmedRefundRow?.bank_confirmed_at ??
        "",
    );
    const reviewNote = [
      "Midtrans melaporkan status " + transactionStatus + ".",
      refundAmount ? "Nominal refund/chargeback: " + refundAmount + " IDR." : "",
      bankConfirmedAt ? "Konfirmasi bank: " + bankConfirmedAt + "." : "Konfirmasi bank belum terlihat pada notifikasi ini.",
      "Tahan pencairan dan lakukan pemeriksaan manual; jangan lakukan clawback otomatis.",
    ].filter(Boolean).join(" ");

    const { data: reviewOrder, error: reviewError } = await supabase
      .from("marketplace_orders")
      .update({
        payment_review_required: true,
        payment_review_note: reviewNote,
        updated_at: new Date().toISOString(),
      })
      .eq("id", databaseOrderId)
      .select("id")
      .maybeSingle();

    if (reviewError || !reviewOrder?.id) {
      console.error("Gagal menandai refund/chargeback untuk pemeriksaan manual:", reviewError?.message);
      return reply({
        success: false,
        message: "Status refund/chargeback terverifikasi, tetapi penanda pemeriksaan manual gagal disimpan.",
        order_id: databaseOrderId,
      }, 500);
    }

    const { error: holdPartnerError } = await supabase
      .from("license_partner_commission_ledger")
      .update({
        status: "held",
        available_at: null,
        reviewed_at: null,
        reviewed_by: null,
        notes: reviewNote,
      })
      .eq("order_id", databaseOrderId)
      .in("status", ["held", "approved"]);

    if (holdPartnerError) {
      console.error("Gagal menahan komisi mitra lisensi:", holdPartnerError.message);
      return reply({
        success: false,
        message: "Pesanan ditandai untuk pemeriksaan, tetapi penahanan komisi mitra belum berhasil.",
        order_id: databaseOrderId,
      }, 500);
    }

    // Komisi yang sudah dibayar tidak diubah nilainya atau di-clawback otomatis.
    // Tambahkan catatan agar admin meninjau payout yang mungkin sudah terjadi.
    const { data: paidPartnerRows, error: paidPartnerReadError } = await supabase
      .from("license_partner_commission_ledger")
      .select("id, notes")
      .eq("order_id", databaseOrderId)
      .eq("status", "paid");

    if (paidPartnerReadError) {
      console.error("Gagal membaca komisi mitra yang sudah dibayar:", paidPartnerReadError.message);
      return reply({
        success: false,
        message: "Pemeriksaan refund tersimpan, tetapi riwayat komisi yang sudah dibayar belum dapat dibaca.",
        order_id: databaseOrderId,
      }, 500);
    }

    for (const row of paidPartnerRows ?? []) {
      const priorNotes = String(row.notes ?? "").trim();
      const paidReviewNote = priorNotes.includes("REVIEW REFUND/CHARGEBACK:")
        ? priorNotes
        : [priorNotes, "REVIEW REFUND/CHARGEBACK:", reviewNote].filter(Boolean).join(" ");

      const { error: paidPartnerUpdateError } = await supabase
        .from("license_partner_commission_ledger")
        .update({ notes: paidReviewNote })
        .eq("id", row.id)
        .eq("status", "paid");

      if (paidPartnerUpdateError) {
        console.error("Gagal menambahkan catatan pemeriksaan pada komisi mitra yang sudah dibayar:", paidPartnerUpdateError.message);
        return reply({
          success: false,
          message: "Komisi yang sudah dibayar memerlukan pemeriksaan manual; catatan audit belum berhasil disimpan.",
          order_id: databaseOrderId,
        }, 500);
      }
    }

    const processedReviewError = await markPaymentEventProcessed(supabase, paymentEventId);
    if (processedReviewError) {
      return reply({
        success: false,
        message: "Pemeriksaan refund/chargeback tersimpan, tetapi event belum ditandai selesai.",
        order_id: databaseOrderId,
      }, 500);
    }

    return reply({
      success: true,
      message: "Refund/chargeback terverifikasi dan pesanan ditahan untuk pemeriksaan manual. Tidak ada pencabutan lisensi atau clawback otomatis.",
      order_id: databaseOrderId,
      transaction_status: transactionStatus,
      refund_amount: refundAmount || null,
      bank_confirmed_at: bankConfirmedAt || null,
      manual_review: true,
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
