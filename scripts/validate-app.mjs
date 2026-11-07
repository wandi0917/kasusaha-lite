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
const storeProductsEntitlementMigration = fs.readFileSync("supabase/migrations/20261106115240_guard_store_products_by_license_and_entitlement.sql", "utf8");
const backupRestoreChecks = html.slice(html.indexOf("function impor(){"), html.indexOf("function hapusSemua()", html.indexOf("function impor(){")));
const biteshipShipmentSource = fs.readFileSync("supabase/functions/biteship-create-shipment/index.ts", "utf8");
const marketplaceFinance = fs.readFileSync("supabase/functions/platform-marketplace-finance/index.ts", "utf8");
const failClosedStoreCostMigration = fs.readFileSync("supabase/migrations/20261106113748_fail_closed_store_product_cost_entitlement.sql", "utf8");
const failClosedFinanceMigration = fs.readFileSync("supabase/migrations/20261106113750_fail_closed_package_entitlement_helper_and_finance_rpcs.sql", "utf8");
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

const navigationTargets = [...markupOnly.matchAll(/(?:buka|openTab)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
const missingNavigationTargets = [...new Set(navigationTargets.filter((target) => !ids.includes(target)))];
if (missingNavigationTargets.length) {
  fail("navigation buttons target missing sections: " + missingNavigationTargets.join(", "));
} else pass(navigationTargets.length + " navigation targets resolve to existing HTML sections");
 
const appNavigationScript = scriptTags.map((tag) => tag[2]).find((source) => source.includes("async function buka(")) || "";
const globalNavigationChecks = [
  [ /window\.buka\s*=\s*buka/.test(appNavigationScript), "main navigation function must be exported globally for HTML menu buttons" ],
  [ /window\.bukaKotakSaran\s*=/.test(html), "suggestion navigation handler must be exported globally" ],
  [ /window\.bukaKotakSaranMasuk\s*=/.test(html), "suggestion inbox navigation handler must be exported globally" ],
  [ /data-id="\s*'\s*\+\s*aman\(r\.id\)\s*\+\s*'"\s+onclick="mulaiEditFinanceTransaction\(this\.dataset\.id\)"/.test(html), "finance report edit action must use a safely bound row ID" ],
  [ /data-id="\s*'\s*\+\s*aman\(r\.id\)\s*\+\s*'"\s+onclick="hapusFinanceTransaction\(this\.dataset\.id\)"/.test(html), "finance report delete action must use a safely bound row ID" ],
];
for (const [ok, message] of globalNavigationChecks) {
  if (!ok) fail(message);
  else pass(message);
}


if (!html.includes('class="quick-sale-camera-head"') ||
    !html.includes('id="quickSaleBarcodeClose"') ||
    !html.includes('id="quickSaleBarcodeVideo"')) {
  fail("barcode camera panel markup incomplete");
} else pass("barcode camera panel elements present");

if (!/detail\.includes\(['"]saldo akun biteship['"]\)/.test(html)) {
  fail("localized Biteship balance errors must show the dedicated checkout guidance");
} else pass("localized Biteship balance errors map to dedicated checkout guidance");

const barcodeScanStart = html.indexOf("function addScannedBarcodeToQuickSale(raw){");
const barcodeScanEnd = html.indexOf("\nfunction handleQuickSaleCameraResult", barcodeScanStart);
const barcodeScan = html.slice(barcodeScanStart, barcodeScanEnd);
const cameraStart = html.indexOf("function handleQuickSaleCameraResult(raw){");
const cameraEnd = html.indexOf("\nasync function ensureKasUsahaZXing", cameraStart);
const cameraScan = html.slice(cameraStart, cameraEnd);
const barcodeRegressionChecks = [
  [barcodeScan.includes("qty.value=String(current+1)"), "repeated product scans must increment quantity"],
  [barcodeScan.includes("qtyField.value='1'"), "first product scan must add one unit automatically"],
  [barcodeScan.includes("current>=available"), "repeated scans must not exceed available stock"],
  [barcodeScan.includes("quickSaleBarcodeModal')?.hidden!==false"), "camera mode must not force keyboard focus over the camera"],
  [cameraScan.includes("if(added)setQuickSaleBarcodeStatus") && !cameraScan.includes("if(added)closeQuickSaleBarcodeCamera()"), "camera cart scanning must remain open for consecutive products"],
  [html.includes("barcodeInput.focus({preventScroll:true})"), "cashier must focus the scanner input when opening a sale"],
];
for (const [ok, message] of barcodeRegressionChecks) {
  if (!ok) fail(message);
  else pass(message);
}

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


const failClosedEntitlementChecks = [
  [failClosedStoreCostMigration.includes("IS DISTINCT FROM true") &&
   failClosedStoreCostMigration.includes("private.kasusaha_business_has_feature"), "store product cost RPC must deny missing/NULL full_finance entitlement"],
  [failClosedFinanceMigration.includes("SELECT coalesce((") &&
   failClosedFinanceMigration.includes("), false);"), "package entitlement helper must return false when no verified matching entitlement exists"],
  [failClosedFinanceMigration.includes("kasusaha_business_has_feature(v_business_id,'full_finance') IS DISTINCT FROM true"), "finance journal posting must deny missing/NULL entitlement"],
  [failClosedFinanceMigration.includes("kasusaha_business_has_feature(v_item.business_id,'full_finance') IS DISTINCT FROM true"), "finance open-item settlement must deny missing/NULL entitlement"],
];
for (const [ok, message] of failClosedEntitlementChecks) {
  if (!ok) fail(message);
  else pass(message);
}

const biteshipAmbiguousBookingChecks = [
  [biteshipShipmentSource.includes("const definitelyRejected = response.status >= 400") &&
   biteshipShipmentSource.includes("obj(result) && result.success === false"),
   "Biteship booking lock may be released only on an explicit provider rejection"],
  [biteshipShipmentSource.includes("Keep shipping_status='creating'") &&
   biteshipShipmentSource.includes("uncertain: true"),
   "ambiguous Biteship responses must retain the shipment lock to prevent duplicates"],
];
for (const [ok, message] of biteshipAmbiguousBookingChecks) {
  if (!ok) fail(message);
  else pass(message);
}

const backupDisclosure = /Cadangan JSON ini hanya berisi data lokal[\s\S]{0,300}Data transaksi server, katalog online, akun, lisensi, dan pembayaran di Supabase tidak termasuk/.test(html);
if (!backupDisclosure) fail("backup UI must clearly disclose that JSON export excludes server-side data");
else pass("backup UI clearly discloses local-only scope and server data exclusions");

const backupRestoreAssertions = [
  [backupRestoreChecks.includes("const previous={}") && backupRestoreChecks.includes("localStorage.getItem(key)"), "backup restore must snapshot existing local data before replacement"],
  [backupRestoreChecks.includes("rollbackFailed") && backupRestoreChecks.includes("localStorage.removeItem(key)"), "backup restore must roll back partially written localStorage keys on failure"],
  [backupRestoreChecks.includes("localStorage.setItem(key,next[name])") && !backupRestoreChecks.includes("simpan();"), "backup restore must verify all local writes before reporting success"],
];
for (const [ok, message] of backupRestoreAssertions) {
  if (!ok) fail(message);
  else pass(message);
}

const storeProductsEntitlementChecks = [
  [storeProductsEntitlementMigration.includes("store_products_member_select") &&
   storeProductsEntitlementMigration.includes("store_products_owner_insert") &&
   storeProductsEntitlementMigration.includes("store_products_owner_update") &&
   storeProductsEntitlementMigration.includes("store_products_owner_delete"),
   "all store_products RLS policies must be covered by the entitlement migration"],
  [(storeProductsEntitlementMigration.match(/kasusaha_business_license_is_verified/g)||[]).length >= 5 &&
   (storeProductsEntitlementMigration.match(/kasusaha_business_has_feature/g)||[]).length >= 5,
   "store_products read/write policies must require verified license and basic_stock entitlement"],
];
for (const [ok, message] of storeProductsEntitlementChecks) {
  if (!ok) fail(message);
  else pass(message);
}

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

const sellerAccountShortcut = html.includes("buka('akun',document.querySelector('nav button[onclick*=\\'akun\\']'))") &&
  !html.includes("buka('akunPenjual'");
if (!sellerAccountShortcut) fail("seller account shortcut must navigate to the existing Owner/Seller account page");
else pass("seller account shortcut navigates to the existing Owner/Seller account page");

const financeUnlicensedMessage = /errorCode==='P0001'[\s\S]{0,240}Paket aktif dan pembayaran terverifikasi tidak ditemukan[\s\S]{0,260}Fitur akuntansi lengkap memerlukan lisensi KasUsaha Lite yang aktif/.test(html);
if (!financeUnlicensedMessage) fail("unlicensed finance access must show a clear license activation message instead of a raw database exception");
else pass("unlicensed finance access shows a clear license activation message");

const financeEnsureAccountsStart = html.indexOf("async function financeAccountingEnsureAccounts(){");
const financeEnsureAccountsEnd = html.indexOf("\nasync function loadFinanceAccounting(){", financeEnsureAccountsStart);
const financeEnsureAccountsBlock = financeEnsureAccountsStart >= 0 && financeEnsureAccountsEnd > financeEnsureAccountsStart
  ? html.slice(financeEnsureAccountsStart, financeEnsureAccountsEnd)
  : "";
const financeEnsureGuard = financeEnsureAccountsBlock.indexOf("await loadFinancePackageFeatures(financeBusiness.id)");
const financeEnsureInsert = financeEnsureAccountsBlock.indexOf("sb.from('finance_accounts').insert(payload)");
if (financeEnsureGuard < 0 ||
    !financeEnsureAccountsBlock.includes("packageAccess.features.full_finance!==true") ||
    financeEnsureInsert < financeEnsureGuard) {
  fail("finance account seeding helper must independently verify full_finance entitlement before inserting default accounts");
} else pass("finance account seeding helper independently verifies full_finance entitlement before inserting default accounts");

const financeAccountingStart = html.indexOf("async function loadFinanceAccounting(){");
const financeAccountingEnd = html.indexOf("function financeAccountingPopulateControls", financeAccountingStart);
const financeAccountingBlock = financeAccountingStart >= 0 && financeAccountingEnd > financeAccountingStart
  ? html.slice(financeAccountingStart, financeAccountingEnd)
  : "";
const financeEntitlementGuard = financeAccountingBlock.indexOf("await loadFinancePackageFeatures(financeBusiness.id)");
const financeAccountSeed = financeAccountingBlock.indexOf("await financeAccountingEnsureAccounts()");
if (financeEntitlementGuard < 0 ||
    !financeAccountingBlock.includes("packageAccess.features.full_finance!==true") ||
    financeAccountSeed < financeEntitlementGuard) {
  fail("accounting module must verify active full_finance entitlement before seeding finance accounts");
} else pass("accounting module verifies full_finance entitlement before seeding finance accounts");

const serviceFeePanelStart = html.indexOf("async function renderOwnerServiceFeePanel(){");
const serviceFeePanelBlock = serviceFeePanelStart >= 0 ? html.slice(serviceFeePanelStart, serviceFeePanelStart + 12000) : "";
const serviceFeeContextChecks = [
  [html.includes("if(member)financeSelectedBusinessId=member.business_id"), "single-workspace login must retain the verified business ID"],
  [serviceFeePanelBlock.includes("const panelBusinessId=String(financeBusiness?.id||'').trim()"), "service-fee preview must capture the verified business ID when rendered"],
  [serviceFeePanelBlock.includes("panelBusinessId||financeBusiness?.id||financeSelectedBusinessId"), "service-fee consent must use the captured workspace context before transient UI state"],
  [serviceFeePanelBlock.includes("panelOwnerId!==financeMemberUserId"), "service-fee consent must reject stale owner context"],
];
for (const [ok, message] of serviceFeeContextChecks) {
  if (!ok) fail(message);
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

const clientPrivilegeMigration = fs.readFileSync("supabase/migrations/20261105014210_revoke_unsafe_client_table_privileges.sql", "utf8");
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



const createMidtrans = fs.readFileSync("supabase/functions/create-midtrans-payment/index.ts", "utf8");
const biteshipCreateShipment = fs.readFileSync("supabase/functions/biteship-create-shipment/index.ts", "utf8");
const employeeActivation = fs.readFileSync("supabase/functions/employee-device-activation/index.ts", "utf8");
const licenseActivation = fs.readFileSync("supabase/functions/activate-kasusaha-license/index.ts", "utf8");
const biteshipShipment = fs.readFileSync("supabase/functions/biteship-create-shipment/index.ts", "utf8");
const biteshipWebhook = fs.readFileSync("supabase/functions/biteship-webhook/index.ts", "utf8");

const physicalMarketplaceGate = /production && hasPhysicalProduct && norm\(Deno\.env\.get\("MARKETPLACE_PRODUCTION_PAYMENTS_ENABLED"\)\) !== "true"/.test(createMidtrans);
if (!physicalMarketplaceGate) fail("physical marketplace Production payments must require a separate explicit enable flag");
else pass("physical marketplace Production payments are independently gated from digital license checkout");

const midtransCreateGate = createMidtrans.indexOf("if (!productionPaymentsEnabled(production))");
const midtransCreateRequest = createMidtrans.indexOf('snapBase + "/snap/v1/transactions"');
if (midtransCreateGate < 0 || midtransCreateRequest < midtransCreateGate) {
  fail("new Production package/marketplace payments must be gated by MIDTRANS_PRODUCTION_PAYMENTS_ENABLED");
} else pass("new Production package/marketplace payments require the explicit server-side enable flag");

const employeeSnapGateCount = (employeeActivation.match(/if \(!productionPaymentsEnabled\(production\)\)/g) || []).length;
const employeeSnapRequestCount = (employeeActivation.match(/\/snap\/v1\/transactions/g) || []).length;
if (employeeSnapGateCount !== 2 || employeeSnapRequestCount !== 2) {
  fail("both employee invite and device activation payment creation paths must require the explicit Production enable flag");
} else pass("employee invite and device activation payment creation are both Production-gated");

if (!/const transactionIdMatches =\s*Boolean\(statusApiTransactionId\)\s*&&\s*\(!notificationTransactionId \|\| notificationTransactionId === statusApiTransactionId\);/.test(paymentWebhook)) {
  fail("Midtrans webhook must require a transaction_id from Status API and match notification transaction_id when present");
} else pass("Midtrans webhook requires and cross-checks the Status API transaction_id");

const refundReviewChecks = [
  [/const reviewStatuses = \[\s*"refund",\s*"partial_refund",\s*"chargeback",\s*"partial_chargeback"/, paymentWebhook, "refund and chargeback statuses must enter manual review"],
  [/payment_review_required: true,[\s\S]{0,260}payment_review_note: reviewNote/, paymentWebhook, "refund and chargeback must set the order payment-review hold"],
  [/\.from\("license_partner_commission_ledger"\)[\s\S]{0,260}status: "held"/, paymentWebhook, "unpaid or approved partner commissions must be held on refund or chargeback"],
  [/Tidak ada pencabutan lisensi atau clawback otomatis/, paymentWebhook, "refund review must not automatically revoke licenses or claw back paid commissions"],
  [/for \(const row of paidPartnerRows \?\? \[\]\) \{[\s\S]{0,1200}\.update\(\{ notes: paidReviewNote \}\)[\s\S]{0,200}\.eq\("id", row\.id\)[\s\S]{0,200}\.eq\("status", "paid"\)/, paymentWebhook, "already-paid partner commissions must be annotated for manual review, not clawed back"],
];
for (const [pattern, source, message] of refundReviewChecks) {
  if (!pattern.test(source)) fail(message);
  else pass(message);
}

if (!/isLiveBiteshipKey && Deno\.env\.get\("BITESHIP_PRODUCTION_BOOKING_ENABLED"\) !== "true"/.test(biteshipCreateShipment)) {
  fail("live Biteship API keys must require a separate production booking flag");
} else pass("live Biteship shipment creation requires a separate explicit production flag");

if (!/isTestBiteshipKey[\s\S]{0,220}BITESHIP_PRODUCTION_BOOKING_ENABLED/.test(paymentWebhook)) {
  fail("Midtrans webhook must not call live Biteship booking without the separate production flag");
} else pass("Midtrans webhook only triggers live Biteship booking when the production flag is enabled");

const payoutBalanceChecks = [
  [marketplaceFinance.includes('const pending = sum(payouts.filter((x) => ["pending", "submitted"].includes(x.status)));') &&
    marketplaceFinance.includes("const availableNotPaidOut = net - paid - pending;"),
    "pending and submitted marketplace payouts must reserve funds from available balance"],
  [marketplaceFinance.includes("available_not_paid_out: availableNotPaidOut,"),
    "platform finance response must publish the reserved available balance"],
];
for (const [ok, message] of payoutBalanceChecks) {
  if (!ok) fail(message);
  else pass(message);
}

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


const employeeCatalogMigration = fs.readFileSync("supabase/migrations/20261105081707_reassert_store_product_employee_read_privileges.sql", "utf8");
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

const employeeWebhookStart = paymentWebhook.indexOf('if (/^(?:KSEMP|KSDEV)-[A-F0-9]{32}$/i.test(midtransOrderId))');
const employeeWebhookEnd = paymentWebhook.indexOf("const orderSelect", employeeWebhookStart);
const employeeWebhookBlock = employeeWebhookStart >= 0 && employeeWebhookEnd > employeeWebhookStart
  ? paymentWebhook.slice(employeeWebhookStart, employeeWebhookEnd)
  : "";
if (!employeeWebhookBlock.includes("if (!notificationSignatureValid)") ||
    !employeeWebhookBlock.includes('code: "INVALID_NOTIFICATION_SIGNATURE"') ||
    employeeWebhookBlock.indexOf("if (!notificationSignatureValid)") > employeeWebhookBlock.indexOf("success: true")) {
  fail("employee activation webhook must reject invalid Midtrans signatures before acknowledging receipt");
} else pass("employee activation webhook rejects invalid Midtrans signatures before acknowledging receipt");

if (employeeActivation.includes("productionForCheck") ||
    !employeeActivation.includes("midtransBases(production)")) {
  fail("employee Owner invite refresh must use the configured Midtrans mode variable");
} else pass("employee Owner invite refresh uses the configured Midtrans mode variable");

const protectedBuyerStart = html.indexOf("async function muatPesananSaya(){");
const protectedBuyerEnd = html.indexOf("async function mulaiPembayaranMidtrans", protectedBuyerStart);
const protectedBuyerBlock = protectedBuyerStart >= 0 && protectedBuyerEnd > protectedBuyerStart
  ? html.slice(protectedBuyerStart, protectedBuyerEnd)
  : "";
const protectedPaymentStart = protectedBuyerEnd;
const protectedPaymentEnd = html.indexOf("async function muatPesananMasuk", protectedPaymentStart);
const protectedPaymentBlock = protectedPaymentStart >= 0 && protectedPaymentEnd > protectedPaymentStart
  ? html.slice(protectedPaymentStart, protectedPaymentEnd)
  : "";
const protectedSellerStart = protectedPaymentEnd;
const protectedSellerEnd = html.indexOf("function resetFilterPasar", protectedSellerStart);
const protectedSellerBlock = protectedSellerStart >= 0 && protectedSellerEnd > protectedSellerStart
  ? html.slice(protectedSellerStart, protectedSellerEnd)
  : "";
const protectedPublishStart = html.indexOf("async function terbitkanProdukLokal(");
const protectedPublishEnd = html.indexOf("async function siapkanFotoOnline", protectedPublishStart);
const protectedPublishBlock = protectedPublishStart >= 0 && protectedPublishEnd > protectedPublishStart
  ? html.slice(protectedPublishStart, protectedPublishEnd)
  : "";
for (const [block, label] of [
  [protectedBuyerBlock, "buyer order and license workflows"],
  [protectedPaymentBlock, "Midtrans payment workflow"],
  [protectedSellerBlock, "seller incoming-order and shipping workflow"],
  [protectedPublishBlock, "seller product publishing workflow"],
]) {
  if (!block.includes("getVerifiedAppSession()") || block.includes("sb.auth.getSession()")) {
    fail(label + " must refresh and verify the authenticated session before protected requests");
  } else pass(label + " refreshes and verifies the session before protected requests");
}

// Production cutover gate: new payment requests must fail closed until explicitly enabled.
const paymentGate = 'if (production && norm(Deno.env.get("MIDTRANS_PRODUCTION_PAYMENTS_ENABLED")) !== "true")';
for (const [source, label] of [
  [paymentCreate, "package checkout"],
  [employeeActivation, "employee device activation"],
]) {
  if (!source.includes(paymentGate) || !source.includes("PRODUCTION_PAYMENTS_NOT_ENABLED")) {
    fail(label + " must require the explicit Midtrans Production cutover gate");
  } else pass(label + " requires the explicit Midtrans Production cutover gate");
}
if (paymentWebhook.includes("MIDTRANS_PRODUCTION_PAYMENTS_ENABLED")) {
  fail("Midtrans webhook must remain available for authentic in-flight settlement and refund notifications");
} else pass("Midtrans webhook is not blocked by the new-payment cutover gate");

const employeeMarkPaidStart = employeeActivation.indexOf("async function markPaid()");
const employeeMarkPaidEnd = employeeActivation.indexOf('if (action === "owner_check")', employeeMarkPaidStart);
const employeeMarkPaidBlock = employeeMarkPaidStart >= 0 && employeeMarkPaidEnd > employeeMarkPaidStart
  ? employeeActivation.slice(employeeMarkPaidStart, employeeMarkPaidEnd)
  : "";
const employeeRevokeStart = employeeActivation.indexOf('if (action === "owner_revoke_code")');
const employeeRevokeEnd = employeeActivation.indexOf('if (action === "owner_deactivate")', employeeRevokeStart);
const employeeRevokeBlock = employeeRevokeStart >= 0 && employeeRevokeEnd > employeeRevokeStart
  ? employeeActivation.slice(employeeRevokeStart, employeeRevokeEnd)
  : "";
if (!employeeMarkPaidBlock.includes('.eq("status", "pending_payment")') ||
    !employeeMarkPaidBlock.includes('current?.status === "revoked"')) {
  fail("late Midtrans payment checks must not overwrite a revoked employee activation");
} else pass("late Midtrans payment checks cannot overwrite a revoked employee activation");

const employeeMemberActivationWrite = employeeMarkPaidBlock.indexOf('.update({ active: true })');
const employeeFinalActivationCheck = employeeMarkPaidBlock.indexOf('const { data: confirmedActivation');
const employeeFailClosedWrite = employeeMarkPaidBlock.indexOf('.update({ active: false })', employeeFinalActivationCheck);
if (employeeMemberActivationWrite < 0 || employeeFinalActivationCheck <= employeeMemberActivationWrite ||
    employeeFailClosedWrite <= employeeFinalActivationCheck ||
    !employeeMarkPaidBlock.includes('confirmedActivation?.status !== "paid"')) {
  fail("late Midtrans checks must revalidate activation after membership update and fail closed after a concurrent revocation");
} else pass("late Midtrans checks revalidate activation after membership update and fail closed after concurrent revocation");
if (!employeeRevokeBlock.includes("activationRevokeError") ||
    !employeeRevokeBlock.includes("memberRevokeError") ||
    employeeRevokeBlock.indexOf("activationRevokeError") > employeeRevokeBlock.indexOf("memberRevokeError")) {
  fail("employee invite-code revocation must persist activation revocation before deactivating membership");
} else pass("employee invite-code revocation persists activation revocation before deactivating membership");

const employeeDeactivateStart = employeeActivation.indexOf('if (action === "owner_deactivate")');
const employeeDeactivateEnd = employeeActivation.indexOf('return reply({ success: true, active: false', employeeDeactivateStart);
const employeeDeactivateBlock = employeeDeactivateStart >= 0 && employeeDeactivateEnd > employeeDeactivateStart
  ? employeeActivation.slice(employeeDeactivateStart, employeeDeactivateEnd)
  : "";
if (!employeeDeactivateBlock.includes("revokeError") ||
    employeeDeactivateBlock.indexOf("revokeError") > employeeDeactivateBlock.indexOf("memberUpdateError")) {
  fail("owner deactivation must revoke employee activations before deactivating membership");
} else pass("owner deactivation revokes employee activations before deactivating membership");

const employeeOwnerListStart = employeeActivation.indexOf('if (action === "owner_list")');
const employeeOwnerListEnd = employeeActivation.indexOf('if (action === "owner_deactivate" || action === "owner_reactivate")', employeeOwnerListStart);
const employeeOwnerListBlock = employeeOwnerListStart >= 0 && employeeOwnerListEnd > employeeOwnerListStart ? employeeActivation.slice(employeeOwnerListStart, employeeOwnerListEnd) : "";
if (!employeeOwnerListBlock.includes('.eq("status", "pending_payment")') || !employeeOwnerListBlock.includes('.select("id").maybeSingle()') || !employeeOwnerListBlock.includes('confirmedActivation?.status !== "paid"') || !employeeOwnerListBlock.includes('.update({ active: false })')) fail("Owner list Midtrans refresh must use compare-and-set and fail closed after a concurrent revocation"); else pass("Owner list Midtrans refresh uses compare-and-set and fails closed after concurrent revocation");

const employeeOwnerIdentityStart = employeeActivation.indexOf('if (action === "owner_deactivate" || action === "owner_reactivate")');
const employeeOwnerIdentityEnd = employeeActivation.indexOf('if (action === "owner_delete_inactive")', employeeOwnerIdentityStart);
const employeeOwnerIdentityBlock = employeeOwnerIdentityStart >= 0 && employeeOwnerIdentityEnd > employeeOwnerIdentityStart ? employeeActivation.slice(employeeOwnerIdentityStart, employeeOwnerIdentityEnd) : "";
if (!employeeOwnerIdentityBlock.includes('kasusaha_owner_employee_directory') || !employeeOwnerIdentityBlock.includes('.in("user_id", targetUserIds)') || !employeeOwnerIdentityBlock.includes('restoredStatus')) fail("Owner deactivation/reactivation must apply to the canonical employee identity and all aliases"); else pass("Owner deactivation/reactivation applies to the canonical employee identity and all aliases");

const employeeJoinCodeStart = employeeActivation.indexOf('if (action === "employee_join_code")');
const employeeJoinCodeEnd = employeeActivation.indexOf('if (action === "owner_create_code")', employeeJoinCodeStart);
const employeeJoinCodeBlock = employeeJoinCodeStart >= 0 && employeeJoinCodeEnd > employeeJoinCodeStart ? employeeActivation.slice(employeeJoinCodeStart, employeeJoinCodeEnd) : "";
if (!employeeJoinCodeBlock.includes('canonicalActivation?.status !== "paid"')) fail("Historical employee aliases must not restore access after the canonical activation was revoked"); else pass("Historical employee aliases cannot restore access after the canonical activation was revoked");

if (!employeeJoinCodeBlock.includes('finalCanonicalActivation?.status !== "paid"') ||
    !employeeJoinCodeBlock.includes('revokeAliasActivationError') ||
    !employeeJoinCodeBlock.includes('deactivateAliasMemberError')) {
  fail("historical alias login must recheck canonical activation after writes and fail closed on concurrent revocation");
} else pass("historical alias login rechecks canonical activation after writes and fails closed on concurrent revocation");

if (!employeeOwnerListBlock.includes('historicalUserIds.has(row.user_id)')) {
  fail("Owner list payment refresh must not independently reactivate historical alias sessions");
} else pass("Owner list payment refresh skips historical alias sessions");

if (!employeeOwnerListBlock.includes('.eq("status", "pending_payment")') ||
    !employeeOwnerListBlock.includes('.select("id").maybeSingle()') ||
    !employeeOwnerListBlock.includes('if (paidInviteRow)') ||
    !employeeOwnerListBlock.includes('currentInvite.status')) {
  fail("Owner list invite payment refresh must not overwrite a concurrent Owner revocation or misreport its status");
} else pass("Owner list invite payment refresh preserves concurrent Owner revocation status");

if (!employeeRevokeBlock.includes("bindingsError") || !employeeRevokeBlock.includes("boundUserIds") || !employeeRevokeBlock.includes("invite.user_id")) fail("employee invite revocation must verify all session bindings and include the canonical user"); else pass("employee invite revocation verifies all session bindings and includes the canonical user");

// Midtrans paid-at parser and webhook integrity regression tests.
const paidAtFunctionMatch = paymentWebhook.match(
  /function midtransPaidAt\(status: JsonObject\): string \| null \{[\s\S]*?\n\}/,
);
if (!paidAtFunctionMatch) {
  fail("Midtrans webhook must parse provider-paid timestamps");
} else {
  try {
    const executablePaidAtFunction = paidAtFunctionMatch[0]
      .replace("(status: JsonObject): string | null", "(status)");
    const midtransPaidAt = vm.runInNewContext("(" + executablePaidAtFunction + ")");
    const cases = [
      [{ settlement_time: "2026-11-06 10:15:30" }, "2026-11-06T03:15:30.000Z"],
      [{ settlement_time: "   ", transaction_time: "2026-11-06 10:10:00" }, "2026-11-06T03:10:00.000Z"],
      [{ settlement_time: "bad", transaction_time: "2026-11-06T10:10:00+07:00" }, "2026-11-06T03:10:00.000Z"],
      [{ settlement_time: "2026-02-30 10:15:30" }, null],
      [{ settlement_time: "2026-11-06 24:00:00" }, null],
      [{ settlement_time: "2026-11-06T10:15:30+14:01" }, null],
      [{ settlement_time: "2026-11-06T10:15:30+07:00" }, "2026-11-06T03:15:30.000Z"],
      [{}, null],
    ];
    for (const [input, expected] of cases) {
      const actual = midtransPaidAt(input);
      if (actual !== expected) fail("Midtrans paid-at parser mismatch: expected " + expected + ", received " + actual);
      else pass("Midtrans paid-at parser case passed");
    }
  } catch (error) {
    fail("Midtrans paid-at parser test could not run: " + error.message);
  }
}

const partnerCommissionMigration = fs.readFileSync(
  "supabase/migrations/20261106150331_reconcile_license_partner_commission_by_provider_paid_time.sql",
  "utf8",
);
const paymentIntegrityChecks = [
  [paymentWebhook.includes("refund_chargeback_id") && paymentWebhook.includes("bank_confirmed_at"), "refund fingerprints distinguish separate provider refund events"],
  [paymentWebhook.includes("delete safeStatusPayload.signature_key"), "provider signature hashes are not persisted in payment-event payloads"],
  [paymentWebhook.includes("paid_at: providerPaidAt") && paymentWebhook.includes("updated_at: new Date().toISOString()"), "paid_at uses provider time while updated_at records processing time"],
  [paymentWebhook.includes("paidOrder.paid_at !== providerPaidAt"), "already-paid orders reconcile delayed provider timestamps"],
  [paymentWebhook.includes('rpc("record_license_partner_commission"'), "verified license partner commissions are reconciled after payment verification"],
  [paymentWebhook.includes("BITESHIP_PRODUCTION_BOOKING_ENABLED") && paymentWebhook.includes("isLiveBiteshipKey"), "Biteship production booking still requires its separate production approval gate"],
  [partnerCommissionMigration.includes("EXCEPTION WHEN OTHERS") && partnerCommissionMigration.includes("$migration$"), "invalid historical Midtrans timestamps cannot abort the entire commission migration"],
  [partnerCommissionMigration.includes("FOR SHARE;"), "partner status is locked while commission eligibility is evaluated"],
  [partnerCommissionMigration.includes("v_order.payment_provider IS DISTINCT FROM 'midtrans'"), "license partner commission requires an explicitly Midtrans-paid order"],
];
for (const [ok, message] of paymentIntegrityChecks) {
  if (!ok) fail(message);
  else pass(message);
}

const quickSaleCashIdempotencyStart = html.indexOf("const quickSalePayload={businessId:financeBusiness.id,tableNumber:serverLocation,customerName,cashReceived,lines:");
const quickSaleCashIdempotencyEnd = html.indexOf("const quickSaleFingerprint=JSON.stringify(quickSalePayload)", quickSaleCashIdempotencyStart);
if (quickSaleCashIdempotencyStart < 0 || quickSaleCashIdempotencyEnd <= quickSaleCashIdempotencyStart) {
  fail("cashier idempotency fingerprint must include the received-cash amount so uncertain retries cannot be mistaken for a different payment");
} else pass("cashier idempotency fingerprint includes the received-cash amount");
\nif (process.exitCode) process.exit(process.exitCode);\n
if (process.exitCode) process.exit(process.exitCode);
