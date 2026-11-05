import { createClient } from "npm:@supabase/supabase-js@2";

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function reply(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return reply({ success: false, message: "Origin tidak diizinkan." }, 403, origin);
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (!["GET", "POST"].includes(req.method)) {
    return reply({ success: false, message: "Gunakan GET atau POST." }, 405, origin);
  }

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply({ success: false, message: "Silakan login." }, 401, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return reply({ success: false, message: "Konfigurasi server belum lengkap." }, 500, origin);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user?.email_confirmed_at) {
      return reply({ success: false, message: "Sesi tidak valid atau email belum dikonfirmasi." }, 401, origin);
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: platformOwner, error: ownerError } = await db
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", authData.user.id)
      .eq("active", true)
      .eq("role", "platform_owner")
      .maybeSingle();

    if (ownerError) return reply({ success: false, message: "Pemeriksaan hak akses gagal." }, 500, origin);
    if (!platformOwner) return reply({ success: false, message: "Hanya Owner Platform yang dapat mengelola mitra." }, 403, origin);

    if (req.method === "GET") {
      const [partners, commissions] = await Promise.all([
        db.from("license_marketing_partners")
          .select("id,user_id,referral_code,display_name,status,first_purchase_rate,renewal_rate,approved_at,approved_by,suspended_at,suspended_by,created_at")
          .order("created_at", { ascending: false }).limit(1000),
        db.from("license_partner_commission_ledger")
          .select("id,partner_id,customer_id,order_id,payment_event_id,commission_type,commission_rate,calculation_base,amount,status,available_at,reviewed_at,reviewed_by,paid_at,paid_by,idempotency_key,notes,created_at")
          .order("created_at", { ascending: false }).limit(2000),
      ]);
      if (partners.error || commissions.error) {
        return reply({ success: false, message: "Data mitra/komisi gagal dibaca." }, 500, origin);
      }
      return reply({ success: true, authorized: true, partners: partners.data || [], commissions: commissions.data || [] }, 200, origin);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reply({ success: false, message: "Format permintaan tidak valid." }, 400, origin);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return reply({ success: false, message: "JSON tidak valid." }, 400, origin);
    }

    const action = String(body.action || "");
    const id = String(body.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return reply({ success: false, message: "ID tidak valid." }, 400, origin);
    }

    const verifyCommissionIsPayable = async () => {
      const { data: commission, error: commissionError } = await db
        .from("license_partner_commission_ledger")
        .select("order_id")
        .eq("id", id)
        .maybeSingle();
      if (commissionError || !commission) {
        return { ok: false, message: "Data komisi tidak ditemukan atau gagal dibaca." };
      }
      const { data: order, error: orderError } = await db
        .from("marketplace_orders")
        .select("status,payment_review_required")
        .eq("id", commission.order_id)
        .maybeSingle();
      if (orderError || !order || order.status !== "paid" || order.payment_review_required) {
        return { ok: false, message: "Pesanan tidak berstatus paid bersih atau sedang ditahan untuk pemeriksaan." };
      }
      const { data: refundEvents, error: refundError } = await db
        .from("marketplace_payment_events")
        .select("id,event_type")
        .eq("order_id", commission.order_id)
        .eq("provider", "midtrans")
        .eq("verification_status", "verified")
        .in("event_type", ["refund","partial_refund","chargeback","partial_chargeback"])
        .limit(1);
      if (refundError) return { ok: false, message: "Status refund belum dapat diverifikasi." };
      if (refundEvents && refundEvents.length) {
        return { ok: false, message: "Pesanan memiliki refund/chargeback terverifikasi. Komisi tidak boleh disetujui atau dicairkan." };
      }
      return { ok: true, message: "" };
    };

    if (action === "approve_partner" || action === "suspend_partner" || action === "reactivate_partner") {
      const nextStatus = action === "suspend_partner" ? "suspended" : "active";
      const update: Record<string, unknown> = {
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      if (action === "approve_partner") { update.approved_at = new Date().toISOString(); update.approved_by = authData.user.id; }
      if (action === "suspend_partner") { update.suspended_at = new Date().toISOString(); update.suspended_by = authData.user.id; }

      const { data, error } = await db.from("license_marketing_partners")
        .update(update).eq("id", id)
        .eq("status", action === "approve_partner" ? "pending" : action === "suspend_partner" ? "active" : "suspended")
        .select("id,status,approved_at,approved_by,suspended_at,suspended_by").maybeSingle();
      if (error) return reply({ success: false, message: "Status mitra gagal diperbarui." }, 500, origin);
      if (!data) return reply({ success: false, message: "Status mitra berubah atau tidak memenuhi syarat." }, 409, origin);
      return reply({ success: true, partner: data }, 200, origin);
    }

    if (action === "approve_commission") {
      const safe = await verifyCommissionIsPayable();
      if (!safe.ok) return reply({ success: false, message: safe.message }, 409, origin);
      const { data, error } = await db.from("license_partner_commission_ledger")
        .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: authData.user.id })
        .eq("id", id).eq("status", "held")
        .select("id,status,reviewed_at,amount,partner_id").maybeSingle();
      if (error) return reply({ success: false, message: "Persetujuan komisi gagal disimpan." }, 500, origin);
      if (!data) return reply({ success: false, message: "Komisi tidak lagi berstatus held." }, 409, origin);
      return reply({ success: true, commission: data }, 200, origin);
    }

    if (action === "mark_commission_paid") {
      const safe = await verifyCommissionIsPayable();
      if (!safe.ok) return reply({ success: false, message: safe.message }, 409, origin);
      const reference = String(body.transfer_reference || "").trim();
      if (reference.length < 4 || reference.length > 120) {
        return reply({ success: false, message: "Nomor referensi transfer wajib diisi (4–120 karakter)." }, 400, origin);
      }
      const { data: existing, error: readError } = await db.from("license_partner_commission_ledger")
        .select("notes").eq("id", id).eq("status", "approved").maybeSingle();
      if (readError) return reply({ success: false, message: "Data komisi gagal dibaca." }, 500, origin);
      if (!existing) return reply({ success: false, message: "Hanya komisi approved yang dapat ditandai dibayar." }, 409, origin);
      const previous = typeof existing.notes === "string" ? existing.notes : "";
      const notes = [previous, "Bukti transfer manual: " + reference].filter(Boolean).join("\n");
      const { data, error } = await db.from("license_partner_commission_ledger")
        .update({ status: "paid", paid_at: new Date().toISOString(), paid_by: authData.user.id, notes })
        .eq("id", id).eq("status", "approved")
        .select("id,status,paid_at,amount,partner_id,notes").maybeSingle();
      if (error) return reply({ success: false, message: "Pencatatan pembayaran komisi gagal." }, 500, origin);
      if (!data) return reply({ success: false, message: "Status komisi berubah; muat ulang data." }, 409, origin);
      return reply({ success: true, commission: data }, 200, origin);
    }

    return reply({ success: false, message: "Aksi tidak dikenal." }, 400, origin);
  } catch (error) {
    console.error("platform-license-partners error:", error instanceof Error ? error.message : String(error));
    return reply({ success: false, message: "Terjadi kesalahan internal." }, 500, req.headers.get("origin"));
  }
});
