import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nav[aria-label="Navigasi utama"]')).toBeVisible();
});

test('menu publik membuka panel yang benar dan menandai menu aktif', async ({ page }) => {
  const nav = page.locator('nav[aria-label="Navigasi utama"]');
  const cases = [
    { button: 'button[onclick*="paketKasUsaha"]', panel: '#paketKasUsaha' },
    { button: 'button[onclick*="buka(\'keranjang\'"]', panel: '#keranjang' },
    { button: 'button[onclick*="loginKaryawan"]', panel: '#loginKaryawan' },
    { button: 'button[onclick*="buka(\'akun\'"]', panel: '#akun' },
    { button: '#navAkunPembeli', panel: '#akunPembeli' },
    { button: 'button[onclick*="buka(\'beranda\'"]', panel: '#beranda' },
  ];

  for (const item of cases) {
    const button = nav.locator(item.button);
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator(item.panel)).toHaveClass(/active/);
    await expect(button).toHaveClass(/active/);
  }
});

test('seluruh menu publik utama membuka panel tujuan yang benar', async ({ page }) => {
  const nav = page.locator('nav[aria-label="Navigasi utama"]');
  const cases = [
    { button: '#navCompleteGuide', panel: '#panduanLengkap' },
    { button: '#navPasarOnline', panel: '#pasar' },
    { button: 'button[onclick*="paketKasUsaha"]', panel: '#paketKasUsaha' },
    { button: 'button[onclick*="buka(\'keranjang\'"]', panel: '#keranjang' },
    { button: 'button[onclick*="buka(\'akun\'"]', panel: '#akun' },
    { button: '#navAkunPembeli', panel: '#akunPembeli' },
    { button: '#navPesananSaya', panel: '#pesananSaya' },
    { button: 'button[onclick*="buka(\'pesananMasuk\'"]', panel: '#pesananMasuk' },
  ];
  for (const item of cases) {
    const button = nav.locator(item.button);
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator(item.panel)).toHaveClass(/active/);
    await expect(button).toHaveClass(/active/);
  }
});

test('menu Transaksi tanpa sesi terdaftar tetap mengunci fitur dan mengarahkan ke akun pembeli', async ({ page }) => {
  await page.locator('#navTransaksi').click();
  await expect(page.locator('#akunPembeli')).toHaveClass(/active/, { timeout: 20_000 });
  await expect(page.locator('#transaksi')).not.toHaveClass(/active/);
});

test('Kotak Saran menunggu Beranda sebelum menggulir ke formulir', async ({ page }) => {
  await page.locator('#navKasUsahaSaran').click();
  await expect(page.locator('#beranda')).toHaveClass(/active/);
  await expect(page.locator('#kasusahaSuggestionForm')).toBeVisible();
});

test('klik menu cepat berurutan berakhir pada menu terakhir yang dipilih', async ({ page }) => {
  const nav = page.locator('nav[aria-label="Navigasi utama"]');
  await nav.locator('button[onclick*="paketKasUsaha"]').click();
  await nav.locator('button[onclick*="buka(\'keranjang\'"]').click();
  await nav.locator('button[onclick*="loginKaryawan"]').click();
  await nav.locator('button[onclick*="buka(\'beranda\'"]').click();
  await expect(page.locator('#beranda')).toHaveClass(/active/);
  await expect(nav.locator('button[onclick*="buka(\'beranda\'"]')).toHaveClass(/active/);
});


