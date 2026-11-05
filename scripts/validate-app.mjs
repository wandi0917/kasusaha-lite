import fs from "node:fs";
import vm from "node:vm";

const fail = (message) => {
  console.error("FAIL:", message);
  process.exitCode = 1;
};
const pass = (message) => console.log("PASS:", message);

const html = fs.readFileSync("index.html", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
const costSecurityMigration = fs.readFileSync("supabase/migrations/20261103020843_restrict_store_product_cost_column_access.sql", "utf8");
const employeeSessionMigration = fs.readFileSync("supabase/migrations/20261103062527_allow_paid_employee_invite_sessions_in_transactions.sql", "utf8");
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
const ids = [...markupOnly.matchAll(/(?:^|\s)id\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) fail("duplicate static HTML IDs: " + duplicates.join(", "));
else pass("no duplicate IDs in static HTML markup");

if (!html.includes('class="quick-sale-camera-head"') ||
    !html.includes('id="quickSaleBarcodeClose"') ||
    !html.includes('id="quickSaleBarcodeVideo"')) {
  fail("barcode camera panel markup incomplete");
} else pass("barcode camera panel elements present");

if (!/detail\.includes\(['"]saldo akun biteship['"]\)/.test(html)) {
  fail("localized Biteship balance errors must show the dedicated checkout guidance");
} else pass("localized Biteship balance errors map to dedicated checkout guidance");

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


const employeeSessionChecks = [
  [/const allDisabled=\{barcode:false,/, html, "barcode entitlement must fail closed when package lookup fails"],
  [/m\.role = 'employee' AND private\.kasusaha_employee_device_is_paid\(w\.id\)/, employeeSessionMigration, "anonymous invite-code sessions must be limited to paid active Employees"],
  [/Sesi anonim hanya diizinkan untuk Karyawan/, employeeSessionMigration, "anonymous Owner and unpaid Employee cashier sessions must remain blocked"],
  [/location\.hostname!=='wandi0917\.github\.io'/, html, "legacy GitHub Pages traffic must redirect to the canonical Cloudflare app"],
];
for (const [pattern, source, message] of employeeSessionChecks) {
  if (!pattern.test(source)) fail(message);
  else pass(message);
}

const transactionMenuChecks = [
  [/function syncTransactionRoleMenus\(\)/, html, "transaction menus must synchronize with the logged-in role"],
  [/id="shortcutEmployeeSettings" data-transaction-role="owner"/, html, "employee account settings shortcut must be Owner-only"],
  [/class="transaction-menu" data-transaction-role="owner"><summary><span class="shortcut-icon">📦/, html, "product and stock management menu must be Owner-only"],
  [/data-transaction-role="owner" onclick="pilihJenisCatatTransaksi\('expense'\)"/, html, "expense entry must be Owner-only"],
  [/data-transaction-role="employee" onclick="pilihLaporanTransaksi\('income'\)"/, html, "employee income report must be employee-only"],
  [/data-transaction-role="owner" onclick="pilihLaporanTransaksi\('accounting'\)"/, html, "full accounting report must be Owner-only"],
];
for (const [pattern, source, message] of transactionMenuChecks) {
  if (!pattern.test(source)) fail(message);
  else pass(message);
}

if (!/KS_PACKAGE_PRICES/.test(html) ||
    !/starter:49000/.test(html) ||
    !/lite:99000/.test(html) ||
    !/business:149000/.test(html) ||
    !/professional:249000/.test(html)) {
  fail("four-package checkout prices are missing or inconsistent");
} else pass("four package checkout prices are present");

if (!/const description=\$\('financeDescription'\)\.value\.trim\(\),amount=Number\(\$\('financeAmount'\)\.value\)[\s\S]{0,500}description\.length<2/.test(html)) {
  fail("Owner and Employee transaction form must reject descriptions shorter than two characters");
} else pass("manual finance form requires at least two description characters");

const clientPrivilegeMigration = fs.readFileSync("supabase/migrations/20261105011000_revoke_unsafe_client_table_privileges.sql", "utf8");
if (!/REVOKE\s+TRUNCATE,\s*REFERENCES,\s*TRIGGER,\s*MAINTAIN\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+FROM\s+anon,\s*authenticated/i.test(clientPrivilegeMigration) ||
    !/REVOKE ALL PRIVILEGES\s+ON TABLE\s+public\.store_open_bills\s+FROM anon/i.test(clientPrivilegeMigration) ||
    !/REVOKE DELETE\s+ON TABLE\s+public\.store_open_bills\s+FROM authenticated/i.test(clientPrivilegeMigration)) {
  fail("client roles must not have truncate, trigger, or maintenance privileges on application tables");
} else pass("client table privileges exclude truncate, trigger, and maintenance access");

if (!/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated/i.test(clientPrivilegeMigration)) {
  fail("new public functions must require explicit EXECUTE grants");
} else pass("new public functions default to no client EXECUTE access");





const biteshipRates = fs.readFileSync("supabase/functions/biteship-rates/index.ts", "utf8");
const biteshipBalanceChecks = [
  [/const insufficientBalance = response\.status === 400/, biteshipRates, "Biteship insufficient-balance responses must be identified separately"],
  [/Saldo akun Biteship tidak mencukupi untuk menghitung ongkir/, biteshipRates, "Biteship balance errors must show a clear Indonesian action message"],
  [/insufficientBalance \? 503 : 502/, biteshipRates, "Biteship account-balance failures must not be mislabeled as a generic 502 server error"],
];
for (const [pattern, source, message] of biteshipBalanceChecks) {
  if (!pattern.test(source)) fail(message);
  else pass(message);
}

const paymentCreate = fs.readFileSync("supabase/functions/create-midtrans-payment/index.ts", "utf8");
const paymentWebhook = fs.readFileSync("supabase/functions/midtrans-webhook/index.ts", "utf8");
const marketplaceCreate = fs.readFileSync("supabase/functions/create-marketplace-order/index.ts", "utf8");

const requiredChecks = [
  [/order\.payment_review_required\s*===\s*true/, paymentCreate, "payment creation must block orders requiring review"],
  [/\.eq\(["']buyer_id["'],\s*user\.id\)/, paymentCreate, "payment creation must verify buyer ownership"],
  [/authData\.user\.is_anonymous === true/, marketplaceCreate, "anonymous buyers must be blocked from digital license checkout"],
  [/user\.is_anonymous === true/, paymentCreate, "anonymous buyers must be blocked from digital license payment"],
  [/statusBase\s*\+\s*["']\/v2\/["']/, paymentCreate, "payment creation must verify status against Midtrans Status API"],
  [/function\s+amountMatches/, paymentWebhook, "webhook must compare payment amount"],
  [/constantTimeEqual\s*\(/, paymentWebhook, "webhook must use constant-time signature comparison"],
  [/payment_review_required/, paymentWebhook, "webhook must preserve manual-review hold"],
  [/commission:\$\{item\.id\}/, paymentWebhook, "commission ledger must have an idempotency key"],
  [/\.eq\(["']verification_status["'],\s*["']verified["']\)/, paymentWebhook, "commission recording must require a verified payment event"],
  [/ignoreDuplicates:\s*false/, paymentWebhook, "commission retries must relink legacy rows to the verified event"],
  [/payment_event_id\)\s*===\s*String\(expected\.payment_event_id\)/, paymentWebhook, "commission verification must match the exact verified payment event"],
  [/COMMISSION_RATE\s*=\s*0\.025/, paymentWebhook, "marketplace commission must remain 2.5 percent"],
  [/quote\.used_at/, marketplaceCreate, "shipping quote must not be reusable"],
  [/product_fingerprint/, marketplaceCreate, "shipping quote must match current cart"],
  [/serviceRoleKey\s*=\s*readText\(Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)\)/, marketplaceCreate, "service role key must remain server-side"],
];
for (const [pattern, source, message] of requiredChecks) {
  if (!pattern.test(source)) fail(message);
  else pass(message);
}

if (/SUPABASE_SERVICE_ROLE_KEY|MIDTRANS_SERVER_KEY|BITESHIP_API_KEY/.test(html)) {
  fail("server secrets must never appear in frontend HTML");
} else pass("no known server-secret variable names appear in frontend HTML");

const safeStoreProductGrant = costSecurityMigration.match(/GRANT SELECT\s*\(([\s\S]*?)\)\s*ON TABLE public\.store_products TO authenticated/i);
if (!/REVOKE SELECT ON TABLE public\.store_products FROM authenticated/i.test(costSecurityMigration) ||
    !safeStoreProductGrant ||
    /\bcost_price\b/i.test(safeStoreProductGrant[1])) {
  fail("store_products cost_price must not be selectable by authenticated users");
} else pass("store_products grants exclude cost_price from authenticated column access");



const employeeActivation = fs.readFileSync("supabase/functions/employee-device-activation/index.ts", "utf8");
const licenseActivation = fs.readFileSync("supabase/functions/activate-kasusaha-license/index.ts", "utf8");
const biteshipShipment = fs.readFileSync("supabase/functions/biteship-create-shipment/index.ts", "utf8");
const biteshipWebhook = fs.readFileSync("supabase/functions/biteship-webhook/index.ts", "utf8");

const operationalChecks = [
  [/\.upsert\(batch,\s*\{\s*onConflict:\s*['"]business_id,legacy_ref['"],\s*ignoreDuplicates:\s*true\s*\}\)/, html, "offline sync must be idempotent by business and legacy reference"],
  [/window\.addEventListener\(['"]offline['"],\s*\(\)\s*=>\s*\{[\s\S]{0,300}activateOfflineTransactionMode\(\)/, html, "active transaction tab must show an offline-mode warning when the connection drops"],
  [/select\(['"]id,legacy_ref,transaction_date,transaction_type,amount,description,category,created_by,created_by_role['"]\)[\s\S]{0,260}\.in\(['"]legacy_ref['"],\s*refs\)/, html, "offline sync must read back and verify uploaded references"],
  [/select\(['"]id,legacy_ref,transaction_date,transaction_type,amount,description,category,created_by,created_by_role['"]\)/, html, "offline sync must compare saved row content, not only the legacy reference"],
  [/const mismatched=batch\.find\(row=>\{[\s\S]{0,900}Number\(saved\.amount\)!==Number\(row\.amount\)/, html, "offline sync must keep conflicting local data pending instead of silently marking it synced"],
  [/offline_user_id===sessionUserId&&t\.offline_business_id===businessId&&t\.offline_role==='employee'/, html, "employee offline sync must be restricted to the current employee and business"],
  [/p_request_id:\s*quickSaleRequestId/, html, "cashier must send a stable idempotency request ID"],
  [/kasusaha_quick_sale_pending_v1/, html, "cashier must retain an unresolved request key on the device"],
  [/get_store_product_costs/, html, "owner cost data must be loaded through the protected database function"],
  [/set_store_product_cost/, html, "owner cost edits must use the protected database function"],
  [/getUserMedia/, html, "camera barcode scanner must request a device camera"],
  [/track\.stop\(\)/, html, "camera scanner must release camera tracks on close"],
  [/ZXingBrowser|BarcodeDetector/, html, "camera barcode decoder must be present"],
  [/createdOrderSnapshot/, marketplaceCreate, "marketplace checkout must verify the newly created order snapshot"],
  [/\[7,\s*8,\s*9,\s*10\]\.includes\(Number\(item\.product_id\)\)/, paymentWebhook, "commission must exclude all digital package product IDs 7-10"],
  [/package_code, package_name, cloud_started_at, cloud_expires_at/, licenseActivation, "license status must return package and cloud-term metadata"],
  [/kasusaha_lookup_employee_invite/, employeeActivation, "employee login must look up invite codes through the protected RPC"],
  [/BITESHIP_ENABLE_SHIPMENT_BOOKING/, biteshipShipment, "Biteship shipment booking must remain explicitly gated until verified"],
  [/if \(instantCourier[\s\S]{0,700}const \{ data: lock/, biteshipShipment, "Biteship coordinate validation must happen before locking an order as creating"],
  [/verification_status["']?,\s*["']verified["']/, biteshipShipment, "Biteship shipment creation must require a verified payment event"],
  [/BITESHIP_WEBHOOK_SIGNATURE_KEY/, biteshipWebhook, "Biteship webhook must verify its configured signature key"],
  [/BITESHIP_WEBHOOK_SIGNATURE_SECRET/, biteshipWebhook, "Biteship webhook must verify its configured signature secret"],
];
for (const [pattern, source, message] of operationalChecks) {
  if (!pattern.test(source)) fail(message);
  else pass(message);
}


const employeeCatalogMigration = fs.readFileSync("supabase/migrations/20261105120000_reassert_store_product_employee_read_privileges.sql", "utf8");
const employeeCatalogChecks = [
  [html.includes('data-transaction-role="employee"><summary') && html.includes("Daftar Barang &amp; Barcode"), "Employee must have a dedicated product and barcode catalog menu"],
  [html.includes('id="employeeProductCatalogRows"'), "Employee catalog table must be present"],
  [html.includes("function renderEmployeeProductCatalog()"), "Employee catalog must render product, barcode, selling price and stock"],
  [html.includes("Hubungi atasan atau Owner untuk entri barang dan stok terlebih dahulu"), "unknown barcode scan must instruct Employee to contact Owner"],
  [html.includes("Entri barang baru (Owner)"), "Owner must have a shortcut to enter a newly scanned barcode as a new product"],
  [employeeCatalogMigration.includes("REVOKE SELECT ON TABLE public.store_products FROM authenticated"), "reasserted product catalog migration must revoke table-wide SELECT"],
  [employeeCatalogMigration.includes("GRANT SELECT ("), "reasserted product catalog migration must grant only explicit catalog columns"],
];
for (const [ok, message] of employeeCatalogChecks) {
  if (!ok) fail(message);
  else pass(message);
}
const safeCatalogGrant = employeeCatalogMigration.split("GRANT SELECT (")[1]?.split(") ON TABLE public.store_products TO authenticated")[0] || "";
if (!safeCatalogGrant || safeCatalogGrant.includes("cost_price")) {
  fail("Employee catalog SELECT grant must exclude cost_price");
} else pass("Employee catalog SELECT grant excludes cost_price");

if (process.exitCode) process.exit(process.exitCode);
