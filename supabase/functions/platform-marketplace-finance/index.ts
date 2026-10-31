import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kasusaha-lite.pages.dev",
  "https://wandi0917.github.io",
]);

const baseHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
};

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://kasusaha-lite.pages.dev";
  return {
    ...baseHeaders,
    "Access-Control-Allow-Origin": allowedOrigin,
  };
}

const out = (v: unknown, s = 200, origin: string | null = null) =>
  new Response(JSON.stringify(v), {
    status: s,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Vary": "Origin",
      },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "GET") {
    return out({ error: "Method not allowed" }, 405, origin);
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/, "");
  if (!token) return out({ error: "Login required" }, 401, origin);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !key) {
    return out({ error: "Server configuration incomplete" }, 500, origin);
  }

  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: authErr } = await auth.auth.getUser(token);
  if (authErr || !session.user?.email_confirmed_at) {
    return out({ error: "Invalid session" }, 401, origin);
  }

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admin, error: adminErr } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", session.user.id)
    .eq("active", true)
    .eq("role", "platform_owner")
    .maybeSingle();

  if (adminErr) return out({ error: "Access check failed" }, 500, origin);
  if (!admin) return out({ error: "Platform Owner access denied" }, 403, origin);

  const [cr, pr] = await Promise.all([
    db.from("marketplace_commission_ledger")
      .select("id,order_item_id,entry_type,commission_rate,calculation_base,amount,payment_event_id,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
    db.from("marketplace_payout_ledger")
      .select("id,recipient_user_id,recipient_type,amount,currency,status,provider,provider_payout_id,requested_at,completed_at,notes")
      .eq("recipient_type", "platform_owner")
      .order("requested_at", { ascending: false })
      .limit(1000),
  ]);

  if (cr.error || pr.error) {
    return out({ error: "Unable to load marketplace finance data" }, 500, origin);
  }

  const rows = cr.data || [];
  const ids = [...new Set(rows.map((x) => x.order_item_id).filter(Boolean))];
  let items: Record<string, unknown> = {};

  if (ids.length) {
    const { data, error } = await db.from("marketplace_order_items")
      .select("id,order_id,product_name_snapshot,unit_price,quantity,item_subtotal")
      .in("id", ids);
    if (error) return out({ error: "Unable to load commission details" }, 500, origin);
    for (const item of data || []) items[item.id] = item;
  }

  const orderIds = [...new Set(
    Object.values(items)
      .map((raw) => (raw as { order_id?: string }).order_id)
      .filter((id): id is string => typeof id === "string"),
  )];
  const orderById = new Map<string, {
    status: string;
    paid_at: string | null;
    payment_review_required: boolean;
  }>();
  const paymentEventIds = [...new Set(
    rows
      .map((row) => row.payment_event_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )];
  const verifiedEventById = new Map<string, boolean>();

  const [orderResult, eventResult] = await Promise.all([
    orderIds.length
      ? db.from("marketplace_orders")
          .select("id,status,paid_at,payment_review_required")
          .in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    paymentEventIds.length
      ? db.from("marketplace_payment_events")
          .select("id,verification_status,processed_at")
          .in("id", paymentEventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (orderResult.error) {
    return out({ error: "Unable to verify payment-review status" }, 500, origin);
  }
  if (eventResult.error) {
    return out({ error: "Unable to verify payment-event status" }, 500, origin);
  }

  for (const order of orderResult.data || []) {
    orderById.set(order.id, {
      status: order.status,
      paid_at: order.paid_at,
      payment_review_required: order.payment_review_required === true,
    });
  }
  for (const event of eventResult.data || []) {
    verifiedEventById.set(
      event.id,
      event.verification_status === "verified" && event.processed_at !== null,
    );
  }

  // Komisi baru boleh masuk saldo tersedia setelah event pembayaran
  // terverifikasi dan diproses. Entri manual berstatus "received" tetap
  // terlihat untuk audit, tetapi ditahan sampai bukti pembayarannya sah.
  const verifiedCommissionByItem = new Set(
    rows
      .filter((row) =>
        row.entry_type === "commission" &&
        typeof row.order_item_id === "string" &&
        typeof row.payment_event_id === "string" &&
        verifiedEventById.get(row.payment_event_id) === true
      )
      .map((row) => row.order_item_id),
  );

  const hasVerifiedPaymentEvent = (row: (typeof rows)[number]) => {
    if (
      typeof row.payment_event_id === "string" &&
      verifiedEventById.get(row.payment_event_id) === true
    ) return true;

    // Koreksi pembalik komisi lama tanpa event tersendiri tetap boleh
    // mengimbangi komisi asal yang sudah terverifikasi.
    return row.entry_type === "refund_reversal" &&
      typeof row.order_item_id === "string" &&
      verifiedCommissionByItem.has(row.order_item_id);
  };

  // Semua baris tetap ditampilkan untuk audit. Saldo hanya menghitung
  // pesanan yang benar-benar telah dibayar dan event-nya terverifikasi.
  const isHeldForReview = (row: (typeof rows)[number]) => {
    const item = items[row.order_item_id] as { order_id?: string } | null;
    if (!item?.order_id) return true;
    const order = orderById.get(item.order_id);
    if (!order || order.payment_review_required || !order.paid_at) return true;
    if (!["paid", "processing", "completed", "refunded", "partially_refunded"].includes(order.status)) return true;
    return !hasVerifiedPaymentEvent(row);
  };
  const commissions = rows.map((x) => ({
    ...x,
    item: items[x.order_item_id] || null,
    held_for_review: isHeldForReview(x),
  }));
  const eligibleRows = rows.filter((x) => !isHeldForReview(x));
  const heldRows = rows.filter(isHeldForReview);
  const payouts = pr.data || [];
  const sum = (list: Array<{ amount: number | string | null }>) =>
    list.reduce((n, x) => n + Number(x.amount || 0), 0);
  const gross = sum(eligibleRows.filter((x) => x.entry_type === "commission"));
  const reversal = sum(eligibleRows.filter((x) => x.entry_type === "refund_reversal"));
  const adjustment = sum(eligibleRows.filter((x) => x.entry_type === "adjustment"));
  const held = sum(heldRows);
  const net = gross + reversal + adjustment;
  const paid = sum(payouts.filter((x) => x.status === "paid"));
  const pending = sum(payouts.filter((x) => ["pending", "submitted"].includes(x.status)));

  return out({
    authorized: true,
    role: "platform_owner",
    generated_at: new Date().toISOString(),
    summary: {
      gross_commission: gross,
      refund_reversals: reversal,
      adjustments: adjustment,
      total_commission_net: net,
      commission_held_for_review: held,
      total_paid_out: paid,
      pending_payout: pending,
      available_not_paid_out: net - paid,
    },
    commissions,
    payouts,
  }, 200, origin);
});
