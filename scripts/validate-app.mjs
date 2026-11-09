import fs from "node:fs";
import vm from "node:vm";

const fail = (message) => {
  console.error("FAIL:", message);
  process.exitCode = 1;
};
const pass = (message) => console.log("PASS:", message);

const html = fs.readFileSync("index.html", "utf8");
const publicMarketplaceEntitlementFix = fs.readFileSync("supabase/migrations/20261107143852_fix_public_marketplace_entitlement_evaluation.sql", "utf8");
const publicMarketplaceVisibilityMigration = fs.readFileSync("supabase/migrations/20261107143320_hide_unentitled_marketplace_listings.sql", "utf8");
const marketplaceWorkspaceMigration = fs.readFileSync("supabase/migrations/20261107142954_bind_marketplace_products_to_verified_business_entitlement.sql", "utf8");

const stockLedgerMigration = fs.readFileSync("supabase/migrations/20261107104118_transaction_cash_validation_and_stock_movement_ledger_20261107.sql", "utf8");
const openBillAttributionMigration = fs.readFileSync("supabase/migrations/20261107142427_preserve_customer_and_table_labels_for_open_bill_settlement.sql", "utf8");
const cashierItemNotesSettlementMigration = fs.readFileSync("supabase/migrations/20261107144500_preserve_cashier_item_notes_after_payment.sql", "utf8");
const cashierItemNotesLengthMigration = fs.readFileSync("supabase/migrations/20261107170500_cap_paid_sale_note_description_length.sql", "utf8");
const idempotentOpenBillMigration = fs.readFileSync("supabase/migrations/20261107171500_idempotent_open_bill_creation.sql", "utf8");
const storeOpenBillWriteGrantsMigration = fs.readFileSync("supabase/migrations/20261108031820_grant_least_privilege_store_open_bill_writes.sql", "utf8");
const separateCashierNoteMigration = fs.readFileSync("supabase/migrations/20261107172000_store_cashier_customer_note_separately.sql", "utf8");
const financePartyIdempotencyMigration = fs.readFileSync("supabase/migrations/20261108000100_idempotent_finance_party_creation.sql", "utf8");
const offlineTimestampMigration = fs.readFileSync("supabase/migrations/20261108000200_preserve_offline_client_recorded_at.sql", "utf8");
const liteTrialMigration = fs.readFileSync("supabase/migrations/20261108000000_kasusaha_lite_31_day_trial_entitlements.sql", "utf8");
const fullAppTrialMigration = fs.readFileSync("supabase/migrations/20261108000300_kasusaha_31_day_full_app_trial_features.sql", "utf8");
const marketplaceTrialMigration = fs.readFileSync("supabase/migrations/20261108000400_kasusaha_marketplace_public_listing_trial_access.sql", "utf8");
const anonymousMarketplaceTrialFix = fs.readFileSync("supabase/migrations/20261108000500_public_marketplace_trial_visibility_for_anonymous.sql", "utf8");
const legacyPackageCheckoutWrapperMigration = fs.readFileSync("supabase/migrations/20261109143410_wrap_legacy_license_package_checkout_rpc.sql", "utf8");

