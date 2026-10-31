import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type Obj = Record<string, unknown>;

type MidStatus = {
  order_id?: string;
  status_code?: string;
  status_message?: string;
  transaction_status?: string;
  fraud_status?: string;
  gross_amount?: string | number;
  currency?: string;
};

type SnapResult = {
  token?: string;
  redirect_url?: string;
  status_code?: string;
  status_message?: string;
  error_messages?: string[];
};

type CheckResult = {
  kind: "found" | "not_found" | "error";
  data?: MidStatus;
  httpStatus?: number;
};

function reply(body: Obj, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function validOrderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    /^[A-Za-z0-9_.~-]+$/.test(value)
  );
}

function newAttemptId(): string {
  return "KS-" + crypto.randomUUID().replace(/-/g, "");
}

function successful(data: MidStatus): boolean {
  const status = norm(data.transaction_status);
  const fraudStatus = norm(data.fraud_status);
  return (
    String(data.status_code ?? "") === "200" &&
    (fraudStatus === "" || fraudStatus === "accept") &&
    (status === "settlement" ||
      (status === "capture" && fraudStatus === "accept"))
  );
}

function pending(data: MidStatus): boolean {
  return ["pending", "authorize"].includes(
    norm(data.transaction_status),
  );
}

function terminal(data: MidStatus): boolean {
  return ["expire", "cancel", "deny", "failure"].includes(
    norm(data.transaction_status),
  );
}

/**
 * Memvalidasi URL Snap dari Midtrans.
 *
 * Format Snap yang diterima:
 * - /snap/v2/vtweb/{token}
 * - /snap/v2/redirection/{token}
 * - /snap/v3/redirect/{token}
 * - /snap/v4/redirection/{token}
 *
 * Host harus sesuai dengan mode Sandbox atau Production.
 */
function validRedirect(
  value: unknown,
  production: boolean,
): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    const host = production
      ? "app.midtrans.com"
      : "app.sandbox.midtrans.com";

    const pathValid =
      /^\/snap\/v2\/vtweb\/[^/]+\/?$/.test(url.pathname) ||
      /^\/snap\/v2\/redirection\/[^/]+\/?$/.test(url.pathname) ||
      /^\/snap\/v3\/redirect\/[^/]+\/?$/.test(url.pathname) ||
      /^\/snap\/v4\/redirection\/[^/]+\/?$/.test(url.pathname);

    return (
      url.protocol === "https:" &&
      url.hostname === host &&
      !url.username &&
      !url.password &&
      !url.port &&
      pathValid
    );
  } catch {
    return false;
  }
}

function validFinishUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

function diagnostic(
  data?: MidStatus,
  httpStatus?: number,
): Obj {
  return {
    http_status: httpStatus ?? null,
    status_code: data?.status_code ?? null,
    transaction_status: data?.transaction_status ?? null,
    fraud_status: data?.fraud_status ?? null,
    status_message: data?.status_message ?? null,
  };
}

