import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://kasusaha-lite.pages.dev",
  "https://wandi0917.github.io",
]);

function reply(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://kasusaha-lite.pages.dev";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ success: false, message: "Origin tidak diizinkan." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": origin || "https://kasusaha-lite.pages.dev", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" } });
  if (req.method !== "POST") return reply({ success: false, message: "Gunakan POST." }, 405, origin);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply({ success: false, message: "Login Akun Pembeli diperlukan." }, 401, origin);
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anon || !service) return reply({ success: false, message: "Konfigurasi server belum lengkap." }, 500, origin);

    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user?.email_confirmed_at || authData.user.is_anonymous) {
      return reply({ success: false, message: "Gunakan akun pembeli terdaftar dengan email terkonfirmasi." }, 401, origin);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply({ success: false, message: "Format permintaan tidak valid." }, 400, origin);
      body = parsed as Record<string, unknown>;
    } catch {
      return reply({ success: false, message: "JSON tidak valid." }, 400, origin);
    }
    const displayName = String(body.display_name || "").trim().replace(/\s+/g, " ");
    if (displayName.length < 2 || displayName.length > 80) {
      return reply({ success: false, message: "Nama mitra harus 2–80 karakter." }, 400, origin);
    }

    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: existing, error: existingError } = await db.from("license_marketing_partners")
      .select("id,display_name,referral_code,status,first_purchase_rate,renewal_rate,created_at")
      .eq("user_id", authData.user.id).maybeSingle();
    if (existingError) return reply({ success: false, message: "Status pendaftaran mitra gagal diperiksa." }, 500, origin);
    if (existing) return reply({ success: true, already_registered: true, partner: existing }, 200, origin);

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const code = "KS" + Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
      const { data, error } = await db.from("license_marketing_partners")
        .insert({
          user_id: authData.user.id,
          display_name: displayName,
          referral_code: code,
          status: "pending",
          first_purchase_rate: 0.15,
          renewal_rate: 0.10,
        })
        .select("id,display_name,referral_code,status,first_purchase_rate,renewal_rate,created_at")
        .single();
      if (!error && data) return reply({ success: true, already_registered: false, partner: data }, 201, origin);
      if (error?.code === "23505" && String(error.message || "").toLowerCase().includes("referral_code")) continue;
      if (error?.code === "23505") {
        const { data: duplicate } = await db.from("license_marketing_partners")
          .select("id,display_name,referral_code,status,first_purchase_rate,renewal_rate,created_at")
          .eq("user_id", authData.user.id).maybeSingle();
        if (duplicate) return reply({ success: true, already_registered: true, partner: duplicate }, 200, origin);
      }
      console.error("Partner application insert failed:", error?.message || "unknown");
      return reply({ success: false, message: "Pendaftaran mitra gagal disimpan." }, 500, origin);
    }
    return reply({ success: false, message: "Kode referral belum berhasil dibuat. Coba kembali." }, 503, origin);
  } catch (error) {
    console.error("license-partner-apply error:", error instanceof Error ? error.message : String(error));
    return reply({ success: false, message: "Terjadi kesalahan internal." }, 500, req.headers.get("origin"));
  }
});
