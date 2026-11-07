import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nav[aria-label="Navigasi utama"]')).toBeVisible();
});

test('menu publik membuka panel yang benar dan menandai menu aktif', async ({ page }) => {
  const nav = page.locator('nav[aria-label="Navigasi utama"]');
  const cases = [
    { name: /^Paket & Harga$/, panel: '#paketKasUsaha' },
    { name: /^Keranjang/, panel: '#keranjang' },
    { name: /^Login Karyawan$/, panel: '#loginKaryawan' },
    { name: /^Login Owner \/ Penjual$/, panel: '#akun' },
    { name: /^Akun Pembeli$/, panel: '#akunPembeli' },
    { name: /^Beranda$/, panel: '#beranda' },
  ];

  for (const item of cases) {
    const button = nav.getByRole('button', { name: item.name });
    await button.click();
    await expect(page.locator(item.panel)).toHaveClass(/active/);
    await expect(button).toHaveClass(/active/);
  }
});

test('menu Transaksi tanpa sesi terdaftar tetap mengunci fitur dan mengarahkan ke akun pembeli', async ({ page }) => {
  await page.locator('nav[aria-label="Navigasi utama"]').getByRole('button', { name: /^Transaksi$/ }).click();
  await expect(page.locator('#akunPembeli')).toHaveClass(/active/, { timeout: 20_000 });
  await expect(page.locator('#transaksi')).not.toHaveClass(/active/);
});

test('Kotak Saran menunggu Beranda sebelum menggulir ke formulir', async ({ page }) => {
  await page.locator('nav[aria-label="Navigasi utama"]').getByRole('button', { name: /Kotak Saran/ }).click();
  await expect(page.locator('#beranda')).toHaveClass(/active/);
  await expect(page.locator('#kasusahaSuggestionForm')).toBeVisible();
});

test('klik menu cepat berurutan berakhir pada menu terakhir yang dipilih', async ({ page }) => {
  const nav = page.locator('nav[aria-label="Navigasi utama"]');
  await nav.getByRole('button', { name: /^Paket & Harga$/ }).click();
  await nav.getByRole('button', { name: /^Keranjang/ }).click();
  await nav.getByRole('button', { name: /^Login Karyawan$/ }).click();
  await nav.getByRole('button', { name: /^Beranda$/ }).click();
  await expect(page.locator('#beranda')).toHaveClass(/active/);
  await expect(nav.getByRole('button', { name: /^Beranda$/ })).toHaveClass(/active/);
});
