import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  return new Response(JSON.stringify({
    success: false,
    code: "LEGACY_NOTIFICATION_RETIRED",
    message: "Endpoint notifikasi lama dinonaktifkan. Konfigurasikan Midtrans ke endpoint midtrans-webhook agar pembayaran, komisi, dan lisensi diproses melalui alur verifikasi utama.",
  }), {
    status: 410,
    headers,
  });
});