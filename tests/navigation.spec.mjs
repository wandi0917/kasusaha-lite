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
    // The report action intentionally uses the dedicated report-navigation
    // helper rather than the generic transaction-module router.
    window.arahkanKeLaporanSetelahSimpan = async (category) => {
      window.__guidedNavigationTarget = 'laporan';
      window.__guidedNavigationCategory = category;
      return true;
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
    const transactionPanel = document.querySelector('#transaksi');
    transactionPanel?.classList.add('active');
    if (transactionPanel) {
      transactionPanel.hidden = false;
      transactionPanel.removeAttribute('hidden');
      transactionPanel.style.display = 'block';
    }
    financeBusiness = { id: '10000000-0000-4000-8000-000000000109', owner_id: '10000000-0000-4000-8000-000000000107' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000107';
    offlineTransactionMode = false;
    periksaLisensiWorkspace = async () => true;
    loadStoreProducts = async () => {};
    // Keep this UI-only navigation test isolated from the production Supabase project.
    window.loadQuickSaleOpenBills = async () => {};
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
    financeBusiness = { id: '10000000-0000-4000-8000-000000000109', owner_id: '10000000-0000-4000-8000-000000000107' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000107';
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
    financeBusiness = { id: '10000000-0000-4000-8000-000000000110', owner_id: '10000000-0000-4000-8000-000000000107' };
    financeMemberRole = 'employee';
    financeMemberUserId = '10000000-0000-4000-8000-000000000108';
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
    const ownerId = '10000000-0000-4000-8000-000000000111';
    const businessId = '10000000-0000-4000-8000-000000000112';
    document.body.classList.remove('employee-device-pending');
    // Model the authenticated Owner state used by the production CSS access gate.
    document.body.classList.add('owner-verified');
    const transactionPanel = document.querySelector('#transaksi');
    if (transactionPanel) {
      transactionPanel.classList.add('active');
      transactionPanel.hidden = false;
      transactionPanel.removeAttribute('hidden');
    }
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
            consent_recorded: true,
            trial_completed_for_period: false,
            warning: 'Pratinjau saja, bukan tagihan. Billing tetap nonaktif.',
          },
          error: null,
        };
      }
      return { data: null, error: new Error('RPC tidak diharapkan: ' + name) };
    };
    // Keep the real automatic-navigation function and real transaction-panel
    // router. Mock only server reads so this test proves the visible destination,
    // rather than merely proving that a mocked callback was invoked.
    periksaLisensiWorkspace = async () => true;
    // Set the global function property explicitly so the production router uses the
    // isolated server-read stub rather than making a real Supabase product query.
    window.loadStoreProducts = async () => { storeProductRows = []; };
    window.loadQuickSaleOpenBills = async () => {};
    await renderOwnerServiceFeePanel();
    document.querySelector('#serviceFeeOwnerPanel').hidden = false;
  });

  await expect(page.locator('#serviceFeePreviewRefresh')).toBeAttached();
  await page.evaluate(() => {
    // The page's initial logged-out redirect can hide this gated tab after setup.
    // Re-establish the already-open Owner tab immediately before the user action.
    document.body.classList.remove('employee-device-pending');
    const transactionPanel = document.querySelector('#transaksi');
    if (transactionPanel) {
      transactionPanel.classList.add('active');
      transactionPanel.hidden = false;
      transactionPanel.removeAttribute('hidden');
      transactionPanel.style.display = 'block';
    }
    document.querySelector('#serviceFeePreviewRefresh')?.click();
  });
  await expect(page.locator('#serviceFeePreviewResult')).toContainText('Menyiapkan menu berikutnya');
  await expect(page.locator('#serviceFeePreviewResult')).toContainText('Status uji coba periode ini: belum selesai');
  await expect(page.locator('#serviceFeePreviewResult')).toContainText('Pratinjau saja, bukan tagihan. Billing tetap nonaktif.');
  const routeDiagnostics = await page.evaluate(() => ({
    preview: document.querySelector('#serviceFeePreviewResult')?.textContent,
    financeStatus: document.querySelector('#financeStatus')?.textContent,
    transactionActive: document.querySelector('#transaksi')?.classList.contains('active'),
    bodyClass: document.body.className,
    businessId: financeBusiness?.id || null,
    role: financeMemberRole,
    userId: financeMemberUserId,
    entryHidden: document.querySelector('#financeEntryCard')?.hidden,
    ownerCatalogHidden: document.querySelector('#ownerStoreCatalog')?.hidden,
    quickSaleHidden: document.querySelector('#quickSaleForm')?.hidden,
    products: storeProductRows?.length,
    ownerCatalogDisplay: getComputedStyle(document.querySelector('#ownerStoreCatalog')).display,
    entryDisplay: getComputedStyle(document.querySelector('#financeEntryCard')).display,
    transactionDisplay: getComputedStyle(document.querySelector('#transaksi')).display,
    ownerCatalogInlineDisplay: document.querySelector('#ownerStoreCatalog')?.style.display,
    ancestorVisibility: (() => { const out = []; let n = document.querySelector('#ownerStoreCatalog'); while (n && out.length < 6) { const s = getComputedStyle(n); out.push({id:n.id,tag:n.tagName,hidden:n.hidden,display:s.display,visibility:s.visibility}); n=n.parentElement; } return out; })(),
  }));
  expect(routeDiagnostics.entryHidden, JSON.stringify(routeDiagnostics)).toBe(false);
  await expect(page.locator('#ownerStoreCatalog'), JSON.stringify(routeDiagnostics)).toBeVisible();
  await expect(page.locator('#quickSaleForm')).toBeHidden();
  await expect(page.locator('#financeEntryTitle')).toContainText('Barang & Stok');
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
    financeBusiness = { id: '10000000-0000-4000-8000-000000000101', owner_id: '10000000-0000-4000-8000-000000000107' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000107';
    offlineTransactionMode = false;
    document.body.classList.remove('employee-device-pending');
    periksaLisensiWorkspace = async () => true;
    loadStoreProducts = async () => { storeProductRows = []; };
    window.loadQuickSaleOpenBills = async () => {};
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
    financeBusiness = { id: '10000000-0000-4000-8000-000000000102', owner_id: '10000000-0000-4000-8000-000000000107' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000107';
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
      const printHost = ['sales', 'finance', 'income'].includes(item.category)
        ? document.querySelector('#financeReportCard')
        : panel;
      const printButton = item.category === 'accounting'
        ? document.querySelector('#financeAccountingCard button[onclick*="printFinanceAccounting"]')
        : printHost?.querySelector(':scope > .report-print-action');
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
    financeBusiness = { id: '10000000-0000-4000-8000-000000000103', owner_id: '10000000-0000-4000-8000-000000000107' };
    financeMemberRole = 'employee';
    financeMemberUserId = '10000000-0000-4000-8000-000000000108';
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
    financeBusiness = { id: '10000000-0000-4000-8000-000000000104', owner_id: '10000000-0000-4000-8000-000000000107' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000107';
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


test('pemilih kategori Laporan Stok memuat daftar barang sekaligus riwayat pergerakan stok', async ({ page }) => {
  const result = await page.evaluate(async () => {
    financeBusiness = { id: '10000000-0000-4000-8000-000000000105', owner_id: '10000000-0000-4000-8000-000000000106' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000106';
    financeSelectedBusinessId = null;
    offlineTransactionMode = false;
    document.body.classList.remove('employee-device-pending');
    sb.auth.getSession = async () => ({
      data: { session: { user: { id: '10000000-0000-4000-8000-000000000106' } } },
      error: null,
    });
    const memberQuery = {
      select() { return this; },
      eq() { return this; },
      then(resolve, reject) {
        return Promise.resolve({
          data: [{ business_id: '10000000-0000-4000-8000-000000000105', role: 'owner', active: true }],
          error: null,
        }).then(resolve, reject);
      },
    };
    sb.from = () => memberQuery;
    periksaLisensiWorkspace = async () => true;
    const calls = [];
    window.loadStoreProducts = async () => { calls.push('products'); };
    window.loadStoreStockMovements = async () => { calls.push('stock-movements'); };
    await buka('transaksi', document.querySelector('#navTransaksi'));
    const selector = document.querySelector('#reportCategorySelect');
    selector.value = 'stock';
    await selector.onchange();
    return {
      selected: selector.value,
      calls,
      reportVisible: !document.querySelector('#stockReportTableCard')?.hidden,
      movementRowsPresent: !!document.querySelector('#stockMovementRows'),
    };
  });

  expect(result).toEqual({
    selected: 'stock',
    calls: ['products', 'stock-movements'],
    reportVisible: true,
    movementRowsPresent: true,
  });
});


test('pemulihan daftar barang mengarahkan Owner dan Karyawan ke menu sesuai peran', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    const cases = [
      { role: 'owner', userId: '10000000-0000-4000-8000-000000000107', target: 'Buka formulir Tambah Barang' },
      { role: 'employee', userId: '10000000-0000-4000-8000-000000000108', target: 'Buka Daftar Barang' },
    ];
    const output = [];
    for (const item of cases) {
      financeBusiness = { id: '10000000-0000-4000-8000-000000000109', owner_id: '10000000-0000-4000-8000-000000000107' };
      financeMemberRole = item.role;
      financeMemberUserId = item.userId;
      offlineTransactionMode = false;
      loadStoreProducts = async () => { throw new Error('simulated catalog read failure'); };
      const opened = await arahkanKePekerjaanBerikutnya();
      output.push({ role: item.role, opened, action: document.querySelector('#financeLoginWorkAction')?.textContent || '' });
    }
    return output;
  });
  expect(result).toEqual([
    { role: 'owner', opened: false, action: 'Buka formulir Tambah Barang' },
    { role: 'employee', opened: false, action: 'Buka Daftar Barang' },
  ]);
});

test('Keuangan Marketplace tetap menyembunyikan rincian jika server menolak akses', async ({ page }) => {
  await page.route('**/functions/v1/platform-marketplace-finance', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authorized: false, error: 'Akses ditolak: khusus Platform Owner.' }),
  }));
  const result = await page.evaluate(async () => {
    await window.muatKeuanganMarketplace();
    return {
      contentHidden: document.querySelector('#platformFinanceContent').hidden,
      status: document.querySelector('#platformFinanceStatus').textContent,
      hasFinanceData: platformFinanceData !== null,
    };
  });
  expect(result.contentHidden).toBe(true);
  expect(result.status).toContain('Akses ditolak');
  expect(result.hasFinanceData).toBe(false);
});

