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