test('petunjuk langkah kerja menyediakan tombol yang membuka modul tujuan secara langsung', async ({ page }) => {
  const cases = [
    { target: 'absensi', label: 'Buka formulir Absen Masuk' },
    { target: 'kasir', label: 'Buka Kasir Cepat' },
    { target: 'stok', label: 'Buka formulir Tambah Barang' },
    { target: 'katalog', label: 'Buka Daftar Barang' },
    { target: 'laporan', label: 'Buka Laporan' },
  ];

  await page.evaluate(() => {
    // The production helper is rendered inside the Transaksi tab. Expose that
    // tab in the isolated test without bypassing or changing production logic.
    document.querySelector('#transaksi')?.classList.add('active');
    for (let node = document.querySelector('#transactionGuide'); node; node = node.parentElement) {
      node.hidden = false;
      if (node.classList?.contains('tab')) node.style.display = 'block';
    }
    window.__guidedNavigationTarget = null;
    window.bukaPanelTransaksi = async (target) => {
      window.__guidedNavigationTarget = target;
    };
  });

  for (const item of cases) {
    await page.evaluate((target) => {
      window.tampilkanPanduanLangkahKerja('Ikuti langkah berikutnya.', false, target);
    }, item.target);

    const action = page.locator('#financeLoginWorkAction');
    await expect(action).toBeAttached();
    await expect(action).toHaveText(item.label);
    // The logged-out fixture keeps the gated Transaksi tab hidden; dispatch
    // the native button click to exercise the real registered event handler.
    await action.evaluate((button) => button.click());
    await expect.poll(() => page.evaluate(() => window.__guidedNavigationTarget)).toBe(item.target);
  }

  await page.evaluate(() => window.tampilkanPanduanLangkahKerja('Selesai tanpa tindakan lanjutan.'));
  await expect(page.locator('#financeLoginWorkAction')).toHaveCount(0);
});


test('pesan pemulihan Owner menyediakan tombol langsung ke menu Transaksi', async ({ page }) => {
  await page.evaluate(() => {
    window.__financeStatusTarget = null;
    window.buka = async (target) => {
      window.__financeStatusTarget = target;
    };
    window.setFinanceStatus('Usaha tersimpan. Buka Transaksi untuk melanjutkan.', true, 'transaksi');
  });

  const action = page.locator('#financeStatusAction');
  await expect(action).toBeAttached();
  await expect(action).toHaveText('Buka menu Transaksi');
  await action.evaluate((button) => button.click());
  await expect.poll(() => page.evaluate(() => window.__financeStatusTarget)).toBe('transaksi');
});


test('panduan karyawan sesuai login dengan ID unik, bukan kode undangan lama', async ({ page }) => {
  await expect(page.locator('#panduanLengkap')).toContainText('ID unik serta nama yang didaftarkan');
  await expect(page.locator('#panduanLengkap')).toContainText('Kode undangan bersama lama tidak digunakan');
  await expect(page.locator('#panduanLengkap')).not.toContainText('memasukkan kode undangan sesuai instruksi');
});

test('onboarding menampilkan uji coba gratis 31 hari untuk seluruh fitur aplikasi', async ({ page }) => {
  await expect(page.locator('#financeFirstBusinessGuide')).toContainText('uji coba gratis 31 hari');
  await expect(page.locator('#financeFirstBusinessGuide')).toContainText('seluruh fitur aplikasi, termasuk fitur lanjutan');
  await expect(page.locator('#kasusahaTrialStatus')).toBeAttached();

  const helpers = await page.evaluate(() => ({
    startTrial: typeof window.mulaiUjiCobaKasUsaha,
    renderTrialStatus: typeof window.renderKasUsahaTrialStatus,
    licenseCheck: typeof window.periksaLisensiWorkspace,
  }));
  expect(helpers).toEqual({
    startTrial: 'function',
    renderTrialStatus: 'function',
    licenseCheck: 'function',
  });
});


test('alur login menyiapkan pengalihan otomatis ke absensi dan langkah kerja berikutnya', async ({ page }) => {
  const source = await page.locator('script').allTextContents();
  const authScript = source.find((item) => item.includes("kasusahaLastAuthUserId")) || '';
  expect(authScript).toContain("await arahkanSetelahLoginFinance()");
  expect(authScript).toContain("event==='INITIAL_SESSION'||event==='SIGNED_IN'");
});


test('panduan memakai bahasa sederhana dan alur produk jual tidak terhenti oleh bahan baku', async ({ page }) => {
  const source = await page.locator('script').allTextContents();
  const app = source.join('\n');
  await expect(page.locator('#transactionGuide')).toContainText('Alur kerja utama: Absen Masuk → siapkan barang jual atau layanan → Kasir/Transaksi → Laporan.');
  await expect(page.locator('#financeFirstBusinessGuide')).toContainText('Isi nama usaha dan pilih jenis usaha');
  expect(app).toContain("p.item_type==='product'");
  expect(app).toContain("row.item_type==='product'");
  expect(app).toContain("Barang bahan baku boleh ditambahkan setelahnya");
});