const productShippingPrivacySql = fs.readFileSync("supabase/migrations/20261107141421_protect_public_product_shipping_and_write_paths.sql", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
const costSecurityMigration = fs.readFileSync("supabase/migrations/20261103020843_restrict_store_product_cost_column_access.sql", "utf8");
const employeeSessionMigration = fs.readFileSync("supabase/migrations/20261103062527_allow_paid_employee_invite_sessions_in_transactions.sql", "utf8");
const storeProductsEntitlementMigration = fs.readFileSync("supabase/migrations/20261106115240_guard_store_products_by_license_and_entitlement.sql", "utf8");
const backupRestoreChecks = html.slice(html.indexOf("function impor(){"), html.indexOf("function hapusSemua()", html.indexOf("function impor(){")));
const biteshipShipmentSource = fs.readFileSync("supabase/functions/biteship-create-shipment/index.ts", "utf8");
const marketplaceFinance = fs.readFileSync("supabase/functions/platform-marketplace-finance/index.ts", "utf8");
const failClosedStoreCostMigration = fs.readFileSync("supabase/migrations/20261106113748_fail_closed_store_product_cost_entitlement.sql", "utf8");
const failClosedFinanceMigration = fs.readFileSync("supabase/migrations/20261106113750_fail_closed_package_entitlement_helper_and_finance_rpcs.sql", "utf8");
const idempotentFinanceSettlementMigration = fs.readFileSync("supabase/migrations/20261107171000_idempotent_finance_open_item_settlement.sql", "utf8");
const manifestText = fs.readFileSync("manifest.webmanifest", "utf8");

const liteTrialChecks = [
  [html.includes("async function mulaiUjiCobaKasUsaha") && html.includes("kasusaha_start_free_trial"), "Owner onboarding must request the server-side one-time Lite trial"],
  [html.includes("kasusaha_get_business_trial_status") && html.includes("kasusahaTrialStatus"), "the application must display the authoritative server-side trial status"],
  [html.includes("kasusahaTrialAction") && html.includes("Buka Paket & Harga"), "expired or already-used trials must offer direct navigation to package purchase"],
  [html.includes("seluruh fitur aplikasi, termasuk fitur lanjutan") && html.includes("uji coba gratis 31 hari"), "first-time business setup must explain the complete 31-day application trial"],
  [liteTrialMigration.includes("interval '31 days'"), "the trial duration must be calculated by the database as 31 days"],
  [liteTrialMigration.includes("unique (owner_id)") && liteTrialMigration.includes("kasusaha_free_trials_owner_unique"), "each Owner may receive only one trial"],
  [liteTrialMigration.includes("on delete set null") && liteTrialMigration.includes("alter column business_id drop not null"), "deleting a workspace must not reset an Owner trial"],
  [liteTrialMigration.includes("private.kasusaha_business_license_is_verified") && liteTrialMigration.includes("trial.expires_at > now()"), "server entitlement checks must expire trial access automatically"],
  [fullAppTrialMigration.includes("'advanced_reports', true") && fullAppTrialMigration.includes("'priority_support', true"), "31-day trial must unlock all application feature flags including advanced reports"],
  [fullAppTrialMigration.includes("kasusaha_business_has_feature") && fullAppTrialMigration.includes("kasusaha_get_business_package_entitlements"), "server feature checks and returned entitlements must both grant the complete trial feature set"],
  [(fullAppTrialMigration.match(/if position\(v_new in v_def\) = 0 then/g)||[]).length === 2, "trial feature and entitlement migration must safely no-op when the target definition is already installed"],

  [marketplaceTrialMigration.includes("kasusaha_marketplace_product_is_public") && marketplaceTrialMigration.includes("kasusaha_business_license_is_verified(w.id)"), "public marketplace product visibility must recognize the active 31-day trial"],
  [liteTrialMigration.includes("revoke all on table private.kasusaha_free_trials from public, anon, authenticated"), "trial records must not be exposed to client roles"],
];
for (const [ok, message] of liteTrialChecks) {
  if (ok) pass(message);
  else fail(message);
}

const paidCashierItemNoteChecks = [
  [html.includes("lines:lines.map(d=>({product_id:d.p.id,quantity:d.qty,unit_price:d.price,note:d.note}))"), "direct paid cashier sales must send each item note to the server RPC"],
  [html.includes("d.note?' ; catatan pelanggan: '+d.note:''"), "cashier confirmation must display the note attached to each item before payment is saved"],
  [html.includes("quickSaleFingerprint=JSON.stringify(quickSalePayload)"), "cashier idempotency fingerprint must include the item notes sent to the server"],
];
for (const [ok, message] of paidCashierItemNoteChecks) {
  if (ok) pass(message);
  else fail(message);
}

const quickSaleNotesChecks = [
  [html.includes('class="quick-sale-item-note"') && html.includes('Catatan barang / permintaan pelanggan'), "each cashier item must expose an optional customer note field"],
  [html.includes("note:String(row.querySelector('.quick-sale-item-note')?.value||'').trim().slice(0,300)"), "cashier line notes must be trimmed and limited to 300 characters"],
  [html.includes("unit_price:d.price,note:d.note"), "unpaid bill JSON must persist each item's note"],
  [html.includes("noteField.value=String(line.note||'').slice(0,300)"), "reopening an unpaid bill must restore each item's note"],
  [(html.includes("line.note?' | Catatan: '+String(line.note):''") || html.includes("if(line.note){const note=document.createElement('div');note.textContent='Catatan: '+String(line.note)")), "unpaid bill list must display saved item notes as a separate safe text row"],
  [html.includes("const note=document.createElement('td');note.textContent=d.note||'—'"), "cashier bill preview must show item notes as text, not executable HTML"],
  [html.includes("quick-sale-item-note').addEventListener('input',()=>updateQuickSalePreview(false))"), "editing an item note must immediately refresh the bill preview"],
];

const cashierItemNotesSettlementChecks = [
  [cashierItemNotesSettlementMigration.split("CREATE OR REPLACE FUNCTION public.record_store_quick_sale").length - 1 === 2, "paid-bill note migration must preserve both cashier RPC overloads"],
  [cashierItemNotesSettlementMigration.split("| Catatan: ").length - 1 === 4, "paid cashier sales must append each optional line note to the matching financial transaction"],
  [cashierItemNotesSettlementMigration.includes("left(trim(v_line->>'note'), 300)"), "paid cashier note length must remain capped at 300 characters server-side"],
  [cashierItemNotesSettlementMigration.includes("SECURITY DEFINER") && cashierItemNotesSettlementMigration.includes("SET search_path TO ''"), "cashier note migration must preserve hardened RPC execution context"],
  [html.includes("note:String(row.querySelector('.quick-sale-item-note')?.value||'').trim().slice(0,300)"), "unpaid bill save must retain the per-item note before settlement"],
  [html.includes("noteField.value=String(line.note||'').slice(0,300)"), "opening an unpaid bill must restore the per-item note for edits and payment"],
];
for (const [ok, message] of cashierItemNotesSettlementChecks) {
  if (ok) pass(message);
  else fail(message);
}

const cashierItemNotesLengthChecks = [
  [cashierItemNotesLengthMigration.split("CREATE OR REPLACE FUNCTION public.record_store_quick_sale").length - 1 === 2, "description-length migration must preserve both cashier RPC overloads"],
  [cashierItemNotesLengthMigration.split("left(v_description, 300 - char_length(v_note))").length - 1 === 2, "paid sale descriptions must always fit the 300-character database constraint"],
  [cashierItemNotesLengthMigration.split("left(trim(v_line->>'note'), 288)").length - 1 === 2, "paid item notes must retain up to 288 characters after the label"],
  [(cashierItemNotesLengthMigration.match(/v_note text;/g)||[]).length===2, "each cashier RPC overload must build the bounded note independently"],
];
for (const [ok, message] of cashierItemNotesLengthChecks) {
  if (ok) pass(message);
  else fail(message);
}

for (const [ok, message] of quickSaleNotesChecks) {
  if (!ok) fail(message);
  else pass(message);
}



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
const actionableGuidanceChecks = [
  [html.includes("id='financeLoginWorkAction'") && html.includes("action.addEventListener('click',async()=>") , "guided workflow instructions must render a real action button, not text-only directions"],
  [html.includes("actions={absensi:'Buka formulir Absen Masuk',kasir:'Buka Kasir Cepat',stok:'Buka formulir Tambah Barang',katalog:'Buka Daftar Barang',laporan:'Buka Laporan'}"), "guided action buttons must name the exact destination form or module"],
  [html.includes("await bukaPanelTransaksi(nextTarget)"), "guided action buttons must navigate directly to the requested transaction module"],
  [html.includes("tampilkanPanduanLangkahKerja(message,destination==='katalog',destination)"), "post-attendance next-step guidance must open the exact next destination"],
  [html.includes("tampilkanPanduanLangkahKerja('LANGKAH 1 — Lakukan Absen Masuk terlebih dahulu.") && html.includes("'absensi');"), "first-login attendance guidance must provide a direct Absen Masuk action"],
];
for (const [ok, message] of actionableGuidanceChecks) {
  if (ok) pass(message);
  else fail(message);
}

const recoveryNavigationChecks = [
  [html.includes("function setFinanceStatus(message,isError=false,nextTarget='')"), "recovery status helper must accept an explicit navigation destination"],
  [html.includes("id='financeStatusAction'") && html.includes("window.buka?.(nextTarget"), "recovery status messages must render a real direct-navigation button"],
  [html.includes("true,'transaksi');"), "workspace setup recovery must provide a direct Transaksi action"],
  [html.includes("true,'kasir');"), "cashier recovery guidance must provide a direct Kasir Cepat action"],
  [html.includes("const recoveryTarget=financeMemberRole==='owner'?'stok':'katalog';") && html.includes("const recoveryMenu=financeMemberRole==='owner'?'Barang & Stok':'Daftar Barang';"), "catalog loading recovery guidance must route Owner to Barang & Stok and Employee to Daftar Barang"],
  [html.includes("Buka Paket & Harga") && html.includes("paketKasUsaha"), "missing-license recovery must navigate directly to Packages and Pricing"],
  [html.includes("Uji coba gratis 31 hari sudah digunakan atau lisensi diperlukan.") && html.includes("paketKasUsaha"), "expired or previously used trial must direct Owner to Packages and Pricing"],

  [html.includes("Formulir pengaturan usaha sudah terbuka") || html.includes("Isi nama usaha dan pilih jenis usaha"), "first workspace instructions must clearly point users to the already-open form"],
];
for (const [ok, message] of recoveryNavigationChecks) {
  if (ok) pass(message);
  else fail(message);
}

const ownerNavigationStateChecks = [
  [html.includes("if(!$('transaksi')?.classList.contains('active'))await buka('transaksi',transactionButton)"), "next-step routing must not reopen an already-active Transaksi tab and trigger a competing workspace reload"],
  [html.includes("financeBusiness={...(financeBusiness||{}),id:targetBusinessId,owner_id:liveUserId}") && html.includes("financeMemberRole='owner'") && html.includes("financeMemberUserId=liveUserId"), "verified service-fee preview context must restore Owner workspace state before automatic routing"],
];
for (const [ok, message] of ownerNavigationStateChecks) {
  if (ok) pass(message);
  else fail(message);
}

const serviceFeePreviewNavigationChecks = [
  [html.includes("const nextStepOpened=await arahkanKePekerjaanBerikutnya()"), "a successful monthly service-fee preview must automatically route the Owner to the next operational step"],
  [html.includes("Pratinjau berhasil dimuat. Pengalihan otomatis tertahan"), "a blocked post-preview route must explain the failure and provide a recovery action"],
];
for (const [ok, message] of serviceFeePreviewNavigationChecks) {
  if (ok) pass(message);
  else fail(message);
}

const navigationConcurrencyChecks = [
  [appNavigationScript.includes("let __kasUsahaNavigationQueue=Promise.resolve()"), "navigation requests must be serialized while session and license checks are pending"],
  [appNavigationScript.includes("const __kasUsahaNavigateCore=buka"), "navigation queue must preserve the original guarded navigation handler"],
  [appNavigationScript.includes("window.__kasUsahaNavigateInternal=(id,tombol,opsi={})=>__kasUsahaNavigateCore(id,tombol,opsi)"), "internal navigation must be able to bypass the external queue without bypassing access guards"],
  [appNavigationScript.includes("await window.__kasUsahaNavigateInternal('loginKaryawan',loginButton)") && !appNavigationScript.includes("await buka('loginKaryawan',loginButton)"), "employee device gate must not deadlock by queueing navigation inside an active navigation request"],
  [appNavigationScript.includes("__kasUsahaNavigationQueue=task.catch(error=>"), "a failed navigation must not permanently block later menu navigation"],
  [html.includes('id="kasusaha-navigation-usability"') && html.includes("scroll-margin-top:84px"), "selected panels must remain visible below the sticky navigation bar"],
  [html.includes("window.bukaKotakSaran = async (button) =>") && html.includes("await window.buka('beranda', berandaButton, {scroll:false})"), "suggestion form navigation must wait for Beranda before scrolling to the form"],
];
for (const [ok, message] of navigationConcurrencyChecks) {
  if (ok) pass(message);
  else fail(message);
}

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

const barcodeScanStart = html.indexOf("function addScannedBarcodeToQuickSale(raw,requestedQuantity=1){");
const barcodeScanEnd = html.indexOf("\nfunction handleQuickSaleCameraResult", barcodeScanStart);
const barcodeScan = html.slice(barcodeScanStart, barcodeScanEnd);
const cameraStart = html.indexOf("function handleQuickSaleCameraResult(raw){");
const cameraEnd = html.indexOf("\nasync function ensureKasUsahaZXing", cameraStart);
const cameraScan = html.slice(cameraStart, cameraEnd);
const barcodeRegressionChecks = [
  [barcodeScan.includes("qty.value=String(current+quantity)"), "a scanned product must add the quantity entered by the cashier"],
  [barcodeScan.includes("qtyField.value=String(quantity)"), "the first scanned product must use the entered quantity"],
  [barcodeScan.includes("current+quantity>available"), "quantity entry must not exceed available stock"],
  [cameraScan.includes("closeQuickSaleBarcodeCamera();showQuickSaleBarcodeQuantityForm(value)"), "camera must pause after each barcode and open the quantity form"],
  [html.includes("Scan Produk Berikutnya") && html.includes("Selesai"), "quantity form must offer repeat scanning and finish actions"],
  [html.includes("quickSaleScannedQuantity") && html.includes("Masukkan jumlah barang"), "camera barcode result must request a quantity before adding to cart"],
  [barcodeScan.includes("quickSaleBarcodeModal')?.hidden!==false"), "camera mode must not force keyboard focus over the camera"],
  
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
  [(() => {
    const lockStart = biteshipShipmentSource.indexOf('.update({ shipping_status: "creating"');
    const lockEnd = biteshipShipmentSource.indexOf("const [originLatitude", lockStart);
    const lockSource = lockStart >= 0 && lockEnd > lockStart
      ? biteshipShipmentSource.slice(lockStart, lockEnd)
      : "";
    return lockSource.includes('.is("shipping_status", null)');
  })(), "Biteship shipment lock must atomically compare-and-set from a null shipping status"],
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
    /professional:249000/.test(html) ||
    /<h3>Professional<\/h3>/.test(html)) {
  fail("public checkout must expose only Starter, Lite, and Business while Professional is hidden");
} else pass("public checkout exposes only Starter, Lite, and Business; Professional is hidden");

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

const midtransAttemptReservation = paymentCreate.indexOf("const attemptId = newAttemptId()");
const midtransMarketplaceGate = paymentCreate.indexOf(
  'if (production && hasPhysicalProduct && norm(Deno.env.get("MARKETPLACE_PRODUCTION_PAYMENTS_ENABLED")) !== "true")',
);
const midtransGlobalGate = paymentCreate.indexOf("if (!productionPaymentsEnabled(production))");
if (midtransAttemptReservation < 0 || midtransMarketplaceGate < 0 ||
    midtransGlobalGate < 0 || midtransMarketplaceGate > midtransAttemptReservation ||
    midtransGlobalGate > midtransAttemptReservation) {
  fail("Midtrans Production and marketplace gates must run before reserving a transaction ID");
} else pass("Midtrans Production and marketplace gates run before transaction reservation");

const paidOrderRetryGuard = 'if (!["paid", "processing", "completed"].includes(paidOrder.status))';
const paidOrderRetryUpdates = (paymentWebhook.match(/\.in\("status", \["paid", "processing", "completed"\]\)/g) || []).length;
if (!paymentWebhook.includes(paidOrderRetryGuard) ||
    paymentWebhook.includes('if (paidOrder.status !== "paid")') ||
    paidOrderRetryUpdates < 2) {
  fail("verified Midtrans webhook retries must remain idempotent after Seller processing/completion");
} else pass("verified Midtrans webhook retries accept paid, processing, and completed order states");

if (!marketplaceFinance.includes('"https://fix-navigation-serialization.kasusaha-lite.pages.dev"') ||
    !marketplaceFinance.includes('if (req.method === "OPTIONS")')) {
  fail("marketplace finance endpoint must allow the exact Playwright preview origin to complete CORS preflight");
} else pass("marketplace finance CORS allows only the configured Playwright preview origin");

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
  [/client_recorded_at,created_by,created_by_role/, html, "offline sync must read back and verify uploaded references"],
  [/client_recorded_at,created_by,created_by_role/, html, "offline sync must compare saved row content, not only the legacy reference"],
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

const packageCheckoutStart = html.indexOf("(function initKasUsahaPackageCheckout(){");
const packageCheckoutEnd = html.indexOf("async function mulaiPembayaranMidtrans", packageCheckoutStart);
const packageCheckoutBlock = packageCheckoutStart >= 0 && packageCheckoutEnd > packageCheckoutStart
  ? html.slice(packageCheckoutStart, packageCheckoutEnd)
  : "";
if (!packageCheckoutBlock.includes("if(createdPackageOrderId)") ||
    !packageCheckoutBlock.includes("submit.disabled=true") ||
    !packageCheckoutBlock.includes("gunakan tombol pembayaran untuk order yang sama")) {
  fail("package checkout must lock the order form after server order creation to prevent duplicate license orders");
} else pass("package checkout locks duplicate order creation and keeps retry on the same order");
if (packageCheckoutBlock.includes("legacyArgs")) {
  fail("package checkout must not fall back to the legacy 4-argument RPC without buyer-level locking");
} else pass("package checkout fails closed instead of calling the unsafe legacy package-order RPC");
const legacyPackageCheckoutWrapperSafe =
  /CREATE OR REPLACE FUNCTION public\.create_kasusaha_package_order\([\s\S]*?p_shipping_address text[\s\S]*?\)\s*RETURNS jsonb[\s\S]*?SECURITY INVOKER/i.test(legacyPackageCheckoutWrapperMigration) &&
  /SELECT public\.create_kasusaha_package_order\([\s\S]*?NULL::text\s*\)/i.test(legacyPackageCheckoutWrapperMigration) &&
  /REVOKE ALL ON FUNCTION public\.create_kasusaha_package_order\(text, text, text, text\)[\s\S]*?FROM PUBLIC, anon/i.test(legacyPackageCheckoutWrapperMigration);
if (!legacyPackageCheckoutWrapperSafe) {
  fail("legacy four-argument package checkout RPC must delegate to the serialized five-argument RPC and must not remain SECURITY DEFINER");
} else pass("legacy four-argument package checkout RPC delegates to the serialized five-argument RPC without SECURITY DEFINER");


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

const quickSaleCashIdempotencyStart = html.indexOf("const quickSalePayload={businessId:financeBusiness.id,userId:financeMemberUserId,tableNumber:serverLocation,customerName,cashReceived,lines:");
const quickSaleCashIdempotencyEnd = html.indexOf("const quickSaleFingerprint=JSON.stringify(quickSalePayload)", quickSaleCashIdempotencyStart);
if (quickSaleCashIdempotencyStart < 0 || quickSaleCashIdempotencyEnd <= quickSaleCashIdempotencyStart) {
  fail("cashier idempotency fingerprint must include the received-cash amount so uncertain retries cannot be mistaken for a different payment");
} else pass("cashier idempotency fingerprint includes the received-cash amount");


const quickSaleUserIdInFingerprint = html.includes("const quickSalePayload={businessId:financeBusiness.id,userId:financeMemberUserId,tableNumber:serverLocation,customerName,cashReceived,lines:");
if (!quickSaleUserIdInFingerprint) fail("cashier pending request fingerprint must be scoped to the authenticated user");
else pass("cashier pending request fingerprint is scoped to the authenticated user");

const stockAdjustmentUserIdInFingerprint = html.includes("const fingerprint=JSON.stringify({businessId:financeBusiness.id,userId:financeMemberUserId,productId:p.id,type,quantity:qty});");
if (!stockAdjustmentUserIdInFingerprint) fail("stock adjustment pending request fingerprint must be scoped to the authenticated Owner");
else pass("stock adjustment pending request fingerprint is scoped to the authenticated Owner");


const guidedOwnerEmployeeFlowChecks = [
  [html.includes("Menyiapkan langkah pertama akun Owner") && html.includes("LANGKAH 1 — Lengkapi nama dan jenis usaha"), "Owner login without a selected workspace is routed to the business setup or chooser"],
  [html.includes("async function arahkanKePekerjaanBerikutnya()") && html.includes("financeMemberRole==='owner'&&activeProducts.length===0") && html.includes("financeMemberRole==='employee'&&activeProducts.length===0"), "Next-step routing distinguishes Owner inventory setup from Employee read-only catalog"],
  [html.includes("LANGKAH 1 — Lakukan Absen Masuk terlebih dahulu") && html.includes("tampilkanPanduanLangkahKerja"), "Login workflow displays a live instruction for the required next action"],
  [html.includes("const routed=await arahkanKePekerjaanBerikutnya();") && html.includes("return routed;") && html.includes("Coba Lagi setelah koneksi dan lisensi usaha dapat diperiksa."), "Successful attendance remains recorded and failed next-step navigation offers an explicit retry action"],
  [html.includes("await arahkanSetelahLoginFinance();") && html.includes("Pilih usaha yang benar terlebih dahulu"), "Owner business creation and multi-workspace selection continue through the guided workflow"],
  [html.includes("setAttribute('aria-live','polite')") && html.includes("setAttribute('role','status')"), "Guided workflow instructions are announced accessibly to assistive technology"],
];
for (const [ok, message] of guidedOwnerEmployeeFlowChecks) {
  if (!ok) fail(message);
  else pass(message);
}

const loginAutoNavigationChecks = [
  [html.includes("else if(tujuanId==='transaksi'&&activeMembers.length===0)") && html.includes("Akun Owner baru harus dapat mencapai Pengaturan Usaha sebelum memiliki lisensi") && html.includes("document.body.classList.add('workspace-selection-pending')"), "a logged-in new Owner with no workspace can reach business setup before a trial license exists"],
  [html.includes("await arahkanSetelahLoginFinance();") && html.includes("event==='INITIAL_SESSION'||event==='SIGNED_IN'"), "successful Owner/Employee login must automatically continue to attendance or the next work step"],
  [html.includes("Navigasi otomatis setelah login belum selesai") && html.includes("Buka menu Transaksi"), "failed automatic navigation must show a direct recovery path"],
];
for (const [ok, message] of loginAutoNavigationChecks) { if (ok) pass(message); else fail(message); }

const automaticNextNavigationChecks = [
  [html.includes("const routed=await arahkanSetelahLoginFinance();") && html.includes("Memeriksa absensi dan menyiapkan menu berikutnya"), "selecting a verified saved workspace automatically continues to the attendance/work workflow"],
  [html.includes("const advanceToCashier=!editId&&$('storeProductSaleStatus')?.value==='product'") && html.includes("await bukaPanelTransaksi('kasir');"), "saving the first guided saleable product automatically opens Cashier even when ingredients already exist"],
  [html.includes("if(advanceToCashier&&itemType==='product')") && html.includes("Barang pertama berhasil disimpan"), "first-product auto-navigation is limited to a new sellable product in the guided setup flow"],
  [html.includes("Kasir belum terbuka otomatis") && html.includes("true,'kasir');"), "failed auto-navigation reports a safe direct-action fallback without misreporting product save failure"],
];
for (const [ok, message] of automaticNextNavigationChecks) {
  if (!ok) fail(message);
  else pass(message);
}

const completeNextNavigationChecks = [
  [html.includes("async function arahkanKeLaporanSetelahSimpan(category)") && html.includes("applyReportCategory(selectedCategory)") && html.includes("const reportLoaded=await muatDanTampilkanLaporan();") && html.includes("if(reportLoaded!==true)") && html.includes("Transaksi sudah tersimpan di server, tetapi laporan belum berhasil dimuat"), "successful saved workflows open and load the appropriate next report"],
  [html.includes("await arahkanKeLaporanSetelahSimpan(financeMemberRole==='employee'?'income':'sales');"), "cashier sales automatically continue to the role-appropriate sales/income report"],
  [html.includes("await arahkanKeLaporanSetelahSimpan(financeMemberRole==='employee'?'income':'finance');"), "manual finance entries automatically continue to the role-appropriate report"],
  [html.includes("try{await arahkanSetelahLoginFinance();}catch(routeError)") && html.includes("Perubahan stok sudah tersimpan dan diverifikasi"), "successful stock adjustment continues through attendance verification to the next work menu"],
];
for (const [ok, message] of completeNextNavigationChecks) {
  if (!ok) fail(message);
  else pass(message);
}

const businessTypeChecks = [
  [html.includes('value="pharmacy"') && html.includes('value="drugstore"') && html.includes('value="pharmaceutical_retail"'), "business type selector includes pharmacy, drugstore, and pharmaceutical retail"],
  [html.includes('value="optical"') && html.includes('value="medical_equipment"'), "business type selector includes optical and medical equipment shops"],
  [html.includes('id="businessTypeModulePreview"'), "business type setup shows a contextual module preview"],
  [html.includes("window.applyKasUsahaBusinessModule=apply"), "business module navigation adapter is available"],
  [html.includes("return LEGACY[raw]||'other'"), "legacy business labels normalize safely to module identifiers"],
  [html.includes("select('id,business_name,invite_code,owner_id,business_type,service_fee_consent_at"), "workspace loader reads the persisted business_type field"],
  [html.includes("applyKasUsahaBusinessModule(business.business_type)"), "workspace load applies the selected business type to transaction navigation"],
  [html.includes("Operasional obat resep, batch, kedaluwarsa, izin edar"), "pharmacy module clearly discloses unimplemented regulated workflows"],
  [html.includes("Jangan gunakan aplikasi ini sebagai rekam medis, sistem klinis"), "clinic type is not represented as a clinical records system"],
];
for (const [ok, message] of businessTypeChecks) {
  if (!ok) fail(message);
  else pass(message);
}


const productShippingPrivacyChecks = [
  [html.includes("sb.rpc('kasusaha_get_my_product_shipping_profiles')"), "seller shipping profile reads must use the owner-scoped RPC"],
  [html.includes("sb.rpc('kasusaha_update_my_product_shipping_profile'"), "seller shipping profile edits must use the owner-scoped RPC"],
  [html.includes("sb.rpc('kasusaha_update_my_product_shipping_profiles'"), "bulk shipping profile edits must use the owner-scoped RPC"],
  [!/\.from\(['"]produk['"]\)\.select\([^)]*(?:alamat_asal_pengiriman|kode_pos_asal_pengiriman|telepon_pengirim|nama_kontak_pengirim|latitude_asal_pengiriman|longitude_asal_pengiriman)/.test(html), "frontend must not directly SELECT private shipping-origin columns from public products"],
  [!/\.from\(['"]produk['"]\)\.update\(\{[^}]*?(?:alamat_asal_pengiriman|kode_pos_asal_pengiriman|telepon_pengirim|nama_kontak_pengirim|latitude_asal_pengiriman|longitude_asal_pengiriman)/.test(html), "frontend must not directly UPDATE private shipping-origin columns"],
  [productShippingPrivacySql.includes("REVOKE SELECT ON TABLE public.produk FROM anon, authenticated") && productShippingPrivacySql.includes("GRANT SELECT ("), "broad product SELECT must be replaced with safe column-only grants"],
  [productShippingPrivacySql.includes("berat_gram, panjang_cm, lebar_cm, tinggi_cm"), "public catalog retains non-sensitive shipping dimensions needed by logistics"],
  [productShippingPrivacySql.includes("GRANT SELECT (owner_id) ON TABLE public.produk TO authenticated"), "only signed-in sellers may filter by their own product owner ID"],
  [productShippingPrivacySql.includes("REVOKE UPDATE ON TABLE public.produk FROM authenticated") && productShippingPrivacySql.includes("GRANT UPDATE (harga, stok, aktif)"), "product updates must be restricted to the current safe catalog columns"],
  [productShippingPrivacySql.includes("CREATE POLICY \"Penjual dapat melihat produk miliknya\"") && productShippingPrivacySql.includes("NOT COALESCE"), "Owner must retain authenticated-only visibility of their own inactive products"],
  [productShippingPrivacySql.includes("REVOKE UPDATE ON TABLE public.store_products FROM authenticated") && !/GRANT UPDATE \([\s\S]*?cost_price[\s\S]*?\) ON TABLE public\.store_products/.test(productShippingPrivacySql), "direct cost-price UPDATE must be revoked so the full_finance RPC is the only write path"],
  [productShippingPrivacySql.includes("REVOKE INSERT ON TABLE public.store_products FROM authenticated") && !/GRANT INSERT \([\s\S]*?cost_price[\s\S]*?\) ON TABLE public\.store_products/.test(productShippingPrivacySql), "direct cost-price INSERT must be revoked so new costs are written through the full_finance RPC"],
  [html.includes("sb.rpc('adjust_store_product_stock'") && html.includes("sb.rpc('set_store_product_cost'"), "stock and cost changes must continue through their validated server RPCs"],
  [productShippingPrivacySql.includes("REVOKE UPDATE ON TABLE public.financial_transactions FROM authenticated") && !/(?:business_id|created_by|created_by_role|created_at|legacy_ref|server_recorded_at|id)/.test((productShippingPrivacySql.split("GRANT UPDATE (")[3] || "").split(") ON TABLE public.financial_transactions")[0]), "financial transaction attribution and idempotency metadata must remain immutable to clients"],
  [productShippingPrivacySql.includes("REVOKE INSERT ON TABLE public.financial_transactions FROM authenticated"), "financial transaction creation must use an explicit allowlist of insertable fields"],
  [html.includes("const payload={transaction_date:date,transaction_type:type,amount,description,category};"), "transaction editing must remain limited to the five user-editable business fields"],
  [productShippingPrivacySql.includes("p.owner_id = v_uid") && productShippingPrivacySql.includes("auth.uid()"), "shipping profile RPCs must scope every read/write to the authenticated product owner"],
  [productShippingPrivacySql.includes("REVOKE ALL ON FUNCTION") && productShippingPrivacySql.includes("GRANT EXECUTE ON FUNCTION"), "shipping profile SECURITY DEFINER RPCs must have explicit least-privilege EXECUTE grants"],
];
for (const [ok, message] of productShippingPrivacyChecks) {
  if (!ok) fail(message);
  else pass(message);
}


const stockCorrectionZeroChecks = [
  [/id="stockMovementQty" type="number" min="0" step="1" required/.test(html), "stock correction input must permit zero so a product can be corrected to out-of-stock"],
  [html.includes("qty<(type==='set'?0:1)"), "stock movement validation must allow zero only for absolute stock correction, not stock-in/out"],
  [html.includes("p_movement_type:type,p_quantity:qty,p_request_id:requestId"), "stock changes must continue through the atomic idempotent server RPC"],
];
for (const [ok, message] of stockCorrectionZeroChecks) {
  if (!ok) fail(message);
  else pass(message);
}


const confirmedOperationChecks = [
  [html.includes("let transactionConfirmed=false;") && html.includes("transactionConfirmed=true;") && html.includes("Jangan ulangi pencatatan."), "manual finance save/edit must retain confirmed-server state when report refresh fails"],
  [html.includes("let productConfirmed=false;") && html.includes("productConfirmed=true;") && html.includes("Jangan simpan ulang barang yang sama."), "product save must not be reported as failed or retried after server confirmation"],
  [html.includes("kasusaha_product_save_pending_v1") && html.includes("productFingerprint"), "product save must retain the same local fingerprint across uncertain retries"],
  [html.includes("const matches=!!existing&&existing.product_code===code") && html.includes("lookupError"), "product save must verify the authoritative product row before reporting an ambiguous request as failed"],
  [html.includes("productRequestPending.fingerprint!==productFingerprint") && html.includes("sebelum membuat atau mengubah barang lain"), "product save must block a different product while a previous save result is uncertain"],

  [html.includes("let stockConfirmed=false,stockNeedsManualReview=false;") && html.includes("String(result.product_id)!==String(p.id)") && html.includes("String(result.request_id)!==String(requestId)"), "stock adjustment must verify server product and idempotency request identity"],
  [html.includes("quantity_before") && html.includes("quantity_after") && html.includes("quantity_delta") && html.includes("after!==expectedAfter"), "stock adjustment must reconcile before/after/delta values before clearing the pending request"],
  [html.includes("finally{btn.disabled=stockNeedsManualReview;}"), "stock adjustment button must remain disabled when server result needs manual review"],
  [html.includes("let paymentConfirmed=false;") && html.includes("paymentConfirmed=true;") && html.includes("Jangan ulangi pembayaran."), "open-bill settlement must distinguish confirmed payment from failed UI refresh"],
  [html.includes("serverCash===cash") && html.includes("serverChange===expectedChange") && html.includes("serverTotal===total"), "open-bill settlement must reconcile server total, cash received, and change"],
  [html.includes("stockMovementType')?.dispatchEvent(new Event('change'))"), "stock quantity minimum must initialize from the default movement type"],
];
for (const [ok, message] of confirmedOperationChecks) {
  if (ok) pass(message);
  else fail(message);
}

const costEntitlementUiCheck = html.includes("const previousCost=Number(currentItem?.cost_price||0),needsCostUpdate=editId?previousCost!==costPrice:costPrice>0;") && html.includes("if(needsCostUpdate){");
if (costEntitlementUiCheck) pass("product save skips the full-finance cost RPC when a new or unchanged cost is zero");
else fail("product save must not call the full-finance cost RPC unnecessarily for zero/unchanged cost");


const cashierResultIntegrityChecks = [
  [html.includes("let quickSaleResponseNeedsReview=false;") && html.includes("quickSaleResponseNeedsReview=true;"), "cashier must block resubmission when a successful server response needs manual reconciliation"],
  [html.includes("String(result.request_id)!==String(quickSaleRequestId)"), "cashier must reconcile the server request ID before clearing its idempotency key"],
  [html.includes("serverTotal!==amount") && html.includes("serverCashReceived!==cashReceived") && html.includes("serverChange!==cashReceived-amount"), "cashier must verify server total, received cash, and change against the submitted sale"],
  [html.includes("Number(result.lines_count)!==lines.length"), "cashier must verify server-confirmed line count"],
  [html.includes("finally{btn.disabled=quickSaleResponseNeedsReview;}"), "cashier submit must remain blocked when a successful response needs manual review"],
  [html.includes("String(data.bill_id)===String(activeOpenBillId)") && html.includes("serverTotal===total"), "open-bill settlement must match the exact bill ID and server total"],
];
for (const [ok, message] of cashierResultIntegrityChecks) {
  if (ok) pass(message);
  else fail(message);
}


const stockMovementHistoryChecks = [
  [html.includes('id="stockMovementHistoryCard"') && html.includes('id="stockMovementHistoryRows"'), "Owner catalog includes a stock movement history panel"],
  [html.includes("async function loadStockMovementHistory()") && html.includes(".from('store_stock_movements').select("), "stock history is loaded from the server-side movement ledger"],
  [html.includes("financeMemberRole!=='owner'") && html.includes("stockMovementHistoryCard'))$('stockMovementHistoryCard').hidden=financeMemberRole!=='owner'"), "stock movement history is Owner-only in the UI"],
  [stockLedgerMigration.includes("store_stock_movements_owner_select") && stockLedgerMigration.includes("m.role = 'owner'"), "stock movement history database policy is restricted to Owner"],
  [stockLedgerMigration.includes("REVOKE INSERT ON TABLE public.store_stock_movements") || stockLedgerMigration.includes("REVOKE ALL ON TABLE public.store_stock_movements"), "clients cannot directly insert stock movement history"],
];
for (const [ok, message] of stockMovementHistoryChecks) {
  if (ok) pass(message);
  else fail(message);
}
const openBillAttributionChecks = [
  [openBillAttributionMigration.includes("CREATE OR REPLACE FUNCTION public.settle_store_open_bill"), "open-bill settlement attribution update replaces only the existing server RPC"],
  [openBillAttributionMigration.includes("pg_catalog.concat_ws") && openBillAttributionMigration.includes("'Meja '") && openBillAttributionMigration.includes("'Pelanggan: '"), "open-bill settlement preserves both customer name and table number"],
  [openBillAttributionMigration.includes("'Kasir'"), "open-bill settlement retains a safe default location label"],
];
for (const [ok, message] of openBillAttributionChecks) {
  if (ok) pass(message);
  else fail(message);
}


const marketplaceWorkspaceChecks = [
  [marketplaceWorkspaceMigration.includes("ADD COLUMN IF NOT EXISTS business_id uuid") && marketplaceWorkspaceMigration.includes("REFERENCES public.business_workspaces(id)"), "marketplace listings must reference one exact Owner workspace"],
  [marketplaceWorkspaceMigration.includes("HAVING count(*) = 1"), "legacy product backfill must only assign a workspace when the Owner has exactly one workspace"],
  [marketplaceWorkspaceMigration.includes("business_id IS NOT NULL") && marketplaceWorkspaceMigration.includes("w.id = business_id") && marketplaceWorkspaceMigration.includes("kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE"), "new marketplace listings must require entitlement from their exact workspace"],
  [marketplaceWorkspaceMigration.includes("aktif IS FALSE") && marketplaceWorkspaceMigration.includes("kasusaha_business_license_is_verified(w.id)"), "unentitled sellers may hide their own listings but may not keep/reactivate listings without a verified marketplace entitlement"],
  [marketplaceWorkspaceMigration.includes("kasusaha_assign_my_marketplace_product") && marketplaceWorkspaceMigration.includes("p.owner_id = v_uid") && marketplaceWorkspaceMigration.includes("w.id = p_business_id"), "legacy product assignment RPC must verify both product ownership and target workspace ownership"],
  [marketplaceWorkspaceMigration.includes("REVOKE ALL ON FUNCTION public.kasusaha_assign_my_marketplace_product") && marketplaceWorkspaceMigration.includes("GRANT EXECUTE ON FUNCTION public.kasusaha_assign_my_marketplace_product"), "legacy assignment RPC must have explicit authenticated-only execution"],
  [marketplaceWorkspaceMigration.includes("GRANT SELECT (business_id) ON TABLE public.produk TO authenticated"), "workspace association must be readable only to signed-in sellers, not anonymous catalog users"],
  [html.includes("async function pastikanHakMarketplace(user,requiredBusinessId=null)") && html.includes("financeSelectedBusinessId") && html.includes("workspaces.length>1"), "marketplace publishing must use the selected Owner workspace and reject ambiguous multi-workspace selection"],
  [html.includes("business_id:marketplace.business_id"), "both local-product and manual marketplace publishing must bind new listings to the entitled workspace"],
  [html.includes("select('id,business_id,nama_produk") && html.includes("kasusaha_assign_my_marketplace_product"), "seller management must load private workspace association and safely link legacy products before edits"],
  [html.includes("if(next){const entitlement=await pastikanHakMarketplace(session.user,p.business_id||null)"), "reactivating a hidden listing must re-check the exact workspace entitlement"],
];
for (const [ok, message] of marketplaceWorkspaceChecks) {
  if (ok) pass(message);
  else fail(message);
}


const publicMarketplaceVisibilityChecks = [
  [publicMarketplaceVisibilityMigration.includes("RETURNS boolean") && publicMarketplaceVisibilityMigration.includes("SECURITY DEFINER") && publicMarketplaceVisibilityMigration.includes("SET search_path = ''"), "public listing visibility helper must be read-only boolean SECURITY DEFINER with an empty search_path"],
  [publicMarketplaceVisibilityMigration.includes("w.id = p.business_id") && publicMarketplaceVisibilityMigration.includes("w.owner_id = p.owner_id"), "public listing visibility must bind to the exact workspace and product owner"],
  [publicMarketplaceVisibilityMigration.includes("kasusaha_business_license_is_verified(w.id)") && publicMarketplaceVisibilityMigration.includes("kasusaha_business_has_feature(w.id, 'marketplace') IS TRUE"), "public listing visibility must require a currently verified marketplace entitlement"],
  [publicMarketplaceVisibilityMigration.includes("GRANT EXECUTE ON FUNCTION public.kasusaha_marketplace_product_is_public(bigint)") && publicMarketplaceVisibilityMigration.includes("TO anon, authenticated"), "anonymous catalog access may call only the boolean listing-eligibility helper"],
  [publicMarketplaceVisibilityMigration.includes("USING (public.kasusaha_marketplace_product_is_public(id))"), "public product SELECT policy must use the server-side entitlement check"],
  [!publicMarketplaceVisibilityMigration.includes("UPDATE public.produk") && !publicMarketplaceVisibilityMigration.includes("DELETE FROM public.produk"), "visibility migration must not modify or delete existing product rows"],
  [!publicMarketplaceVisibilityMigration.includes('DROP POLICY IF EXISTS "Penjual dapat melihat produk miliknya"'), "Owner private SELECT policy must remain intact for legacy listing management"],
];
for (const [ok, message] of publicMarketplaceVisibilityChecks) {
  if (ok) pass(message);
  else fail(message);
}


const publicMarketplaceAnonymousEvaluationChecks = [
  [publicMarketplaceEntitlementFix.includes("SECURITY DEFINER") && publicMarketplaceEntitlementFix.includes("SET search_path = ''"), "anonymous marketplace visibility helper remains hardened with empty search_path"],
  [!publicMarketplaceEntitlementFix.includes("auth.uid()") && !publicMarketplaceEntitlementFix.includes("auth.jwt()"), "public listing eligibility must not depend on the current anonymous request identity"],
  [publicMarketplaceEntitlementFix.includes("m.user_id = w.owner_id") && publicMarketplaceEntitlementFix.includes("m.role = 'owner'") && publicMarketplaceEntitlementFix.includes("m.active IS TRUE"), "public listing eligibility must verify the actual active Owner membership"],
  [publicMarketplaceEntitlementFix.includes("e.verification_status = 'verified'") && publicMarketplaceEntitlementFix.includes("e.processed_at IS NOT NULL"), "public listing eligibility must require a processed verified payment event"],
  [publicMarketplaceEntitlementFix.includes("o.payment_review_required IS NOT TRUE") && publicMarketplaceEntitlementFix.includes("l.cloud_expires_at > now()"), "public listing eligibility must reject review-held or expired licenses"],
  [publicMarketplaceEntitlementFix.includes("lp.features ->> 'marketplace'") && publicMarketplaceEntitlementFix.includes("ORDER BY l.activated_at DESC NULLS LAST, l.created_at DESC"), "public listing eligibility must use the latest verified license plan feature"],
  [!publicMarketplaceEntitlementFix.includes("private.kasusaha_business_license_is_verified") && !publicMarketplaceEntitlementFix.includes("private.kasusaha_business_has_feature"), "public listing helper must not call auth.uid-dependent private entitlement helpers"],
  [anonymousMarketplaceTrialFix.includes("FROM private.kasusaha_free_trials") && anonymousMarketplaceTrialFix.includes("t.business_id = w.id") && anonymousMarketplaceTrialFix.includes("t.owner_id = w.owner_id"), "public anonymous marketplace visibility must recognize the active trial for the exact Owner workspace"],
  [anonymousMarketplaceTrialFix.includes("t.started_at <= now()") && anonymousMarketplaceTrialFix.includes("t.expires_at > now()") && anonymousMarketplaceTrialFix.includes("t.plan_code = 'lite'"), "public trial marketplace access must be limited to the valid 31-day Lite trial period"],
  [!anonymousMarketplaceTrialFix.includes("private.kasusaha_business_license_is_verified") && !anonymousMarketplaceTrialFix.includes("auth.uid()") && !anonymousMarketplaceTrialFix.includes("auth.jwt()"), "anonymous marketplace eligibility must not depend on an authenticated visitor identity"],

];
for (const [ok, message] of publicMarketplaceAnonymousEvaluationChecks) {
  if (ok) pass(message);
  else fail(message);
}


const pwaReleaseRefreshChecks = [
  [/meta name="kasusaha-build" content="2026-11-08-kasir-thermal-receipts-1"/.test(html), "production build marker must identify the cashier thermal receipt release"],
  [/const CACHE_NAME = CACHE_PREFIX \+ 'v70';/.test(sw), "PWA service worker cache version must advance to refresh installed app shells"],
];
for (const [ok, message] of pwaReleaseRefreshChecks) {
  if (ok) pass(message);
  else fail(message);
}

const openBillPaymentNavigationChecks = [
  [html.includes("if(paymentMatches&&!wasAlreadyPaid)") && html.includes("arahkanKeLaporanSetelahSimpan(financeMemberRole==='employee'?'income':'sales')"), "a newly verified open-bill payment must automatically open the role-appropriate report"],
  [html.includes("Pembayaran sudah tersimpan dan terverifikasi. Laporan belum terbuka otomatis") && html.includes("true,'laporan'"), "failed report navigation after payment must provide a safe retry action without repeating payment"],
  [html.includes("if(nextTarget==='laporan')") && html.includes("arahkanKeLaporanSetelahSimpan(category)"), "the report retry action must select the role-appropriate report, load it, and scroll to its results rather than only opening the panel"],
  [html.includes("if(paymentMatches&&!wasAlreadyPaid)") && html.includes("wasAlreadyPaid"), "a previously paid bill must not trigger a second report/payment flow"],
  [html.includes("PEMBAYARAN SUDAH DIKONFIRMASI SERVER") && html.includes("Jangan ulangi pembayaran"), "a payment snapshot mismatch must warn the user not to repeat a server-confirmed payment"],
];
openBillPaymentNavigationChecks.push(
  [html.includes("saveOfflineWorkspace(business,member,session.user);") && !html.includes("saveOfflineWorkspace(business,member,sd.session.user);"), "workspace loading must use the verified session object and never reference an out-of-scope sd variable"],
);

for (const [ok, message] of openBillPaymentNavigationChecks) {
  if (ok) pass(message);
  else fail(message);
}

const cashierReceiptPrintChecks = [
  [html.includes('id="quickSalePrintBill"') && html.includes('cetakTagihanKasir()'), "Quick Sale must expose a pre-payment bill print action"],
  [html.includes('id="quickSalePrintLastReceipt"') && html.includes('cetakStrukPembayaranTerakhir()'), "Quick Sale must expose a paid receipt print action"],
  [html.includes("LUNAS / SUDAH DIBAYAR") && html.includes("TAGIHAN — BELUM DIBAYAR"), "printed documents must distinguish paid receipts from unpaid bills"],
  [html.includes('value="58"') && html.includes('value="80"'), "thermal receipt must support 58 mm and 80 mm paper widths"],
  [html.includes("paymentMatches") && html.includes("setQuickSaleLastReceipt"), "paid receipt must only be stored after verified server payment values match"],
  [html.includes("quickSaleOpenBillsTable") && html.includes("quickSaleOpenBillsList") && html.includes("<th>No.</th>") && html.includes("<th>Aksi</th>"), "unpaid open bills must render as a structured table"],
  [html.includes(".employee-management-table th,.employee-management-table td{border:1px solid #000") && html.includes(".report-table th,.report-table td{border:1px solid #000"), "all employee and report table grid lines must be black"],
  [html.includes("receiptPanel.scrollIntoView") && html.includes("quickSaleLastReceipt"), "verified bill settlement must surface the paid receipt print panel"],
];
for (const [ok, message] of cashierReceiptPrintChecks) {
  if (ok) pass(message);
  else fail(message);
}

const employeeDeviceStatusButtonChecks = [
  [html.includes('id="employeeDeviceCheckButton"') && html.includes("employeeDeviceCheckButton.addEventListener('click'"), "Employee activation status button must perform a fresh server status check"],
  [html.includes("await ensureEmployeeDeviceActivation()") && html.includes("employeeDeviceCheckButton.disabled=true"), "Employee status recheck must prevent duplicate clicks while checking"],
  [html.includes("if(activated)") && html.includes("await loadFinanceWorkspace()"), "newly activated employee must reload verified workspace and resume the guided work flow"],
];
for (const [ok, message] of employeeDeviceStatusButtonChecks) {
  if (ok) pass(message);
  else fail(message);
}


const financeSettlementIdempotencyChecks = [
  [idempotentFinanceSettlementMigration.includes("p_request_id uuid") && idempotentFinanceSettlementMigration.includes("v_source_id := 'settle-' || v_item.id::text || '-' || p_request_id::text"), "finance settlement must derive a stable journal source ID from item and request IDs"],
  [idempotentFinanceSettlementMigration.includes("IF FOUND THEN") && idempotentFinanceSettlementMigration.includes("'replayed',true"), "repeated finance settlement requests must return the prior journal without increasing settled amount again"],
  [idempotentFinanceSettlementMigration.includes("v_existing_debit IS DISTINCT FROM p_amount") && idempotentFinanceSettlementMigration.includes("v_existing_credit IS DISTINCT FROM p_amount"), "replayed settlement must verify the original debit and credit amounts"],
  [idempotentFinanceSettlementMigration.includes("REVOKE ALL ON FUNCTION public.settle_finance_open_item(uuid,numeric,date) FROM PUBLIC, anon, authenticated"), "legacy non-idempotent public settlement RPC must be disabled for clients"],
  [idempotentFinanceSettlementMigration.includes("GRANT EXECUTE ON FUNCTION public.settle_finance_open_item(uuid,numeric,date,uuid) TO authenticated"), "only the request-ID settlement RPC must remain available to authenticated users"],
  [idempotentFinanceSettlementMigration.includes("SECURITY DEFINER") && idempotentFinanceSettlementMigration.includes("SET search_path TO ''"), "idempotent settlement function must retain hardened execution context"],
  [html.includes("kasusaha_finance_settlement_pending_v1") && html.includes("p_request_id:requestId"), "finance settlement UI must persist and send the same request ID after uncertain responses"],
  [html.includes("pending.fingerprint!==fingerprint") && html.includes("Jangan membuat pelunasan baru dahulu"), "finance settlement UI must block a different payment while an earlier result is uncertain"],
  [html.includes("result.data.replayed?'Pelunasan ini sudah tercatat sebelumnya"), "finance settlement UI must distinguish safe replay from a new payment"],
];
for (const [ok, message] of financeSettlementIdempotencyChecks) {
  if (ok) pass(message);
  else fail(message);
}


const openBillCreationIdempotencyChecks = [
  [idempotentOpenBillMigration.includes("ADD COLUMN IF NOT EXISTS client_request_id uuid"), "open bills must persist a client request ID for retry safety"],
  [idempotentOpenBillMigration.includes("store_open_bills_business_client_request_unique") && idempotentOpenBillMigration.includes("WHERE client_request_id IS NOT NULL"), "open bill request IDs must be unique per business while preserving legacy bills"],
  [idempotentOpenBillMigration.includes("GRANT INSERT (client_request_id)") && idempotentOpenBillMigration.includes("GRANT SELECT (client_request_id)"), "authenticated cashiers must be able to store and verify their own request ID under existing RLS"],
  [html.includes("kasusaha_open_bill_create_pending_v1") && html.includes("client_request_id:requestId"), "new unpaid bills must persist and reuse the same request ID across retries"],
  [html.includes("eq('client_request_id',requestId)") && html.includes("const sameLines=Array.isArray(existing.lines)"), "ambiguous open-bill creation must verify the matching server row and every line before recovery"],
  [html.includes("pending.fingerprint!==fingerprint") && html.includes("sebelum membuat tagihan lain"), "open-bill creation must block different details while a previous request is uncertain"],
  [html.includes("existing.status==='paid'?'Tagihan dengan ID permintaan ini sudah dibayar"), "recovered paid bills must never be recreated as new unpaid bills"],
];
for (const [ok, message] of openBillCreationIdempotencyChecks) {
  if (ok) pass(message);
  else fail(message);
}

const openBillColumnGrantChecks = [
  [storeOpenBillWriteGrantsMigration.includes("GRANT INSERT (") && ["business_id", "created_by", "created_by_role", "table_number", "customer_name", "lines", "total_amount", "client_request_id"].every(column => storeOpenBillWriteGrantsMigration.includes(column)), "open-bill creation must receive only the required insert columns"],
  [storeOpenBillWriteGrantsMigration.includes("GRANT UPDATE (") && ["table_number", "customer_name", "lines", "total_amount", "updated_at", "version", "status"].every(column => storeOpenBillWriteGrantsMigration.includes(column)), "open-bill editing and cancellation must receive only the required update columns"],
  [!(/GRANT\\s+INSERT\\s+ON\\s+TABLE\\s+public\\.store_open_bills/i.test(storeOpenBillWriteGrantsMigration)) && !(/GRANT\\s+UPDATE\\s+ON\\s+TABLE\\s+public\\.store_open_bills/i.test(storeOpenBillWriteGrantsMigration)), "open-bill privileges must not be broadened to table-wide writes"],
];
for (const [ok, message] of openBillColumnGrantChecks) {
  if (ok) pass(message);
  else fail(message);
}

const offlineTimestampIntegrityChecks = [
  [offlineTimestampMigration.includes("ADD COLUMN IF NOT EXISTS client_recorded_at timestamptz"), "offline sync must have a separate nullable device timestamp column"],
  [offlineTimestampMigration.includes("GRANT INSERT (client_recorded_at)") && offlineTimestampMigration.includes("GRANT SELECT (client_recorded_at)") && offlineTimestampMigration.includes("REVOKE UPDATE (client_recorded_at)"), "device timestamp must be insertable/readable but immutable after creation"],
  [!offlineTimestampMigration.includes("GRANT INSERT (created_at)") && !offlineTimestampMigration.includes("GRANT UPDATE (server_recorded_at)"), "offline sync must not gain write access to authoritative server timestamps"],
  [html.includes("row.client_recorded_at=d.toISOString()") && !html.includes("row.created_at=d.toISOString()"), "offline importer must preserve device time without attempting forbidden created_at writes"],
  [html.includes("client_recorded_at,category,created_at") && html.includes("new Date(r.client_recorded_at||r.created_at)"), "finance reports must display device time for offline imports and server time for normal transactions"],
  [html.includes("client_recorded_at,created_by,created_by_role") && html.includes("new Date(saved.client_recorded_at||'').getTime()"), "offline sync must verify the persisted device timestamp before marking local records synced"],
  [offlineTimestampMigration.includes("server_recorded_at remains authoritative"), "offline device time must be explicitly excluded from billing authority"],
];
for (const [ok, message] of offlineTimestampIntegrityChecks) {
  if (ok) pass(message);
  else fail(message);
}

const financePartyIdempotencyChecks = [
  [html.includes("kasusaha_finance_party_pending_v1") && html.includes("client_request_id:requestId"), "finance party creation must persist and send a stable request ID"],
  [html.includes("pending.fingerprint!==fingerprint") && html.includes("sebelum membuat data pihak lain"), "finance party creation must block different details while a previous result is uncertain"],
  [html.includes(".eq('client_request_id',requestId)") && html.includes("row.created_by===financeMemberUserId"), "finance party retry must verify the exact server row and creator before reporting success"],
  [financePartyIdempotencyMigration.includes("ADD COLUMN IF NOT EXISTS client_request_id uuid") && financePartyIdempotencyMigration.includes("CREATE UNIQUE INDEX IF NOT EXISTS finance_parties_business_request_id_key"), "finance party request IDs must be uniquely constrained per business without changing legacy rows"],
];
for (const [ok, message] of financePartyIdempotencyChecks) {
  if (ok) pass(message);
  else fail(message);
}

const separateCashierNoteChecks = [
  [separateCashierNoteMigration.includes("ADD COLUMN IF NOT EXISTS customer_note text"), "paid cashier item notes must use a separate transaction column"],
  [separateCashierNoteMigration.includes("char_length(customer_note) <= 300"), "customer notes must retain the 300-character limit without extending the description constraint"],
  [separateCashierNoteMigration.includes("GRANT SELECT (customer_note)") && !separateCashierNoteMigration.includes("GRANT INSERT (customer_note)"), "customers notes must be readable by authenticated members but not directly writable by clients"],
  [(separateCashierNoteMigration.match(/customer_note\)/g)||[]).length>=2 && (separateCashierNoteMigration.match(/nullif\(left\(trim\(coalesce\(v_line->>'note'/g)||[]).length===2, "both cashier RPC overloads must store the per-item note separately on the matching sale row"],
  [html.includes("amount,description,customer_note,client_recorded_at,category,created_at"), "shared transaction report query must load paid item notes and offline device timestamps"],
  [html.includes("r.customer_note?' | Catatan: '+String(r.customer_note):''"), "sales report must display the saved note alongside its exact product line"],
];
for (const [ok, message] of separateCashierNoteChecks) {
  if (ok) pass(message);
  else fail(message);
}


const paidOrderRetryMigration = fs.readFileSync(
  "supabase/migrations/20261108100705_allow_processed_order_states_for_payment_retries.sql",
  "utf8",
);
const paidOrderRetryChecks = [
  [paidOrderRetryMigration.includes("v_order.status NOT IN ('paid', 'processing', 'completed')"), "license issuance must accept verified paid orders after Seller processing without changing order state"],
  [(paidOrderRetryMigration.match(/o\.status IN \('paid', 'processing', 'completed'\)/g) || []).length === 2, "license partner attribution and reconciliation must include processed paid orders"],
  [!paidOrderRetryMigration.includes("v_order.status <> 'paid'") && !paidOrderRetryMigration.includes("o.status = 'paid'"), "license retry migration must not retain paid-only status filters"],
  [paidOrderRetryMigration.includes("SECURITY DEFINER") && paidOrderRetryMigration.includes("SET search_path TO ''"), "license issuance must retain its definer boundary and fixed search_path"],
];
for (const [ok, message] of paidOrderRetryChecks) {
  if (ok) pass(message);
  else fail(message);
}

const openBillEditingChecks = [
  [html.includes("const saleForm=$('quickSaleForm')") && html.includes("saleForm.hidden=false") && html.includes("saleForm.style.display='block'"), "opening an unpaid bill must explicitly reveal the cashier editor"],
  [html.includes("[input,quantityField,noteField,row.querySelector('.quick-sale-remove')].forEach(el=>{if(el)el.disabled=false;})"), "unpaid bill product, quantity, notes and remove controls must be enabled for correction"],
  [html.includes("const addItemButton=$('quickSaleAddItem');if(addItemButton)addItemButton.disabled=false;"), "cashiers must be able to add missing products to an unpaid bill"],
  [html.includes("if(quantityField){quantityField.disabled=false;quantityField.readOnly=false;quantityField.value=String(line.quantity);}") && html.includes("if(noteField){noteField.disabled=false;noteField.readOnly=false;"), "unpaid bill quantities and customer notes must be editable"],
  [html.includes("if(priceField){priceField.disabled=false;priceField.readOnly=true;priceField.setAttribute('readonly','');}") && html.includes("updateQuickSalePreview(true);"), "unpaid bill prices must remain synchronized with the server-verified product catalog"],
  [html.includes("Produk tidak aktif") && html.includes("Keep legacy/inactive product lines visible") && !html.includes("if(!product)throw new Error('Produk pada tagihan tidak ditemukan pada daftar barang aktif."), "unpaid bills with inactive legacy products must still open so the cashier can replace the affected item"],
  [html.includes("$('quickSaleCashReceived').value='';") && html.includes('Never carry cash received from a previous bill into a different unpaid bill.'), "opening an unpaid bill must clear stale cash received from another bill"],
];
for (const [ok, message] of openBillEditingChecks) {
  if (ok) pass(message);
  else fail(message);
}

if (process.exitCode) process.exit(process.exitCode);
