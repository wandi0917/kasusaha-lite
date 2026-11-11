# Audit kesiapan produksi KasUsaha Lite — 11 November 2026

## Ringkasan

- Repo: `wandi0917/kasusaha-lite`
- Main baseline: `68603533935d35051a1a26f895c634b276d1e460`
- Website: https://kasusaha-lite.pages.dev/
- Supabase project: `flvdudmdltjjdjkdngbv`
- Perubahan pada dokumen ini hanya dokumentasi audit. Tidak ada perubahan aplikasi, skema/data Production, secret, atau deployment.

## Bukti yang diperiksa

1. Cloudflare Pages: deployment Production terakhir yang terlihat sukses pada 10 November, dari main baseline.
2. Supabase: project ACTIVE_HEALTHY, PostgreSQL 17.11.
3. Migrasi: 146 remote, 59 SQL lokal, 58 exact match, 88 remote tanpa SQL counterpart, 1 lokal unmatched.
4. Dua belas Edge Functions kritis dibandingkan remote aktif dengan file main; seluruh source `index.ts` cocok persis.
5. Lima belas tabel public dengan RLS aktif tanpa policy tidak memberi privilege SELECT/INSERT/UPDATE/DELETE kepada role anon maupun authenticated.
6. Satu SECURITY DEFINER yang dapat dipanggil anon adalah helper listing marketplace publik yang memang dirancang untuk visitor anonim. Fungsi menggunakan search_path kosong, mengembalikan boolean, dan memeriksa entitlement listing. Jangan revoke akses tanpa pengganti.
7. Security Advisor masih melaporkan leaked-password protection nonaktif. Ini perlu diaktifkan melalui pengaturan Auth Supabase.
8. Log 24 jam yang diperiksa menunjukkan satu HTTP 403 pada `platform-marketplace-finance`; belum cukup bukti untuk menyebutnya gangguan Production. Query error function/database yang dijalankan tidak mengembalikan pesan error.
9. Midtrans Production, Biteship Production booking, E2E integrasi staging, perangkat fisik, dan backup restore Production belum terbukti.

## Keputusan

- Tidak melakukan `db push`, reset, edit migration history, revoke privilege massal, deployment, atau merge.
- Tidak ada kerusakan source yang dapat direproduksi dalam audit read-only ini untuk membenarkan patch aplikasi spekulatif.
- Pull Request seller payout #216 tetap Draft; belum ada uji SQL staging, integrasi UI, atau transfer uang nyata.
- Penilaian kesiapan peluncuran tetap 59/100 sampai blocker E2E ditutup.

## Gerbang sebelum penjualan umum

1. Pulihkan 88 migrasi historis dari sumber tepercaya atau siapkan baseline skema terkontrol dan uji restore.
2. Periksa konfigurasi Auth dan aktifkan leaked-password protection.
3. Bangun E2E Supabase staging dengan akun sintetis Owner, Employee, buyer, seller.
4. Uji seluruh status Midtrans Sandbox, signature, notifikasi ganda/out-of-order, refund dan rekonsiliasi ledger.
5. Uji quote, booking, webhook, status pengiriman Biteship di lingkungan non-Production.
6. Uji laporan, stok, transaksi terbuka, komisi 2,5% atas subtotal barang tanpa ongkir, dan idempotensi.
7. Uji printer/scanner fisik dan backup restore.
8. Baru lakukan canary Production dengan nilai terkendali dan persetujuan eksplisit.

## Batasan audit

Audit ini memverifikasi konfigurasi, source, metadata deployment, dan log yang dapat diakses. Audit ini bukan pengganti pengujian browser langsung dengan akun riil, transaksi pembayaran sungguhan, pengiriman sungguhan, atau pemulihan database Production.