test('judul seluruh kelompok laporan mengikuti nama usaha aktif dan berubah saat workspace diganti', async ({ page }) => {
  const result = await page.evaluate(() => {
    financeBusiness = { id: 'business-a', business_name: 'Kedai Kopi Seroja' };
    window.perbaruiJudulLaporanDenganNamaUsaha();
    const selectors = [
      '#localDailyReportCard h3',
      '#ownerHomeReports .card h3',
      '#employeeHomeReport h3',
      '#stockReportCard h3',
      '#stockReportTableCard h3',
      '#financeReportCard h3',
      '#financeTableSalesSummary h3',
      '#financeTransactionsTableCard h3',
      '#financeAccountingCard .ks-accounting-head h3',
    ];
    const first = selectors.map(selector => document.querySelector(selector)?.textContent || '');
    financeBusiness = { id: 'business-b', business_name: 'Warung Pagi Baru' };
    window.perbaruiJudulLaporanDenganNamaUsaha();
    const second = selectors.map(selector => document.querySelector(selector)?.textContent || '');
    return { first, second };
  });
  expect(result.first).toHaveLength(9);
  expect(result.first.every(title => title.includes('Kedai Kopi Seroja'))).toBe(true);
  expect(result.second.every(title => title.includes('Warung Pagi Baru'))).toBe(true);
  expect(result.second.every(title => !title.includes('Kedai Kopi Seroja'))).toBe(true);
});

