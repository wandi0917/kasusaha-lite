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
    await expect(action).toBeVisible();
    await expect(action).toHaveText(item.label);
    await action.click();
    await expect.poll(() => page.evaluate(() => window.__guidedNavigationTarget)).toBe(item.target);
  }

  await page.evaluate(() => window.tampilkanPanduanLangkahKerja('Selesai tanpa tindakan lanjutan.'));
  await expect(page.locator('#financeLoginWorkAction')).toHaveCount(0);
});
