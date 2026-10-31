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
    code: "RECOVERY_ENDPOINT_RETIRED",
    message: "Endpoint pemulihan satu kali telah dinonaktifkan. Gunakan alur pembayaran dan webhook Midtrans utama.",
  }), {
    status: 410,
    headers,
  });
});