test('pengaturan Owner menjelaskan ID unik lintas perangkat dan biaya aktivasi per karyawan', async ({ page }) => {
  const source = await page.locator('script').allTextContents();
  const app = source.join('\\n');
  expect(app).toContain('Karyawan masuk menggunakan nama dan ID unik yang sama dari HP atau komputer mana pun.');
  expect(app).not.toContain('Pengelolaan ID permanen lintas perangkat sedang disiapkan');
});


test('alur Owner nyata mengarahkan ke Stok atau Kasir sesuai ketersediaan produk', async ({ page }) => {
  await page.evaluate(async () => {
    // Hanya mock lapisan server; fungsi pengarah dan pembuka panel produksi tetap dijalankan.
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: 'e2e-owner-business', owner_id: 'e2e-owner' };
    financeMemberRole = 'owner';
    financeMemberUserId = 'e2e-owner';
    offlineTransactionMode = false;
    periksaLisensiWorkspace = async () => true;
    loadStoreProducts = async () => {};
    storeProductRows = [];
    window.__ownerRouteResults = {};
    window.__ownerRouteResults.noProducts = await arahkanKePekerjaanBerikutnya();
    window.__ownerRouteResults.stockVisible = !document.querySelector('#financeEntryCard')?.hidden;
    window.__ownerRouteResults.catalogVisible = !document.querySelector('#ownerStoreCatalog')?.hidden;
    storeProductRows = [{ id: 'e2e-product', active: true, item_type: 'product' }];
    window.__ownerRouteResults.withProducts = await arahkanKePekerjaanBerikutnya();
    window.__ownerRouteResults.cashierVisible = !document.querySelector('#quickSaleForm')?.hidden;
    window.__ownerRouteResults.stockCatalogHidden = !!document.querySelector('#ownerStoreCatalog')?.hidden;
  });
  const result = await page.evaluate(() => window.__ownerRouteResults);
  expect(result).toEqual({
    noProducts: true,
    stockVisible: true,
    catalogVisible: true,
    withProducts: true,
    cashierVisible: true,
    stockCatalogHidden: true,
  });
});

test('pratinjau kasir kosong merentang tujuh kolom dan struk 58 mm aman dari HTML pelanggan', async ({ page }) => {
  const emptyPreview = await page.evaluate(() => {
    updateQuickSalePreview(false);
    return document.querySelector('#quickSaleBillRows td')?.colSpan;
  });
  expect(emptyPreview).toBe(7);

  const receipt = await page.evaluate(() => {
    document.querySelector('#quickSaleReceiptWidth').value = '58';
    return buildQuickSaleReceiptHtml({
      paid: false,
      business_name: '<img src=x onerror=alert(1)>',
      location: 'Meja <script>alert(1)</script>',
      customer: 'Budi <b>uji</b>',
      cashier: 'Kasir',
      transaction_id: 'TRX-XSS',
      lines: [{ product_name: '<svg onload=alert(1)>', quantity: 1, unit_price: 5000, note: '<iframe src=javascript:alert(1)>' }],
      total: 5000
    });
  });
  expect(receipt).toContain('width:58mm');
  expect(receipt).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(receipt).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(receipt).toContain('&lt;svg onload=alert(1)&gt;');
  expect(receipt).toContain('&lt;iframe src=javascript:alert(1)&gt;');
  expect(receipt).not.toContain('<script>alert(1)</script>');
});