test('pemulihan cadangan menolak struktur tidak valid tanpa mengubah data lokal', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('kasusaha_transaksi', JSON.stringify([{ id: 'existing-transaction' }]));
    localStorage.setItem('kasusaha_produk', JSON.stringify([{ id: 'existing-product' }]));
    localStorage.setItem('kasusaha_keranjang', JSON.stringify([{ id: 'existing-cart-item' }]));
    localStorage.setItem('kasusaha_pesanan', JSON.stringify([{ id: 'existing-order' }]));
  });
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#fileCadangan').setInputFiles({
    name: 'cadangan-tidak-valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ transaksi: 'bukan-array', produk: [] })),
  });
  await page.evaluate(() => window.impor());
  await expect.poll(() => page.evaluate(() => ({
    transaksi: localStorage.getItem('kasusaha_transaksi'),
    produk: localStorage.getItem('kasusaha_produk'),
    keranjang: localStorage.getItem('kasusaha_keranjang'),
    pesanan: localStorage.getItem('kasusaha_pesanan'),
  }))).toEqual({
    transaksi: JSON.stringify([{ id: 'existing-transaction' }]),
    produk: JSON.stringify([{ id: 'existing-product' }]),
    keranjang: JSON.stringify([{ id: 'existing-cart-item' }]),
    pesanan: JSON.stringify([{ id: 'existing-order' }]),
  });
});


