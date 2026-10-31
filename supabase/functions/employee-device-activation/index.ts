import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function norm(v: unknown) { return String(v ?? "").trim().toLowerCase(); }
function validDevice(v: unknown): v is string {
  return typeof v === "string" && v.length >= 16 && v.length <= 120 && /^[a-zA-Z0-9_-]+$/.test(v);
}
function paidStatus(v: Record<string, unknown>, expectedOrderId: string) {
  const s = norm(v.transaction_status), f = norm(v.fraud_status);
  // Jangan mengaktifkan ID/perangkat hanya dari nominal dan status:
  // identitas order, status HTTP Midtrans, dan mata uang juga harus cocok.
  if (String(v.order_id ?? "") !== expectedOrderId) return false;
  if (String(v.status_code ?? "") !== "200") return false;
  if (norm(v.currency) !== "idr") return false;
  if (Number(v.gross_amount) !== 10000) return false;
  // fraud_status tidak dikirim untuk sebagian metode pembayaran berisiko rendah.
  // Jika tersedia, nilainya wajib ACCEPT; Capture selalu memerlukan ACCEPT.
  const fraudStatusAcceptable = f === "" || f === "accept";
  return fraudStatusAcceptable &&
    (s === "settlement" || (s === "capture" && f === "accept"));
}
function midtransBases(production: boolean) {
  return {
    api: production ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com",
    snap: production ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com",
  };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ success: false, message: "Gunakan POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
    const production = norm(Deno.env.get("MIDTRANS_IS_PRODUCTION")) === "true";
    if (!url || !anonKey || !serviceKey || !serverKey) {
      return reply({ success: false, message: "Konfigurasi server aktivasi perangkat belum lengkap." }, 500);
    }
    const authHeader = req.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(authHeader)) return reply({ success: false, message: "Login diperlukan." }, 401);
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) return reply({ success: false, message: "Sesi tidak valid. Login kembali." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (!["status", "employee_join_code", "owner_list", "owner_create", "owner_check", "owner_create_code", "owner_revoke_code", "owner_deactivate", "owner_reactivate", "owner_delete_inactive"].includes(action)) {
      return reply({ success: false, message: "Aksi tidak dikenal." }, 400);
    }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const authUserId = auth.user.id;
    const label = typeof body.device_label === "string"
      ? body.device_label.replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 80)
      : "Perangkat karyawan";

    if (action === "status") {
      // Access is licensed per employee account, never per physical device/browser.
      const { data: member, error: memberError } = await admin
        .from("business_members").select("business_id,role,active")
        .eq("user_id", authUserId).eq("active", true).maybeSingle();
      if (memberError) {
        console.error("Employee membership lookup:", memberError.message);
        return reply({ success: false, message: "Keanggotaan usaha belum dapat diverifikasi." }, 500);
      }
      if (!member || member.role !== "employee") {
        return reply({ success: false, message: "Akun Karyawan belum aktif atau belum bergabung dengan usaha." }, 403);
      }

      const accountDeviceId = "ksacct_" + authUserId.replace(/-/g, "");
      let { data: activation, error: activationError } = await admin
        .from("kasusaha_device_activations")
        .select("id,user_id,device_id,status,amount,paid_at")
        .eq("business_id", member.business_id)
        .eq("user_id", authUserId)
        .eq("role", "employee")
        .eq("device_id", accountDeviceId)
        .maybeSingle();
      if (activationError) {
        console.error("Employee account activation lookup:", activationError.message);
        return reply({ success: false, message: "Status aktivasi ID karyawan belum dapat dibaca." }, 500);
      }

      if (!activation) {
        const { data: created, error: createError } = await admin
          .from("kasusaha_device_activations")
          .insert({
            business_id: member.business_id,
            user_id: authUserId,
            device_id: accountDeviceId,
            device_label: "Aktivasi ID karyawan",
            role: "employee",
            amount: 10000,
            status: "pending_payment",
          })
          .select("id,user_id,device_id,status,amount,paid_at")
          .single();
        if (createError) {
          const { data: retry } = await admin
            .from("kasusaha_device_activations")
            .select("id,user_id,device_id,status,amount,paid_at")
            .eq("business_id", member.business_id)
            .eq("user_id", authUserId)
            .eq("role", "employee")
            .eq("device_id", accountDeviceId)
            .maybeSingle();
          if (!retry) {
            console.error("Create employee account activation:", createError.message);
            return reply({ success: false, message: "Permintaan aktivasi ID karyawan belum tercatat. Coba periksa kembali." }, 500);
          }
          activation = retry;
        } else {
          activation = created;
        }
      }

      if (activation.status === "revoked" || activation.status === "failed") {
        return reply({
          success: false, active: false, status: activation.status,
          message: "ID karyawan belum aktif. Minta Owner memeriksa atau mengaktifkan kembali ID ini."
        }, 403);
      }
      const active = activation.status === "paid";
      return reply({
        success: true,
        active,
        status: activation.status,
        activation_kind: "employee_id",
        amount: 10000,
        paid_at: activation.paid_at || null,
        message: active
          ? "ID karyawan sudah aktif. Akun dapat digunakan dari perangkat apa pun."
          : "ID karyawan menunggu Owner membayar aktivasi Rp10.000. Login penuh terbuka setelah pembayaran terverifikasi."
      });
    }

    if (action === "employee_join_code") {
      const code = String(body.employee_code || "").trim().toUpperCase();
      const employeeName = String(body.employee_name || "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (!/^[A-Z0-9]{8}$/.test(code) || employeeName.length < 2) {
        return reply({ success: false, message: "Nama dan kode ID karyawan tidak valid." }, 400);
      }

      const { data: invite, error: inviteError } = await admin
        .from("employee_invite_codes")
        .select("*")
        .eq("invite_code", code)
        .maybeSingle();
      if (inviteError || !invite) {
        return reply({ success: false, message: "Kode ID karyawan tidak ditemukan." }, 404);
      }
      if (invite.status === "revoked") {
        return reply({ success: false, message: "ID karyawan dinonaktifkan Owner. Hubungi Owner untuk mendapatkan ID baru." }, 403);
      }
      if (norm(invite.employee_name) !== norm(employeeName)) {
        return reply({ success: false, message: "Nama tidak cocok dengan nama yang didaftarkan Owner." }, 403);
      }

      const { data: existing, error: existingError } = await admin
        .from("business_members")
        .select("business_id,role,active")
        .eq("user_id", authUserId)
        .maybeSingle();
      if (existingError) {
        return reply({ success: false, message: "Status keanggotaan tidak dapat diperiksa." }, 500);
      }

      // Kode yang sudah dipakai hanya boleh dipakai kembali oleh ID login
      // anonim yang sama dan selama Owner belum menonaktifkan keanggotaannya.
      if (invite.status === "used") {
        if (invite.user_id !== authUserId) {
          return reply({ success: false, message: "ID ini sudah terhubung ke akun Karyawan lain. Minta Owner membuat ID baru." }, 403);
        }
        if (!existing?.active || existing.business_id !== invite.business_id || existing.role !== "employee") {
          return reply({ success: false, message: "Akses akun ini sedang dinonaktifkan atau telah dihapus Owner. Hubungi Owner." }, 403);
        }

        const accountDeviceId = "ksacct_" + authUserId.replace(/-/g, "");
        const { error: bindingError } = await admin.from("employee_invite_code_users")
          .upsert({ invite_code_id: invite.id, user_id: authUserId, business_id: invite.business_id }, { onConflict: "invite_code_id,user_id" });
        if (bindingError) return reply({ success: false, message: "Tautan ID karyawan belum berhasil diperiksa. Coba lagi." }, 500);
        const { error: activationError } = await admin.from("kasusaha_device_activations").upsert({
          business_id: invite.business_id, user_id: authUserId, device_id: accountDeviceId,
          device_label: "Aktivasi ID karyawan — " + invite.employee_name, role: "employee",
          status: "paid", amount: 10000, paid_at: invite.paid_at, updated_at: new Date().toISOString()
        }, { onConflict: "business_id,device_id" });
        if (activationError) return reply({ success: false, message: "Status aktivasi ID belum dapat dipulihkan. Hubungi Owner." }, 500);

        const { data: workspace } = await admin.from("business_workspaces")
          .select("business_name").eq("id", invite.business_id).maybeSingle();
        return reply({ success: true, business_id: invite.business_id, role: "employee", business_name: workspace?.business_name || "usaha Anda", existing: true });
      }

      if (invite.status !== "active" || !invite.paid_at || invite.user_id) {
        return reply({ success: false, message: "ID karyawan belum aktif atau sudah tidak tersedia. Owner harus menyelesaikan pembayaran dan membuat ID baru bila diperlukan." }, 403);
      }
      if (existing && (existing.business_id !== invite.business_id || existing.role !== "employee" || !existing.active)) {
        return reply({ success: false, message: "Akun ini sudah terhubung ke usaha lain, memiliki peran berbeda, atau aksesnya nonaktif." }, 409);
      }

      // Claim, membership, binding, and paid activation are committed atomically in Postgres.
      const { data: claimResult, error: claimError } = await admin.rpc("kasusaha_claim_employee_invite", {
        p_invite_id: invite.id,
        p_user_id: authUserId,
        p_employee_name: employeeName,
      });
      if (claimError || !claimResult?.success) {
        console.error("Atomic employee invite claim:", claimError?.message || "claim rejected");
        return reply({ success: false, message: "ID karyawan belum berhasil diaktifkan. Periksa status ID dan keanggotaan, lalu coba lagi. Tidak ada perubahan sebagian yang disimpan." }, 409);
      }

      const { data: workspace } = await admin.from("business_workspaces")
        .select("business_name").eq("id", invite.business_id).maybeSingle();
      return reply({ success: true, business_id: invite.business_id, role: "employee", business_name: workspace?.business_name || "usaha Anda", existing: false });
    }

    // Owner actions are scoped to an explicitly requested workspace owned by the signed-in user.
    const businessId = String(body.business_id || "");
    if (!businessId) return reply({ success: false, message: "Usaha belum dipilih. Muat ulang menu Owner." }, 400);
    const { data: business, error: businessError } = await admin
      .from("business_workspaces").select("id,owner_id,business_name")
      .eq("id", businessId).eq("owner_id", authUserId).maybeSingle();
    if (businessError || !business) return reply({ success: false, message: "Hanya Owner usaha terkait yang boleh mengelola aktivasi karyawan." }, 403);

    if (action === "owner_create_code") {
      const employeeName = String(body.employee_name || "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (employeeName.length < 2) return reply({ success: false, message: "Nama karyawan minimal 2 karakter." }, 400);
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "";
      for (let i = 0; i < 8; i++) code += alphabet[crypto.getRandomValues(new Uint8Array(1))[0] % alphabet.length];
      const orderId = "KSEMP-" + crypto.randomUUID().replace(/-/g, "").toUpperCase();
      const { snap } = midtransBases(production);
      const authBasic = "Basic " + btoa(serverKey + ":");
      const snapResponse = await fetch(snap + "/snap/v1/transactions", { method: "POST", headers: { Authorization: authBasic, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ transaction_details: { order_id: orderId, gross_amount: 10000 }, item_details: [{ id: "KSL-EMPLOYEE-ID", price: 10000, quantity: 1, name: "Aktivasi ID karyawan KasUsaha Lite" }], customer_details: { first_name: employeeName }, callbacks: { finish: "https://kasusaha-lite.pages.dev/?employee_payment=return" } }), signal: AbortSignal.timeout(20000) });
      const snapData = await snapResponse.json().catch(() => ({}));
      if (!snapResponse.ok || !snapData.redirect_url) return reply({ success: false, message: "Midtrans belum dapat membuat pembayaran ID karyawan." }, 502);
      const { data: invite, error } = await admin.from("employee_invite_codes").insert({ business_id: businessId, employee_name: employeeName, invite_code: code, status: "pending_payment", amount: 10000, midtrans_order_id: orderId, payment_url: snapData.redirect_url, created_by: authUserId }).select("id,employee_name,invite_code,status,payment_url,created_at").single();
      if (error || !invite) { console.error("Save employee invite:", error?.message); return reply({ success: false, message: "Kode ID gagal disimpan. Muat ulang dan coba lagi." }, 500); }
      return reply({ success: true, employee: invite, payment_url: snapData.redirect_url, message: "Kode ID dibuat dan baru berlaku setelah pembayaran Owner terverifikasi." });
    }
    if (action === "owner_revoke_code") {
      const codeId = String(body.code_id || "");
      const { data: invite, error } = await admin.from("employee_invite_codes").select("id,user_id").eq("id", codeId).eq("business_id", businessId).maybeSingle();
      if (error || !invite) return reply({ success: false, message: "Kode ID tidak ditemukan." }, 404);
      const { error: updateError } = await admin.from("employee_invite_codes").update({ status: "revoked", updated_at: new Date().toISOString() }).eq("id", codeId).eq("business_id", businessId);
      if (updateError) return reply({ success: false, message: "Kode ID gagal dinonaktifkan." }, 500);
      const { data: bindings } = await admin.from("employee_invite_code_users").select("user_id").eq("invite_code_id", codeId).eq("business_id", businessId);
      for (const binding of bindings || []) {
        await admin.from("business_members").update({ active: false }).eq("business_id", businessId).eq("user_id", binding.user_id).eq("role", "employee");
        await admin.from("kasusaha_device_activations").update({ status: "revoked", updated_at: new Date().toISOString() }).eq("business_id", businessId).eq("user_id", binding.user_id).eq("role", "employee");
      }
      return reply({ success: true, message: "Kode ID dinonaktifkan dan akses semua sesi yang pernah menggunakannya dicabut." });
    }

    if (action === "owner_list") {
      const { data: members, error: membersError } = await admin.from("business_members")
        .select("user_id,role,active,joined_at").eq("business_id", businessId).eq("role", "employee")
        .order("joined_at", { ascending: false });
      if (membersError) {
        console.error("Owner member list:", membersError.message);
        return reply({ success: false, message: "Daftar karyawan belum dapat dimuat." }, 500);
      }
      const memberProfiles = await Promise.all((members || []).map(async (member) => {
        const { data: authData } = await admin.auth.admin.getUserById(member.user_id);
        const meta = authData?.user?.user_metadata || {};
        return { user_id: member.user_id, name: String(meta.employee_name || meta.full_name || meta.name || "Nama belum diisi").slice(0, 100) };
      }));
      // Setiap akun karyawan baru selalu mendapat baris aktivasi agar Owner dapat langsung membayar.
      let { data: activations, error: activationListError } = await admin.from("kasusaha_device_activations")
        .select("id,user_id,device_id,device_label,status,amount,midtrans_order_id,payment_url,paid_at,created_at")
        .eq("business_id", businessId).eq("role", "employee").order("created_at", { ascending: false });
      if (activationListError) {
        console.error("Owner activation list:", activationListError.message);
        return reply({ success: false, message: "Daftar aktivasi perangkat belum dapat dimuat." }, 500);
      }
      let activationRows = activations || [];
      for (const member of members || []) {
        const syntheticDeviceId = "ksacct_" + member.user_id.replace(/-/g, "");
        if (activationRows.some((a) => a.user_id === member.user_id && a.device_id === syntheticDeviceId)) continue;
        const profile = memberProfiles.find((p) => p.user_id === member.user_id);
        const { error: placeholderError } = await admin.from("kasusaha_device_activations").insert({
          business_id: businessId, user_id: member.user_id, device_id: syntheticDeviceId,
          device_label: "Aktivasi akun karyawan — " + (profile?.name || "Nama belum diisi"),
          role: "employee", status: "pending_payment", amount: 10000,
        });
        if (placeholderError && !String(placeholderError.message || "").toLowerCase().includes("duplicate")) {
          console.error("Create account activation request:", placeholderError.message);
          return reply({ success: false, message: "Permintaan aktivasi akun karyawan belum dapat dibuat." }, 500);
        }
      }
      // Verifikasi transaksi Midtrans di server saat Owner membuka ulang daftar.
      const productionForCheck = norm(Deno.env.get("MIDTRANS_IS_PRODUCTION")) === "true";
      const apiForCheck = productionForCheck ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
      const authBasicForCheck = "Basic " + btoa(serverKey + ":");
      const recentlyPaid: string[] = [];
      for (const row of activationRows) {
        if (row.status !== "pending_payment" || !row.midtrans_order_id) continue;
        const txResponse = await fetch(apiForCheck + "/v2/" + encodeURIComponent(row.midtrans_order_id) + "/status", {
          headers: { Authorization: authBasicForCheck, Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (!txResponse?.ok) continue;
        const tx = await txResponse.json().catch(() => null) as Record<string, unknown> | null;
        if (tx && paidStatus(tx, row.midtrans_order_id)) {
          const { error: paidUpdateError } = await admin.from("kasusaha_device_activations").update({
            status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq("id", row.id).eq("business_id", businessId).eq("status", "pending_payment");
          if (!paidUpdateError) {
            recentlyPaid.push(row.user_id);
            if (String(row.device_id || "").startsWith("ksacct_")) {
              await admin.from("business_members").update({ active: true })
                .eq("business_id", businessId).eq("user_id", row.user_id).eq("role", "employee");
            }
          }
        }
      }
      const { data: refreshedActivations, error: refreshedError } = await admin.from("kasusaha_device_activations")
        .select("id,user_id,device_id,device_label,status,amount,midtrans_order_id,payment_url,paid_at,created_at")
        .eq("business_id", businessId).eq("role", "employee").order("created_at", { ascending: false });
      if (refreshedError) return reply({ success: false, message: "Status aktivasi terbaru belum dapat dimuat." }, 500);
      activationRows = refreshedActivations || [];
      const employees = (members || []).map((member) => {
        const profile = memberProfiles.find((p) => p.user_id === member.user_id);
        const accountDeviceId = "ksacct_" + member.user_id.replace(/-/g, "");
        const devices = activationRows.filter((a) => a.user_id === member.user_id && a.device_id === accountDeviceId);
        return {
          user_id: member.user_id, name: profile?.name || "Nama belum diisi",
          active: member.active || recentlyPaid.includes(member.user_id), joined_at: member.joined_at,
          devices: devices.map((a) => ({
            id: a.id, device_id: a.device_id, device_label: a.device_label, status: a.status,
            activation_kind: String(a.device_id || "").startsWith("ksacct_") ? "account" : "device",
            amount: a.amount, midtrans_order_id: a.midtrans_order_id, payment_url: a.payment_url,
            paid_at: a.paid_at, created_at: a.created_at,
          })),
        };
      });
      const { data: inviteCodes, error: inviteCodeError } = await admin.from("employee_invite_codes")
        .select("id,employee_name,invite_code,status,amount,midtrans_order_id,payment_url,paid_at,user_id,created_at")
        .eq("business_id", businessId).order("created_at", { ascending: false });
      if (inviteCodeError) return reply({ success: false, message: "Daftar ID karyawan belum dapat dimuat." }, 500);
      const { api: inviteApi } = midtransBases(productionForCheck);
      const inviteAuthBasic = "Basic " + btoa(serverKey + ":");
      const refreshedCodes = [];
      for (const invite of inviteCodes || []) {
        if (invite.status === "pending_payment" && invite.midtrans_order_id) {
          const txResponse = await fetch(inviteApi + "/v2/" + encodeURIComponent(invite.midtrans_order_id) + "/status", {
            headers: { Authorization: inviteAuthBasic, Accept: "application/json" }, signal: AbortSignal.timeout(8000)
          }).catch(() => null);
          if (txResponse?.ok) {
            const tx = await txResponse.json().catch(() => null);
            if (tx && paidStatus(tx, invite.midtrans_order_id)) {
              const { error: codePaidError } = await admin.from("employee_invite_codes").update({
                status: "active", paid_at: new Date().toISOString(), updated_at: new Date().toISOString()
              }).eq("id", invite.id).eq("status", "pending_payment");
              if (!codePaidError) { invite.status = "active"; invite.paid_at = new Date().toISOString(); }
            }
          }
        }
        refreshedCodes.push({
          id: invite.id, employee_name: invite.employee_name, invite_code: invite.invite_code,
          status: invite.status, amount: invite.amount, payment_url: invite.payment_url,
          paid_at: invite.paid_at, user_id: invite.user_id, created_at: invite.created_at
        });
      }
      const recentlyPaidNames = employees.filter((employee) => recentlyPaid.includes(employee.user_id)).map((employee) => employee.name);
      return reply({ success: true, business_name: business.business_name, employees, employee_codes: refreshedCodes, recently_paid: recentlyPaidNames });
    }

    if (action === "owner_deactivate" || action === "owner_reactivate") {
      const targetUserId = String(body.user_id || "");
      if (!targetUserId) return reply({ success: false, message: "Akun karyawan tidak ditemukan." }, 400);
      const { data: targetMember, error: targetError } = await admin.from("business_members")
        .select("user_id,role,active").eq("business_id", businessId).eq("user_id", targetUserId)
        .eq("role", "employee").maybeSingle();
      if (targetError || !targetMember) return reply({ success: false, message: "Karyawan tidak ditemukan pada usaha Owner ini." }, 404);
      if (action === "owner_deactivate") {
        const { error: memberUpdateError } = await admin.from("business_members")
          .update({ active: false }).eq("business_id", businessId).eq("user_id", targetUserId).eq("role", "employee");
        if (memberUpdateError) return reply({ success: false, message: "Status karyawan belum berhasil dinonaktifkan." }, 500);
        const { error: revokeError } = await admin.from("kasusaha_device_activations")
          .update({ status: "revoked", updated_at: new Date().toISOString() })
          .eq("business_id", businessId).eq("user_id", targetUserId).eq("role", "employee");
        if (revokeError) return reply({ success: false, message: "Akun dinonaktifkan, tetapi status perangkat belum sepenuhnya diperbarui. Muat ulang daftar." }, 500);
        return reply({ success: true, active: false, message: "Karyawan dinonaktifkan. Akses usaha dan perangkatnya dicabut." });
      }
      const { error: memberUpdateError } = await admin.from("business_members")
        .update({ active: true }).eq("business_id", businessId).eq("user_id", targetUserId).eq("role", "employee");
      if (memberUpdateError) return reply({ success: false, message: "Status karyawan belum berhasil diaktifkan." }, 500);
      const { data: oldActivations, error: oldActivationError } = await admin.from("kasusaha_device_activations")
        .select("id,status,paid_at").eq("business_id", businessId).eq("user_id", targetUserId).eq("role", "employee");
      if (oldActivationError) return reply({ success: false, message: "Riwayat aktivasi karyawan belum dapat dibaca." }, 500);
      for (const a of oldActivations || []) {
        const restoredStatus = a.paid_at ? "paid" : "pending_payment";
        const { error: restoreError } = await admin.from("kasusaha_device_activations")
          .update({ status: restoredStatus, updated_at: new Date().toISOString() }).eq("id", a.id);
        if (restoreError) return reply({ success: false, message: "Status karyawan diaktifkan, tetapi aktivasi perangkat perlu diperiksa." }, 500);
      }
      return reply({ success: true, active: true, message: "Status karyawan diaktifkan kembali. Perangkat yang pernah dibayar dipulihkan; perangkat baru tetap menunggu pembayaran." });
    }

    if (action === "owner_delete_inactive") {
      const targetUserId = String(body.user_id || "");
      if (!targetUserId) return reply({ success: false, message: "Akun karyawan tidak ditemukan." }, 400);
      const { data: targetMember, error: targetError } = await admin.from("business_members")
        .select("user_id,role,active").eq("business_id", businessId).eq("user_id", targetUserId)
        .eq("role", "employee").maybeSingle();
      if (targetError || !targetMember) return reply({ success: false, message: "Karyawan tidak ditemukan pada usaha Owner ini." }, 404);
      if (targetMember.active === true) return reply({ success: false, message: "Karyawan harus dinonaktifkan terlebih dahulu sebelum dihapus." }, 409);
      const { error: inviteRevokeError } = await admin.from("employee_invite_codes")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("business_id", businessId).eq("user_id", targetUserId).eq("status", "used");
      if (inviteRevokeError) return reply({ success: false, message: "ID undangan lama belum berhasil dinonaktifkan. Data keanggotaan tidak dihapus." }, 500);

      // Pertahankan jejak pembayaran dan keanggotaan untuk audit/rekonsiliasi.
      // Akun dibuat nonaktif, bukan dihapus permanen.
      const { error: activationArchiveError } = await admin.from("kasusaha_device_activations")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("business_id", businessId).eq("user_id", targetUserId).eq("role", "employee");
      if (activationArchiveError) {
        console.error("Archive inactive employee activations:", activationArchiveError.message);
        return reply({ success: false, message: "Status aktivasi belum berhasil diarsipkan. Data tetap dipertahankan." }, 500);
      }
      return reply({ success: true, active: false, archived: true, message: "Akses karyawan dinonaktifkan. Riwayat aktivasi, pembayaran, dan keanggotaan tetap disimpan untuk audit; tidak ada data yang dihapus." });
    }

    const activationId = String(body.activation_id || "");
    if (!activationId) return reply({ success: false, message: "Permintaan aktivasi tidak ditemukan." }, 400);
    const { data: activation, error: activationError } = await admin.from("kasusaha_device_activations")
      .select("*").eq("id", activationId).eq("business_id", businessId).eq("role", "employee").maybeSingle();
    if (activationError || !activation) return reply({ success: false, message: "Permintaan aktivasi tidak ditemukan pada usaha Owner ini." }, 404);
    const { data: employeeMember, error: employeeError } = await admin.from("business_members")
      .select("user_id,role,active").eq("business_id", businessId).eq("user_id", activation.user_id)
      .eq("role", "employee").eq("active", true).maybeSingle();
    if (employeeError || !employeeMember) return reply({ success: false, message: "Akun karyawan belum aktif/terhubung ke usaha ini." }, 409);
    if (activation.status === "revoked") return reply({ success: false, message: "Permintaan ini telah dinonaktifkan Owner." }, 409);
    if (activation.status === "paid") return reply({ success: true, active: true, status: "paid", message: "Perangkat karyawan sudah aktif." });

    const { api, snap } = midtransBases(production);
    const authBasic = "Basic " + btoa(serverKey + ":");
    async function verifyExistingOrder() {
      if (!activation.midtrans_order_id) return null;
      const response = await fetch(api + "/v2/" + encodeURIComponent(activation.midtrans_order_id) + "/status", {
        headers: { Authorization: authBasic, Accept: "application/json" }, signal: AbortSignal.timeout(12000),
      }).catch(() => null);
      if (!response?.ok) return null;
      return await response.json().catch(() => null) as Record<string, unknown> | null;
    }
    async function markPaid() {
      const { error } = await admin.from("kasusaha_device_activations").update({
        status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", activation.id).eq("business_id", businessId);
      if (error) throw error;
      if (String(activation.device_id || "").startsWith("ksacct_")) {
        const { error: activateMemberError } = await admin.from("business_members").update({ active: true })
          .eq("business_id", businessId).eq("user_id", activation.user_id).eq("role", "employee");
        if (activateMemberError) throw activateMemberError;
      }
      return reply({ success: true, active: true, status: "paid", amount: 10000, message: "Pembayaran terverifikasi server. Akun/perangkat karyawan sekarang aktif." });
    }

    if (action === "owner_check") {
      if (!activation.midtrans_order_id) return reply({ success: true, active: false, status: activation.status, message: "Belum ada pembayaran untuk diperiksa. Owner harus menekan Bayar Aktivasi terlebih dahulu." });
      const tx = await verifyExistingOrder();
      if (tx && paidStatus(tx, activation.midtrans_order_id)) return await markPaid();
      if (tx && ["deny", "cancel", "expire", "failure"].includes(norm(tx.transaction_status))) {
        return reply({ success: true, active: false, status: activation.status, message: "Pembayaran belum berhasil (" + String(tx.transaction_status) + "). Owner dapat mencoba membayar kembali." });
      }
      return reply({ success: true, active: false, status: activation.status, message: "Pembayaran belum terverifikasi. Akun karyawan tetap menunggu aktivasi." });
    }

    // owner_create
    const existing = await verifyExistingOrder();
    if (existing && paidStatus(existing, activation.midtrans_order_id)) return await markPaid();
    if (existing && norm(existing.transaction_status) === "pending" && activation.payment_url) {
      return reply({ success: true, active: false, status: "pending_payment", amount: 10000, payment_url: activation.payment_url, reused_transaction: true });
    }
    const orderId = "KSDEV-" + crypto.randomUUID().replace(/-/g, "").toUpperCase();
    const snapResponse = await fetch(snap + "/snap/v1/transactions", {
      method: "POST",
      headers: { Authorization: authBasic, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: 10000 },
        item_details: [{ id: "KSL-EMP-DEVICE", price: 10000, quantity: 1, name: "Aktivasi perangkat karyawan KasUsaha Lite" }],
        customer_details: { first_name: String(activation.device_label || "Owner KasUsaha Lite").slice(0, 80) },
        callbacks: { finish: "https://kasusaha-lite.pages.dev/?device_payment=return" },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const snapData = await snapResponse.json().catch(() => ({}));
    if (!snapResponse.ok || !snapData.token || !snapData.redirect_url) {
      console.error("Midtrans Snap create failed:", snapResponse.status, JSON.stringify(snapData).slice(0, 500));
      return reply({ success: false, message: "Midtrans belum dapat membuat pembayaran. Periksa konfigurasi server dan coba lagi." }, 502);
    }
    const { error: saveError } = await admin.from("kasusaha_device_activations").update({
      status: "pending_payment", amount: 10000, payment_provider: "midtrans",
      midtrans_order_id: orderId, payment_url: snapData.redirect_url, updated_at: new Date().toISOString(),
    }).eq("id", activation.id).eq("business_id", businessId);
    if (saveError) {
      console.error("Save owner activation payment:", saveError.message);
      return reply({ success: false, message: "Tautan pembayaran dibuat tetapi belum tersimpan. Hubungi dukungan sebelum mencoba lagi." }, 500);
    }
    return reply({ success: true, active: false, status: "pending_payment", amount: 10000, payment_url: snapData.redirect_url });
  } catch (e) {
    console.error("employee-device-activation error:", e);
    return reply({ success: false, message: "Terjadi gangguan saat memproses aktivasi. Coba lagi." }, 500);
  }
});