test('Kasir menyediakan cetak tagihan dan struk lunas dengan layout printer thermal', async ({ page }) => {
  await expect(page.locator('#quickSalePrintBill')).toHaveText(/Cetak tagihan/);
  await expect(page.locator('#quickSaleReceiptWidth')).toHaveValue('80');
  await expect(page.locator('#quickSaleLastReceipt')).toBeHidden();
  const receipt = await page.evaluate(() => {
    const html = buildQuickSaleReceiptHtml({
      paid: true, business_name: 'Kedai Uji', location: 'Meja 2',
      cashier: 'Kasir Uji', transaction_id: 'TRX-123',
      lines: [{ product_name: 'Kopi Susu', quantity: 2, unit_price: 10000, note: 'Kurang gula' }],
      total: 20000, cash_received: 50000, change: 30000
    });
    const unpaid = buildQuickSaleReceiptHtml({
      paid: false, business_name: 'Kedai Uji',
      lines: [{ product_name: 'Roti', quantity: 1, unit_price: 7000 }],
      total: 7000
    });
    return { html, unpaid };
  });
  expect(receipt.html).toContain('LUNAS / SUDAH DIBAYAR');
  expect(receipt.html).toContain('<h2>Kedai Uji</h2>');
  expect(receipt.html).not.toContain('KasUsaha Lite');
  expect(receipt.unpaid).toContain('<h2>Kedai Uji</h2>');
  expect(receipt.unpaid).not.toContain('KasUsaha Lite');
  expect(receipt.html).toContain('Rp30.000');
  expect(receipt.html).toContain('Kurang gula');
  expect(receipt.html).toContain('width:80mm');
  expect(receipt.unpaid).toContain('TAGIHAN — BELUM DIBAYAR');
  expect(receipt.unpaid).not.toContain('LUNAS / SUDAH DIBAYAR');
});
test('tombol Periksa Status Aktivasi menjalankan pemeriksaan ulang ke server', async ({ page }) => {
  await page.locator('nav button[onclick*="loginKaryawan"]').click();
  await page.locator('#loginKaryawan').evaluate(el => el.classList.add('active'));
  await page.evaluate(() => {
    document.querySelector('#employeeDevicePaywall').hidden = false;
    window.__employeeStatusChecks = 0;
    window.__employeeWorkspaceLoads = 0;
    window.__employeeActivationReady = false;
    window.ensureEmployeeDeviceActivation = async () => {
      window.__employeeStatusChecks += 1;
      document.querySelector('#employeeDeviceStatus').textContent = window.__employeeActivationReady ? 'Status server: aktivasi sudah aktif.' : 'Status server: masih menunggu aktivasi.';
      return window.__employeeActivationReady;
    };
    window.loadFinanceWorkspace = async () => { window.__employeeWorkspaceLoads += 1; };
  });
  await page.locator('#employeeDeviceCheckButton').click();
  await expect.poll(() => page.evaluate(() => window.__employeeStatusChecks)).toBe(1);
  await expect(page.locator('#employeeDeviceStatus')).toContainText('Status server');
  await expect(page.locator('#employeeDeviceCheckButton')).toBeEnabled();
  expect(await page.evaluate(() => window.__employeeWorkspaceLoads)).toBe(0);
  await page.evaluate(() => { window.__employeeActivationReady = true; });
  await page.locator('#employeeDeviceCheckButton').click();
  await expect.poll(() => page.evaluate(() => window.__employeeWorkspaceLoads)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__employeeStatusChecks)).toBe(2);
});


test('panduan login Owner mengikuti kondisi barang yang tersedia', async ({ page }) => {
  await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: 'e2e-owner-business', owner_id: 'e2e-owner' };
    financeMemberRole = 'owner';
    financeMemberUserId = 'e2e-owner';
    document.body.classList.remove('employee-device-pending');
    window.arahkanKePekerjaanBerikutnya = async () => true;

    storeProductRows = [];
    window.__ownerLoginGuideNoProducts = await arahkanSetelahLoginFinance();
    window.__ownerLoginGuideNoProductsText = document.querySelector('#financeLoginWorkNotice')?.textContent || '';
    window.__ownerLoginGuideNoProductsTarget = document.querySelector('#financeLoginWorkAction')?.textContent || '';

    storeProductRows = [{ id: 'e2e-product', active: true, item_type: 'product' }];
    window.__ownerLoginGuideWithProducts = await arahkanSetelahLoginFinance();
    window.__ownerLoginGuideWithProductsText = document.querySelector('#financeLoginWorkNotice')?.textContent || '';
    window.__ownerLoginGuideWithProductsTarget = document.querySelector('#financeLoginWorkAction')?.textContent || '';
  });

  const result = await page.evaluate(() => ({
    noProducts: window.__ownerLoginGuideNoProducts,
    noProductsText: window.__ownerLoginGuideNoProductsText,
    noProductsTarget: window.__ownerLoginGuideNoProductsTarget,
    withProducts: window.__ownerLoginGuideWithProducts,
    withProductsText: window.__ownerLoginGuideWithProductsText,
    withProductsTarget: window.__ownerLoginGuideWithProductsTarget,
  }));

  expect(result.noProducts).toBe(true);
  expect(result.noProductsText).toContain('Tambahkan barang yang dijual');
  expect(result.noProductsTarget).toBe('Buka formulir Tambah Barang');
  expect(result.withProducts).toBe(true);
  expect(result.withProductsText).toContain('Barang jual sudah tersedia');
  expect(result.withProductsText).toContain('Kasir Cepat');
  expect(result.withProductsTarget).toBe('Buka Kasir Cepat');
});

