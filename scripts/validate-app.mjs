import fs from "node:fs";
import vm from "node:vm";

const fail = (message) => {
  console.error("FAIL:", message);
  process.exitCode = 1;
};
const pass = (message) => console.log("PASS:", message);

const html = fs.readFileSync("index.html", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
const manifestText = fs.readFileSync("manifest.webmanifest", "utf8");

try {
  const manifest = JSON.parse(manifestText);
  if (!manifest.name || !manifest.start_url || !Array.isArray(manifest.icons)) {
    fail("manifest.webmanifest missing required PWA fields");
  } else pass("manifest.webmanifest valid JSON and required PWA fields");
} catch (error) {
  fail("manifest.webmanifest invalid JSON: " + error.message);
}

const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
let inlineCount = 0;
for (let i = 0; i < scriptTags.length; i++) {
  const attrs = scriptTags[i][1];
  const source = scriptTags[i][2];
  if (/\bsrc\s*=/.test(attrs)) continue;
  if (!source.trim()) continue;
  inlineCount++;
  try {
    new vm.Script(source, { filename: "index.html:inline-script-" + i });
  } catch (error) {
    fail("inline script " + i + " syntax error: " + error.message);
  }
}
if (inlineCount && !process.exitCode) pass(inlineCount + " inline JavaScript blocks parse successfully");

try {
  new vm.Script(sw, { filename: "sw.js" });
  pass("sw.js syntax valid");
} catch (error) {
  fail("sw.js syntax error: " + error.message);
}

const markupOnly = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
const ids = [...markupOnly.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) fail("duplicate static HTML IDs: " + duplicates.join(", "));
else pass("no duplicate IDs in static HTML markup");

if (!html.includes('class="quick-sale-camera-head"') ||
    !html.includes('id="quickSaleBarcodeClose"') ||
    !html.includes('id="quickSaleBarcodeVideo"')) {
  fail("barcode camera panel markup incomplete");
} else pass("barcode camera panel elements present");

if (!/getUserMedia/.test(html) || !/ZXingBrowser|BarcodeDetector/.test(html)) {
  fail("camera barcode scanning dependencies or API are missing");
} else pass("camera barcode scanner code present");

if (!/OFFLINE_WORKSPACE_KEY/.test(html) ||
    !/offlineTransactionBanner/.test(html) ||
    !/disimpan hanya di perangkat/i.test(html)) {
  fail("offline mode disclosure or local workspace support missing");
} else pass("offline mode explicitly discloses local-only storage");

const supabaseKeyAssignment = html.match(/SUPABASE_KEY\s*=\s*["']([^"']+)["']/i)?.[1] || "";
if (/^(?:sb_secret_|service_role)/i.test(supabaseKeyAssignment)) {
  fail("server-only Supabase secret appears in the frontend key assignment");
} else if (/^sb_publishable_/.test(supabaseKeyAssignment)) {
  pass("frontend uses a publishable Supabase key; no service-role key assignment detected");
} else {
  fail("Supabase frontend key assignment is missing or uses an unrecognized key format");
}

if (!/CACHE_PREFIX/.test(sw) || !/request\.method !== 'GET'/.test(sw)) {
  fail("service worker cache safety guard missing");
} else pass("service worker limits caching to GET requests");


if (!/kasusaha_get_business_package_entitlements/.test(html) ||
    !/package-no-full-finance/.test(html) ||
    !/package-no-attendance/.test(html) ||
    !/package-no-employees/.test(html) ||
    !/package-no-barcode/.test(html)) {
  fail("package entitlement lookup or UI feature gates are missing");
} else pass("package entitlements are loaded and UI feature gates are present");

if (!/KS_PACKAGE_PRICES/.test(html) ||
    !/starter:49000/.test(html) ||
    !/lite:99000/.test(html) ||
    !/business:149000/.test(html) ||
    !/professional:249000/.test(html)) {
  fail("four-package checkout prices are missing or inconsistent");
} else pass("four package checkout prices are present");


const paymentCreate = fs.readFileSync("supabase/functions/create-midtrans-payment/index.ts", "utf8");
const paymentWebhook = fs.readFileSync("supabase/functions/midtrans-webhook/index.ts", "utf8");
const marketplaceCreate = fs.readFileSync("supabase/functions/create-marketplace-order/index.ts", "utf8");

const requiredChecks = [
  [/order\.payment_review_required\s*===\s*true/, paymentCreate, "payment creation must block orders requiring review"],
  [/\.eq\(["']buyer_id["'],\s*user\.id\)/, paymentCreate, "payment creation must verify buyer ownership"],
  [/statusBase\s*\+\s*["']\/v2\/["']/, paymentCreate, "payment creation must verify status against Midtrans Status API"],
  [/function\s+amountMatches/, paymentWebhook, "webhook must compare payment amount"],
  [/constantTimeEqual\s*\(/, paymentWebhook, "webhook must use constant-time signature comparison"],
  [/payment_review_required/, paymentWebhook, "webhook must preserve manual-review hold"],
  [/commission:\$\{item\.id\}/, paymentWebhook, "commission ledger must have an idempotency key"],
  [/COMMISSION_RATE\s*=\s*0\.025/, paymentWebhook, "marketplace commission must remain 2.5 percent"],
  [/quote\.used_at/, marketplaceCreate, "shipping quote must not be reusable"],
  [/product_fingerprint/, marketplaceCreate, "shipping quote must match current cart"],
  [/serviceKey\s*=\s*Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)/, marketplaceCreate, "service role key must remain server-side"],
];
for (const [pattern, source, message] of requiredChecks) {
  if (!pattern.test(source)) fail(message);
  else pass(message);
}

if (/SUPABASE_SERVICE_ROLE_KEY|MIDTRANS_SERVER_KEY|BITESHIP_API_KEY/.test(html)) {
  fail("server secrets must never appear in frontend HTML");
} else pass("no known server-secret variable names appear in frontend HTML");

if (process.exitCode) process.exit(process.exitCode);
