# Rekonsiliasi riwayat migrasi Supabase

Tanggal audit: 5 November 2026  
Proyek: `flvdudmdltjjdjkdngbv`  
Repositori: `wandi0917/kasusaha-lite`

## Hasil pemeriksaan

- Supabase mencatat 99 versi migrasi yang telah diterapkan.
- Direktori `supabase/migrations` pada branch `main` berisi 27 file SQL.
- Semua 27 versi file yang ada sekarang cocok dengan versi migrasi yang tercatat di Supabase.
- Sebanyak 72 versi migrasi yang sudah tercatat di Supabase belum memiliki file SQL pasangannya di repositori.
- Nama file untuk beberapa migrasi yang tersedia telah diselaraskan dengan versi yang tercatat di Supabase. Ini hanya mengganti nama file, bukan menjalankan ulang SQL.

## Perbaikan entitlement yang diterapkan 6 November 2026

Dua migrasi tambahan telah diterapkan langsung melalui Supabase migration API setelah dry-run berurutan dalam transaksi `BEGIN/ROLLBACK`:

- Remote version `20261106113748`, name `20261106100000_fail_closed_store_product_cost_entitlement`; file repo `supabase/migrations/20261106113748_fail_closed_store_product_cost_entitlement.sql`.
- Remote version `20261106113750`, name `20261106113000_fail_closed_package_entitlement_helper_and_finance_rpcs`; file repo `supabase/migrations/20261106113750_fail_closed_package_entitlement_helper_and_finance_rpcs.sql`.

Perubahan ini tidak menghapus atau mengubah data bisnis. Perubahan memperketat fungsi harga modal, helper entitlement, posting jurnal, dan pelunasan piutang/utang agar entitlement yang tidak dapat dipastikan ditolak. Lisensi lama dengan `plan_code` kosong tetap mengikuti aturan kompatibilitas yang sudah ada. Verifikasi setelah penerapan menunjukkan kedua versi tercatat pada remote migration history dan definisi fungsi produksi sudah sesuai.

## Dampak

Aplikasi produksi tetap berjalan; kondisi ini tidak dengan sendirinya berarti skema database produksi rusak. Namun, repositori belum menjadi catatan migrasi lengkap. Menjalankan `supabase db push`, membuat project baru dari nol, atau merekonstruksi database hanya dari folder migrasi dapat gagal atau menghasilkan skema yang tidak setara.

## Aturan sementara

1. Jangan menjalankan `supabase db push` atau reset database dari folder migrasi saat ini.
2. Jangan membuat ulang 72 file yang hilang hanya berdasarkan nama migrasi. Nama tidak cukup untuk merekonstruksi SQL yang tepat.
3. Pulihkan SQL historis dari arsip/commit/backup yang tepercaya bila tersedia. Jika tidak, siapkan baseline schema terkontrol dari keadaan database saat ini, lalu dokumentasikan bahwa baseline tersebut bukan replay sejarah.
4. Sebelum menambah migrasi baru, pastikan versi file mengikuti versi remote berikutnya dan catat hasil penerapan melalui jalur migrasi yang sama.
5. Jangan mengubah atau menghapus baris riwayat migrasi Supabase secara manual untuk menyamarkan perbedaan.

## Perbaikan yang sudah dilakukan pada audit ini

- Menyamakan nama file migrasi yang tersedia dengan versi remote untuk 27 file yang ada.
- Menambahkan migrasi server timestamp dengan versi remote `20261105115528`.
- Menerapkan migrasi tersebut ke Supabase setelah pengujian aman dalam transaksi `BEGIN/ROLLBACK`.
- Memverifikasi kolom `server_recorded_at` tersedia, tidak ada nilai kosong, trigger aktif, dan belum ada usaha yang menyetujui atau memulai trial.

Status: perlu rekonstruksi/arsip untuk 72 migrasi historis yang belum tersedia di repositori.