test('navigasi Karyawan ke katalog tetap dinyatakan berhasil setelah daftar barang terbuka', async ({ page }) => {
  await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: 'e2e-employee-business', owner_id: 'e2e-owner' };
    financeMemberRole = 'employee';
    financeMemberUserId = 'e2e-employee';
    offlineTransactionMode = false;
    periksaLisensiWorkspace = async () => true;
    loadStoreProducts = async () => {
      storeProductRows = [];
      const catalog = document.querySelector('#employeeProductCatalog');
      if (catalog) catalog.innerHTML = '<p>Daftar barang uji tersedia.</p>';
    };
    window.__employeeCatalogRouteResult = await bukaPanelTransaksi('katalog');
    window.__employeeCatalogVisible = !document.querySelector('#employeeProductCatalog')?.hidden;
  });

  const result = await page.evaluate(() => ({
    opened: window.__employeeCatalogRouteResult,
    visible: window.__employeeCatalogVisible,
  }));
  expect(result).toEqual({ opened: true, visible: true });
});


test('Muat pratinjau bulan ini memanggil pengarah otomatis setelah server mengembalikan pratinjau valid', async ({ page }) => {
  await page.evaluate(async () => {
    const ownerId = 'e2e-owner-preview';
    const businessId = 'e2e-preview-business';
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = {
      id: businessId,
      owner_id: ownerId,
      service_fee_trial_started_at: '2026-11-01T00:00:00.000Z',
    };
    financeMemberRole = 'owner';
    financeMemberUserId = ownerId;
    financeSelectedBusinessId = businessId;
    sb.auth.getSession = async () => ({
      data: { session: { user: { id: ownerId } } },
      error: null,
    });
    sb.from = (table) => {
      const query = {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({
          data: table === 'business_members'
            ? { business_id: businessId, user_id: ownerId, role: 'owner', active: true }
            : { id: businessId, owner_id: ownerId },
          error: null,
        }),
      };
      return query;
    };
    sb.rpc = async (name) => {
      if (name === 'kasusaha_owner_service_fee_preview') {
        return {
          data: {
            billing_enabled: false,
            preview_only: true,
            gross_recorded_sales: 1250000,
            recognized_returns: 0,
            net_sales_for_preview: 1250000,
            billable_amount: 0,
            estimated_fee: 0,
          },
          error: null,
        };
      }
      return { data: null, error: new Error('RPC tidak diharapkan: ' + name) };
    };
    window.__nextOwnerRouteCalls = 0;
    window.arahkanKePekerjaanBerikutnya = async () => {
      window.__nextOwnerRouteCalls += 1;
      document.querySelector('#financeEntryCard').hidden = false;
      document.querySelector('#ownerStoreCatalog').hidden = false;
      window.tampilkanPanduanLangkahKerja('Langkah berikutnya siap.', false, 'stok');
      return true;
    };
    await renderOwnerServiceFeePanel();
    document.querySelector('#serviceFeeOwnerPanel').hidden = false;
  });

  await expect(page.locator('#serviceFeePreviewRefresh')).toBeAttached();
  await page.locator('#serviceFeePreviewRefresh').evaluate(button => button.click());
  await expect(page.locator('#serviceFeePreviewResult')).toContainText('Menyiapkan menu berikutnya');
  await expect.poll(() => page.evaluate(() => window.__nextOwnerRouteCalls)).toBe(1);
});