test('alamat GitHub Pages lama dialihkan ke domain resmi tanpa membuang parameter dan hash login', async ({ page }) => {
  const result = await page.evaluate(() => {
    const redirectScript = [...document.scripts].find(script =>
      script.textContent.includes('wandi0917.github.io') &&
      script.textContent.includes('kasusaha-lite.pages.dev')
    );
    if (!redirectScript) return { found: false };

    const run = (hostname, pathname, search, hash) => {
      let destination = null;
      const fakeWindow = {
        location: { hostname, pathname, search, hash, replace(value) { destination = value; } },
      };
      new Function('window', 'URL', redirectScript.textContent)(fakeWindow, URL);
      return destination;
    };

    return {
      found: true,
      root: run('wandi0917.github.io', '/kasusaha-lite/', '', ''),
      nested: run('wandi0917.github.io', '/kasusaha-lite/panduan', '?from=legacy', '#access_token=sample&token_type=bearer'),
      canonical: run('kasusaha-lite.pages.dev', '/', '', ''),
    };
  });

  expect(result.found).toBe(true);
  expect(result.root).toBe('https://kasusaha-lite.pages.dev/');
  expect(result.nested).toBe('https://kasusaha-lite.pages.dev/panduan?from=legacy#access_token=sample&token_type=bearer');
  expect(result.canonical).toBe(null);
});



test('navigasi laporan setelah transaksi hanya berhasil jika laporan selesai dimuat', async ({ page }) => {
  await page.evaluate(() => {
    financeBusiness = { id: '10000000-0000-4000-8000-000000000109', business_name: 'Usaha Uji' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000107';
    window.bukaPanelTransaksi = async () => true;
    document.getElementById('transaksi')?.classList.add('active');
    const chooser = document.getElementById('reportCategoryChooser');
    if (chooser) { chooser.hidden = false; chooser.style.display = 'block'; }
    window.muatDanTampilkanLaporan = async () => false;
    window.__reportRecovery = null;
    window.tampilkanPanduanLangkahKerja = (message, isError, target) => {
      window.__reportRecovery = { message, isError, target };
    };
  });

  const result = await page.evaluate(() => arahkanKeLaporanSetelahSimpan('sales'));
  expect(result).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__reportRecovery)).toMatchObject({
    isError: true,
    target: 'laporan',
  });
  await expect.poll(() => page.evaluate(() => window.__reportRecovery.message)).toContain('Transaksi sudah tersimpan');
});

test('navigasi laporan setelah transaksi berhasil hanya setelah laporan terkonfirmasi dimuat', async ({ page }) => {
  await page.evaluate(() => {
    financeBusiness = { id: '10000000-0000-4000-8000-000000000109', business_name: 'Usaha Uji' };
    financeMemberRole = 'owner';
    financeMemberUserId = '10000000-0000-4000-8000-000000000107';
    window.bukaPanelTransaksi = async () => true;
    document.getElementById('transaksi')?.classList.add('active');
    const chooser = document.getElementById('reportCategoryChooser');
    if (chooser) { chooser.hidden = false; chooser.style.display = 'block'; }
    window.muatDanTampilkanLaporan = async () => true;
    window.__reportRecovery = null;
    window.tampilkanPanduanLangkahKerja = (message, isError, target) => {
      window.__reportRecovery = { message, isError, target };
    };
    window.applyReportCategory = () => {};
  });

  const result = await page.evaluate(() => arahkanKeLaporanSetelahSimpan('sales'));
  expect(result).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__reportRecovery)).toMatchObject({
    isError: false,
    target: 'laporan',
  });
  await expect.poll(() => page.evaluate(() => window.__reportRecovery.message)).toContain('laporan penjualan sudah dibuka');
});


test('semua ID DOM unik dan handler tombol inline merujuk fungsi yang tersedia', async ({ page }) => {
  const result = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id).filter(Boolean);
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const duplicateIds = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
      .sort();

    const source = [...document.scripts].map(script => script.textContent || '').join('\n');
    const declared = new Set();
    for (const match of source.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      declared.add(match[1]);
    }
    for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) {
      declared.add(match[1]);
    }
    for (const match of source.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) {
      declared.add(match[1]);
    }

    const ignored = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new',
      'this', 'window', 'document', 'event', 'console', 'Math', 'Date',
      'JSON', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Promise',
      'setTimeout', 'clearTimeout', 'setInterval', 'navigator', 'localStorage',
      'sessionStorage', 'URL', 'Blob', 'FileReader', 'alert', 'confirm',
      'prompt', 'parseInt', 'parseFloat'
    ]);
    const missingHandlers = new Set();
    const elements = [...document.querySelectorAll(
      '[onclick], [onchange], [oninput], [onsubmit], [onkeyup], [onkeydown]'
    )];
    for (const element of elements) {
      for (const attribute of ['onclick', 'onchange', 'oninput', 'onsubmit', 'onkeyup', 'onkeydown']) {
        const expression = element.getAttribute(attribute);
        if (!expression) continue;
        for (const match of expression.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
          const name = match[1];
          if (!ignored.has(name) && !declared.has(name) && typeof window[name] !== 'function') {
            missingHandlers.add(name);
          }
        }
      }
    }
    return {
      duplicateIds,
      missingHandlers: [...missingHandlers].sort(),
      interactiveHandlerCount: elements.length
    };
  });

  expect(result.duplicateIds).toEqual([]);
  expect(result.missingHandlers).toEqual([]);
  expect(result.interactiveHandlerCount).toBeGreaterThan(50);
});


