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