test('menu Produk Saya dan Cadangan mengarahkan pengguna tanpa sesi ke Akun Pembeli', async ({ page }) => {
  const nav = page.locator('nav[aria-label="Navigasi utama"]');
  for (const label of ['Produk Saya', 'Cadangan']) {
    const button = nav.locator('button').filter({ hasText: label }).first();
    await expect(button).toBeVisible();
    await button.click();
    // Produk dan Cadangan adalah fitur berlisensi: tanpa sesi, redirect ke akun.
    await expect(page.locator('#akunPembeli')).toHaveClass(/active/);
    await expect(nav.locator('#navAkunPembeli')).toHaveClass(/active/);
    await expect(page.locator('#produk')).not.toHaveClass(/active/);
    await expect(page.locator('#cadangan')).not.toHaveClass(/active/);
  }
});


test('seluruh modul Transaksi Owner membuka panel yang tepat tanpa menumpuk panel lama', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: 'e2e-owner-transaction', owner_id: 'e2e-owner' };
    financeMemberRole = 'owner';
    financeMemberUserId = 'e2e-owner';
    offlineTransactionMode = false;
    document.body.classList.remove('employee-device-pending');
    periksaLisensiWorkspace = async () => true;
    loadStoreProducts = async () => { storeProductRows = []; };
    loadAttendance = async () => {};
    const cases = [
      { target: 'kasir', visible: '#quickSaleForm' },
      { target: 'absensi', visible: '#attendanceCard' },
      { target: 'catat', visible: '#financeForm' },
      { target: 'stok', visible: '#ownerStoreCatalog' },
      { target: 'laporan', visible: '#reportCategoryChooser' },
    ];
    const results = [];
    for (const item of cases) {
      const opened = await bukaPanelTransaksi(item.target);
      results.push({
        target: item.target,
        opened,
        visible: !document.querySelector(item.visible)?.hidden,
        otherPanelsHidden: ['quickSaleForm', 'attendanceCard', 'reportCategoryChooser', 'employeeProductCatalog']
          .filter(id => id !== item.visible.slice(1))
          .every(id => document.querySelector('#' + id)?.hidden),
      });
    }
    return results;
  });

  expect(result).toEqual([
    { target: 'kasir', opened: true, visible: true, otherPanelsHidden: true },
    { target: 'absensi', opened: true, visible: true, otherPanelsHidden: true },
    { target: 'catat', opened: true, visible: true, otherPanelsHidden: true },
    { target: 'stok', opened: true, visible: true, otherPanelsHidden: true },
    { target: 'laporan', opened: true, visible: true, otherPanelsHidden: true },
  ]);
});

test('semua kategori laporan Owner memuat tujuan dan tombol cetak yang sesuai', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: 'e2e-owner-reports', owner_id: 'e2e-owner' };
    financeMemberRole = 'owner';
    financeMemberUserId = 'e2e-owner';
    offlineTransactionMode = false;
    periksaLisensiWorkspace = async () => true;
    const calls = [];
    window.muatDanTampilkanLaporan = async () => { calls.push('finance'); };
    window.loadStoreProducts = async () => { calls.push('products'); };
    window.loadStoreStockMovements = async () => { calls.push('stock-movements'); };
    window.loadFinanceAccounting = async () => { calls.push('accounting'); };
    window.tampilLaporanHarianUsaha = () => { calls.push('daily'); };
    window.tampilTransaksi = () => { calls.push('history'); };
    const cases = [
      { category: 'sales', panel: '#financeTableSalesSummary', call: 'finance', print: true },
      { category: 'stock', panel: '#stockReportTableCard', call: 'stock-movements', print: true },
      { category: 'finance', panel: '#financeTransactionsTableCard', call: 'finance', print: true },
      { category: 'accounting', panel: '#financeAccountingCard', call: 'accounting', print: false },
      { category: 'daily', panel: '#localDailyReportCard', call: 'daily', print: true },
      { category: 'history', panel: '#localTransactionHistoryCard', call: 'history', print: true },
    ];
    const results = [];
    for (const item of cases) {
      await pilihLaporanTransaksi(item.category);
      const panel = document.querySelector(item.panel);
      const printButton = item.category === 'accounting'
        ? document.querySelector('#financeAccountingCard button[onclick*="printFinanceAccounting"]')
        : panel?.querySelector(':scope > .report-print-action');
      results.push({
        category: item.category,
        selected: document.querySelector('#reportCategorySelect')?.value,
        visible: !!panel && !panel.hidden,
        printAvailable: !!printButton,
        callObserved: calls.includes(item.call),
      });
    }
    return results;
  });

  expect(result).toEqual([
    { category: 'sales', selected: 'sales', visible: true, printAvailable: true, callObserved: true },
    { category: 'stock', selected: 'stock', visible: true, printAvailable: true, callObserved: true },
    { category: 'finance', selected: 'finance', visible: true, printAvailable: true, callObserved: true },
    { category: 'accounting', selected: 'accounting', visible: true, printAvailable: true, callObserved: true },
    { category: 'daily', selected: 'daily', visible: true, printAvailable: true, callObserved: true },
    { category: 'history', selected: 'history', visible: true, printAvailable: true, callObserved: true },
  ]);
});