test('daftar tagihan kasir tidak memanggil API saat sesi login belum tersedia', async ({ page }) => {
  const result = await page.evaluate(async () => {
    document.querySelector('#transaksi')?.classList.add('active');
    financeBusiness = { id: '10000000-0000-4000-8000-000000000113' };
    window.__openBillReadCalls = 0;
    const originalGetSession = sb.auth.getSession;
    const originalFrom = sb.from;
    sb.auth.getSession = async () => ({ data: { session: null }, error: null });
    sb.from = () => {
      window.__openBillReadCalls += 1;
      throw new Error('API tidak boleh dipanggil tanpa sesi login');
    };
    await loadQuickSaleOpenBills();
    sb.auth.getSession = originalGetSession;
    sb.from = originalFrom;
    return {
      apiCalls: window.__openBillReadCalls,
      status: document.querySelector('#quickSaleOpenBillsStatus')?.textContent || ''
    };
  });

  expect(result.apiCalls).toBe(0);
  expect(result.status).toContain('Silakan login kembali');
});


test('catatan offline hanya terlihat oleh akun dan usaha pembuatnya sesuai peran', async ({ page }) => {
  const result = await page.evaluate(() => {
    const businessId = '10000000-0000-4000-8000-000000000201';
    const otherBusinessId = '10000000-0000-4000-8000-000000000202';
    const ownerId = '10000000-0000-4000-8000-000000000203';
    const employeeA = '10000000-0000-4000-8000-000000000204';
    const employeeB = '10000000-0000-4000-8000-000000000205';

    transaksi = [
      { id: 'employee-a-income', jenis: 'masuk', offline_pending: true, offline_user_id: employeeA, offline_business_id: businessId, offline_role: 'employee' },
      { id: 'employee-b-income', jenis: 'masuk', offline_pending: true, offline_user_id: employeeB, offline_business_id: businessId, offline_role: 'employee' },
      { id: 'employee-a-other-business', jenis: 'masuk', offline_pending: true, offline_user_id: employeeA, offline_business_id: otherBusinessId, offline_role: 'employee' },
      { id: 'employee-a-expense', jenis: 'keluar', offline_pending: true, offline_user_id: employeeA, offline_business_id: businessId, offline_role: 'employee' },
      { id: 'owner-income', jenis: 'masuk', offline_pending: true, offline_user_id: ownerId, offline_business_id: businessId, offline_role: 'owner' },
      { id: 'legacy-unattributed', jenis: 'keluar' },
      { id: 'already-synced', jenis: 'masuk', offline_pending: false, offline_synced_at: '2026-11-08T00:00:00.000Z', offline_user_id: employeeA, offline_business_id: businessId, offline_role: 'employee' },
    ];

    financeBusiness = { id: businessId };
    financeMemberRole = 'employee';
    financeMemberUserId = employeeA;
    const employeeVisible = transaksiLokalTerlihat().map(row => row.id);

    financeMemberRole = 'owner';
    financeMemberUserId = ownerId;
    const ownerVisible = transaksiLokalTerlihat().map(row => row.id);

    return { employeeVisible, ownerVisible };
  });

  expect(result.employeeVisible).toEqual(['employee-a-income']);
  expect(result.ownerVisible).toEqual(['owner-income', 'legacy-unattributed']);
});


test('tagihan belum dibayar memakai tabel dan garis tabel berwarna hitam', async ({ page }) => {
  await expect(page.locator('#quickSaleOpenBillsTable')).toBeAttached();
  await expect(page.locator('#quickSaleOpenBillsTable thead th')).toHaveCount(6);
  await expect(page.locator('#quickSaleOpenBillsTable thead')).toContainText('Meja / Pelanggan');
  await expect(page.locator('#quickSaleOpenBillsTable thead')).toContainText('Total tagihan');
  const borderColor = await page.locator('#quickSaleOpenBillsTable th').first().evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(borderColor).toBe('rgb(0, 0, 0)');
  await expect(page.locator('#quickSalePrintLastReceipt')).toHaveText(/Cetak struk pembayaran terakhir/);
});
