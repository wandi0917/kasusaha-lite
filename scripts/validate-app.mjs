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

if (process.exitCode) process.exit(process.exitCode);