test('Karyawan hanya dapat membuka laporan pemasukan dan tidak melihat menu Owner', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: 'e2e-employee-reports', owner_id: 'e2e-owner' };
    financeMemberRole = 'employee';
    financeMemberUserId = 'e2e-employee';
    offlineTransactionMode = false;
    periksaLisensiWorkspace = async () => true;
    window.muatDanTampilkanLaporan = async () => {};
    let ownerDataCalls = 0;
    window.loadStoreProducts = async () => { ownerDataCalls += 1; };
    window.loadStoreStockMovements = async () => { ownerDataCalls += 1; };
    window.loadFinanceAccounting = async () => { ownerDataCalls += 1; };
    updateFinanceActivePerson();
    await pilihLaporanTransaksi('sales');
    const result = {
      selected: document.querySelector('#reportCategorySelect')?.value,
      incomeVisible: !document.querySelector('#financeReportCard')?.hidden,
      ownerStockMenuHidden: document.querySelector('[data-transaction-role="owner"]')?.hidden,
      expenseActionHidden: [...document.querySelectorAll('#transactionShortcuts .transaction-submenu button')]
        .find(button => button.textContent.includes('Catat pengeluaran'))?.hidden,
      ownerDataCalls,
    };
    return result;
  });

  expect(result).toEqual({
    selected: 'income',
    incomeVisible: true,
    ownerStockMenuHidden: true,
    expenseActionHidden: true,
    ownerDataCalls: 0,
  });
});

test('navigasi Transaksi tanpa usaha terhubung berhenti dengan petunjuk pengaturan, bukan panel kosong', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = null;
    financeMemberRole = null;
    financeMemberUserId = null;
    offlineTransactionMode = false;
    window.loadFinanceWorkspace = async () => {};
    const opened = await bukaPanelTransaksi('kasir');
    return {
      opened,
      setupVisible: !document.querySelector('#financeSetupForms')?.hidden,
      cashierHidden: !!document.querySelector('#quickSaleForm')?.hidden,
      status: document.querySelector('#financeStatus')?.textContent || '',
    };
  });

  expect(result.opened).toBe(false);
  expect(result.setupVisible).toBe(true);
  expect(result.cashierHidden).toBe(true);
  expect(result.status).toContain('Selesaikan login dan hubungkan akun ke usaha terlebih dahulu');
});

test('mode offline tidak mengaku berhasil membuka kasir atau absensi server', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: 'e2e-offline-business', owner_id: 'e2e-owner' };
    financeMemberRole = 'owner';
    financeMemberUserId = 'e2e-owner';
    offlineTransactionMode = true;
    const cashier = await bukaPanelTransaksi('kasir');
    const cashierStatus = document.querySelector('#financeStatus')?.textContent || '';
    const attendance = await bukaPanelTransaksi('absensi');
    const attendanceStatus = document.querySelector('#financeStatus')?.textContent || '';
    return { cashier, cashierStatus, attendance, attendanceStatus };
  });

  expect(result.cashier).toBe(false);
  expect(result.cashierStatus).toContain('Kasir dengan daftar barang dan pembaruan stok memerlukan koneksi');
  expect(result.attendance).toBe(false);
  expect(result.attendanceStatus).toContain('Absensi online memerlukan koneksi internet');
});