function midtransError(
  data: SnapResult,
  status: number,
): string {
  if (Array.isArray(data.error_messages)) {
    const messages = data.error_messages.filter(
      (item): item is string => typeof item === "string",
    );

    if (messages.length) {
      return messages.join(" | ").slice(0, 700);
    }
  }

  if (typeof data.status_message === "string") {
    return data.status_message.slice(0, 500);
  }

  return "Midtrans HTTP " + status;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return reply(
      {
        success: false,
        error: "Metode tidak diizinkan.",
      },
      405,
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");

    const production =
      norm(Deno.env.get("MIDTRANS_IS_PRODUCTION")) === "true";

    const finishUrl = "https://kasusaha-lite.pages.dev/?payment=return";

    if (!supabaseUrl || !serviceKey || !serverKey) {
      console.error("Payment configuration is incomplete.");

      return reply(
        {
          success: false,
          code: "PAYMENT_CONFIG_MISSING",
          error: "Konfigurasi pembayaran di server belum lengkap.",
        },
        500,
      );
    }

    if (finishUrl && !validFinishUrl(finishUrl)) {
      return reply(
        {
          success: false,
          code: "INVALID_FINISH_URL",
          error:
            "MIDTRANS_FINISH_URL harus berupa URL HTTPS yang valid.",
        },
        500,
      );
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      return reply(
        {
          success: false,
          error: "Silakan login terlebih dahulu.",
        },
        401,
      );
    }

    let body: { order_id?: unknown };

    try {
      body = await req.json();
    } catch {
      return reply(
        {
          success: false,
          error: "Format permintaan JSON tidak valid.",
        },
        400,
      );
    }

    if (!validOrderId(body.order_id)) {
      return reply(
        {
          success: false,
          error: "ID pesanan tidak valid.",
        },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: auth, error: authError } =
      await supabase.auth.getUser(match[1]);

    if (authError || !auth.user) {
      return reply(
        {
          success: false,
          error: "Sesi login tidak valid. Silakan login kembali.",
        },
        401,
      );
    }

    const user = auth.user;

    const { data: order, error: orderError } = await supabase
      .from("marketplace_orders")
      .select(
        "id,buyer_id,buyer_name,buyer_phone,status,currency,total_amount,payment_provider,provider_transaction_id,payment_redirect_url,payment_review_required,payment_review_note,shipping_provider,shipping_amount,shipping_courier_code,shipping_service_code,destination_postal_code",
      )
      .eq("id", body.order_id)
      .eq("buyer_id", user.id)
      .maybeSingle();

    if (orderError) {
      console.error("Order lookup:", orderError.message);

      return reply(
        {
          success: false,
          error: "Gagal membaca pesanan dari database.",
        },
        500,
      );
    }

    if (!order) {
      return reply(
        {
          success: false,
          error: "Pesanan tidak ditemukan atau bukan milik akun Anda.",
        },
        404,
      );
    }

    if (order.payment_review_required === true) {
      return reply({
        success: false,
        code: "ORDER_REQUIRES_REVIEW",
        error: "Pembayaran ditahan karena data pesanan atau ongkir perlu diperiksa. Jangan melakukan pembayaran dahulu; hubungi dukungan dengan nomor pesanan.",
      }, 409);
    }

    const { data: orderItemsForShipping, error: shippingItemsError } = await supabase
      .from("marketplace_order_items")
      .select("product_id")
      .eq("order_id", order.id);
    if (shippingItemsError || !orderItemsForShipping?.length) {
      return reply({ success: false, error: "Rincian pesanan belum dapat diverifikasi." }, 500);
    }
    const hasPhysicalProduct = orderItemsForShipping.some((item) => Number(item.product_id) !== 7);
    if (hasPhysicalProduct && (
      order.shipping_provider !== "Biteship" ||
      !order.shipping_courier_code ||
      !order.shipping_service_code ||
      !order.destination_postal_code ||
      !Number.isFinite(Number(order.shipping_amount)) ||
      Number(order.shipping_amount) < 0
    )) {
      return reply({
        success: false,
        code: "SHIPPING_NOT_READY",
        error: "Pesanan barang fisik belum memiliki tarif Biteship yang tervalidasi. Kembali ke Keranjang, cek ongkir, dan buat pesanan baru jika pesanan ini belum tercatat.",
      }, 409);
    }

    if (norm(order.status) === "paid") {
      return reply(
        {
          success: false,
          code: "ORDER_ALREADY_PAID",
          error: "Pesanan ini sudah dibayar.",
        },
        409,
      );
    }

    if (norm(order.status) !== "pending_payment") {
      return reply(
        {
          success: false,
          error: "Status pesanan tidak mengizinkan pembayaran.",
        },
        409,
      );
    }

    const amount = Number(order.total_amount);
    const currency = String(order.currency ?? "IDR").toUpperCase();

    if (
      currency !== "IDR" ||
      !Number.isSafeInteger(amount) ||
      amount < 1
    ) {
      return reply(
        {
          success: false,
          error: "Nominal atau mata uang pesanan tidak valid.",
        },
        400,
      );
    }

    const statusBase = production
      ? "https://api.midtrans.com"
      : "https://api.sandbox.midtrans.com";

    const snapBase = production
      ? "https://app.midtrans.com"
      : "https://app.sandbox.midtrans.com";

    const authHeader = "Basic " + btoa(serverKey + ":");

    async function checkStatus(id: string): Promise<CheckResult> {
      try {
        const response = await fetch(
          statusBase + "/v2/" + encodeURIComponent(id) + "/status",
          {
            method: "GET",
            headers: {
              Authorization: authHeader,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(15000),
          },
        );

        const data = (
          await response.json().catch(() => ({}))
        ) as MidStatus;

        if (
          response.status === 404 ||
          String(data.status_code ?? "") === "404"
        ) {
          return {
            kind: "not_found",
            data,
            httpStatus: response.status,
          };
        }

        if (!response.ok) {
          console.error(
            "Midtrans status check:",
            JSON.stringify(diagnostic(data, response.status)),
          );

          return {
            kind: "error",
            data,
            httpStatus: response.status,
          };
        }

        if (
          data.order_id !== id ||
          !data.transaction_status ||
          !Number.isFinite(Number(data.gross_amount)) ||
          Number(data.gross_amount) !== amount ||
          (data.currency != null && norm(data.currency) !== "idr")
        ) {
          return {
            kind: "error",
            data,
            httpStatus: response.status,
          };
        }

        return {
          kind: "found",
          data,
          httpStatus: response.status,
        };
      } catch (error) {
        console.error(
          "Midtrans status request failed:",
          error instanceof Error
            ? error.message
            : "Unknown error",
        );

        return { kind: "error" };
      }
    }

    const savedId =
      typeof order.provider_transaction_id === "string" &&
      order.provider_transaction_id.trim()
        ? order.provider_transaction_id.trim()
        : null;

    const existingId =
      savedId ??
      (norm(order.payment_provider) === "midtrans"
        ? order.id
        : null);

    const savedUrl = validRedirect(
      order.payment_redirect_url,
      production,
    )
      ? order.payment_redirect_url
      : null;

    let replaceId: string | null = savedId;

    if (existingId) {
      const previous = await checkStatus(existingId);

      if (previous.kind === "error") {
        return reply(
          {
            success: false,
            code: "MIDTRANS_STATUS_CHECK_FAILED",
            error:
              "Status transaksi belum dapat dipastikan. Periksa dashboard Midtrans sebelum mencoba kembali.",
            diagnostic: diagnostic(
              previous.data,
              previous.httpStatus,
            ),
          },
          502,
        );
      }

      if (previous.kind === "found" && previous.data) {
        if (successful(previous.data)) {
          return reply(
            {
              success: false,
              code: "MIDTRANS_ALREADY_SUCCESSFUL",
              error:
                "Midtrans mencatat transaksi berhasil. Periksa webhook dan status pesanan.",
              diagnostic: diagnostic(
                previous.data,
                previous.httpStatus,
              ),
            },
            409,
          );
        }

        if (pending(previous.data)) {
          if (savedUrl) {
            return reply({
              success: true,
              order_id: order.id,
              redirect_url: savedUrl,
              payment_url: savedUrl,
              payment_redirect_url: savedUrl,
              reused_transaction: true,
            });
          }

          return reply(
            {
              success: false,
              code: "MIDTRANS_PENDING_URL_MISSING",
              error:
                "Transaksi masih aktif, tetapi URL pembayaran tidak tersimpan. Jangan membuat transaksi baru sebelum memeriksa dashboard Midtrans.",
            },
            409,
          );
        }

        if (!terminal(previous.data)) {
          return reply(
            {
              success: false,
              code: "MIDTRANS_STATUS_UNKNOWN",
              error: "Status transaksi Midtrans belum dikenali.",
              diagnostic: diagnostic(
                previous.data,
                previous.httpStatus,
              ),
            },
            409,
          );
        }

        replaceId = savedId;
      } else if (
        previous.kind === "not_found" &&
        savedId
      ) {
        if (savedUrl) {
          return reply({
            success: true,
            order_id: order.id,
            transaction_id: savedId,
            redirect_url: savedUrl,
            payment_url: savedUrl,
            payment_redirect_url: savedUrl,
            reused_transaction: true,
            status_check_pending: true,
          });
        }

        return reply(
          {
            success: false,
            code: "MIDTRANS_TRANSACTION_UNCONFIRMED",
            error:
              "ID transaksi tersimpan tetapi belum ditemukan di Midtrans dan URL pembayaran belum tersedia. Periksa dashboard Midtrans sebelum mencoba kembali.",
          },
          409,
        );
      }

      const old = await checkStatus(order.id);

      if (old.kind === "error") {
        return reply(
          {
            success: false,
            code: "MIDTRANS_BASE_STATUS_CHECK_FAILED",
            error: "Status transaksi lama belum dapat dipastikan.",
            diagnostic: diagnostic(old.data, old.httpStatus),
          },
          502,
        );
      }

      if (old.kind === "found" && old.data) {
        if (successful(old.data) || pending(old.data)) {
          return reply(
            {
              success: false,
              code: "MIDTRANS_EXISTING_TRANSACTION",
              error:
                "Transaksi lama ditemukan di Midtrans. Periksa dashboard sebelum membuat pembayaran baru.",
              diagnostic: diagnostic(
                old.data,
                old.httpStatus,
              ),
            },
            409,
          );
        }

        if (!terminal(old.data)) {
          return reply(
            {
              success: false,
              code: "MIDTRANS_BASE_STATUS_UNKNOWN",
              error: "Status transaksi lama belum dikenali.",
              diagnostic: diagnostic(
                old.data,
                old.httpStatus,
              ),
            },
            409,
          );
        }
      }
    }

    const attemptId = newAttemptId();

    // Cadangkan ID transaksi dengan update bersyarat.
    // Permintaan yang tidak cocok dengan ID lama tidak boleh
    // mengambil alih reservasi transaksi yang sudah ada.
    let reserveQuery = supabase
      .from("marketplace_orders")
      .update({
        payment_provider: "midtrans",
        provider_transaction_id: attemptId,
        payment_redirect_url: null,
      })
      .eq("id", order.id)
      .eq("buyer_id", user.id)
      .eq("status", "pending_payment");

    if (replaceId) {
      reserveQuery = reserveQuery.eq(
        "provider_transaction_id",
        replaceId,
      );
    } else {
      reserveQuery = reserveQuery.is(
        "provider_transaction_id",
        null,
      );
    }

    const { data: reserved, error: reserveError } =
      await reserveQuery.select("id").maybeSingle();

    if (reserveError || !reserved) {
      console.error(
        "Transaction reservation failed:",
        reserveError?.message ?? "Reservation already taken",
      );

      return reply(
        {
          success: false,
          code: "PAYMENT_RESERVATION_FAILED",
          error:
            "Pesanan sedang diproses atau berubah. Muat ulang pesanan dan periksa statusnya sebelum mencoba lagi.",
        },
        409,
      );
    }

    const customer: Record<string, string> = {};

    if (
      typeof order.buyer_name === "string" &&
      order.buyer_name.trim()
    ) {
      customer.first_name = order.buyer_name
        .trim()
        .slice(0, 100);
    }

    if (
      typeof order.buyer_phone === "string" &&
      order.buyer_phone.trim()
    ) {
      customer.phone = order.buyer_phone
        .trim()
        .slice(0, 20);
    }

    const payload: Record<string, unknown> = {
      transaction_details: {
        order_id: attemptId,
        gross_amount: amount,
      },
      credit_card: {
        secure: true,
      },
    };

    if (Object.keys(customer).length) {
      payload.customer_details = customer;
    }

    if (finishUrl) {
      payload.callbacks = {
        finish: finishUrl,
      };
    }

    let response: Response;
    let result: SnapResult;

    try {
      response = await fetch(
        snapBase + "/snap/v1/transactions",
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000),
        },
      );

      result = (
        await response.json().catch(() => ({}))
      ) as SnapResult;
    } catch (error) {
      // Jangan hapus ID reservasi karena hasil permintaan
      // mungkin tidak pasti. Periksa dashboard Midtrans dahulu.
      console.error(
        "Snap create outcome uncertain:",
        error instanceof Error
          ? error.message
          : "Unknown error",
      );

      return reply(
        {
          success: false,
          code: "MIDTRANS_CREATE_UNCONFIRMED",
          transaction_id: attemptId,
          error:
            "Koneksi ke Midtrans terputus. Periksa transaksi di dashboard sebelum mencoba kembali.",
        },
        502,
      );
    }

    if (!response.ok) {
      console.error(
        "Snap create rejected:",
        JSON.stringify({
          http_status: response.status,
          status_code: result.status_code ?? null,
          status_message: result.status_message ?? null,
        }),
      );

      // Lepaskan reservasi hanya jika ID masih milik
      // permintaan ini dan Midtrans memberi penolakan HTTP.
      const { error: clearError } = await supabase
        .from("marketplace_orders")
        .update({
          payment_provider: null,
          provider_transaction_id: null,
          payment_redirect_url: null,
        })
        .eq("id", order.id)
        .eq("status", "pending_payment")
        .eq("provider_transaction_id", attemptId);

      if (clearError) {
        console.error(
          "Reservation cleanup:",
          clearError.message,
        );
      }

      return reply(
        {
          success: false,
          code: "MIDTRANS_CREATE_FAILED",
          error:
            "Midtrans menolak transaksi: " +
            midtransError(result, response.status),
        },
        502,
      );
    }

    const redirectUrl = result.redirect_url;

    if (!validRedirect(redirectUrl, production)) {
      console.error(
        "Invalid Snap redirect URL received for transaction:",
        attemptId,
      );

      return reply(
        {
          success: false,
          code: "MIDTRANS_REDIRECT_URL_INVALID",
          transaction_id: attemptId,
          error:
            "Midtrans tidak mengembalikan URL pembayaran yang valid. Periksa dashboard sebelum mencoba kembali.",
        },
        502,
      );
    }

    // Simpan URL hanya jika pesanan dan reservasi masih cocok.
    const { data: updated, error: updateError } = await supabase
      .from("marketplace_orders")
      .update({
        payment_redirect_url: redirectUrl,
      })
      .eq("id", order.id)
      .eq("buyer_id", user.id)
      .eq("status", "pending_payment")
      .eq("provider_transaction_id", attemptId)
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      console.error(
        "Payment URL save failed:",
        updateError?.message ??
          "Reservation no longer matches",
      );

      return reply(
        {
          success: false,
          code: "PAYMENT_URL_NOT_SAVED",
          transaction_id: attemptId,
          error:
            "Transaksi mungkin sudah dibuat, tetapi URL pembayaran gagal disimpan. Periksa dashboard Midtrans sebelum mencoba kembali.",
        },
        500,
      );
    }

    return reply({
      success: true,
      payment_mode: production ? "production" : "sandbox",
      order_id: order.id,
      transaction_id: attemptId,
      redirect_url: redirectUrl,
      payment_url: redirectUrl,
      payment_redirect_url: redirectUrl,
      reused_transaction: false,
    });
  } catch (error) {
    console.error(
      "create-midtrans-payment:",
      error instanceof Error
        ? error.message
        : "Unknown internal error",
    );

    return reply(
      {
        success: false,
        code: "INTERNAL_PAYMENT_ERROR",
        error:
          "Terjadi kesalahan internal saat membuat pembayaran.",
      },
      500,
    );
  }
});
