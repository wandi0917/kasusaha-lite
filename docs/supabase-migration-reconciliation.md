# Rekonsiliasi riwayat migrasi Supabase

Tanggal audit: 6 November 2026  
Proyek: `flvdudmdltjjdjkdngbv`  
Repositori: `wandi0917/kasusaha-lite`

## Hasil pemeriksaan

- Supabase mencatat 112 versi migrasi yang telah diterapkan; versi terbaru adalah `20261106121913`.
- Direktori `supabase/migrations` pada branch `main` berisi 33 file SQL.
- Sebanyak 32 file lokal cocok dengan versi yang sudah tercatat di Supabase.
- Sebanyak 80 versi migrasi remote belum memiliki file SQL pasangannya di repositori.
- Satu file lokal, `20261106115500_license_package_checkout_referral_capture.sql`, masih merupakan migrasi pending dan belum diterapkan ke Production.
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
2. Jangan membuat ulang 81 file yang hilang hanya berdasarkan nama migrasi. Nama tidak cukup untuk merekonstruksi SQL yang tepat.
3. Pulihkan SQL historis dari arsip/commit/backup yang tepercaya bila tersedia. Jika tidak, siapkan baseline schema terkontrol dari keadaan database saat ini, lalu dokumentasikan bahwa baseline tersebut bukan replay sejarah.
4. Sebelum menambah migrasi baru, pastikan versi file mengikuti versi remote berikutnya dan catat hasil penerapan melalui jalur migrasi yang sama.
5. Jangan mengubah atau menghapus baris riwayat migrasi Supabase secara manual untuk menyamarkan perbedaan.

## Perbaikan yang sudah dilakukan pada audit ini

- Menyamakan nama file migrasi yang tersedia dengan versi remote; file quick-sale guard kini memakai versi remote `20261106121913`.
- Menambahkan migrasi server timestamp dengan versi remote `20261105115528`.
- Menerapkan migrasi tersebut ke Supabase setelah pengujian aman dalam transaksi `BEGIN/ROLLBACK`.
- Memverifikasi kolom `server_recorded_at` tersedia, tidak ada nilai kosong, trigger aktif, dan belum ada usaha yang menyetujui atau memulai trial.

Status: perlu rekonstruksi/arsip tepercaya untuk 80 migrasi historis yang belum tersedia di repositori.
## Pembaruan setelah dua migrasi entitlement

Tiga file migrasi baru kini menjadi bagian `main` dan cocok dengan remote versions `20261106113748`, `20261106113750`, dan `20261106115240` (dua migrasi entitlement dan satu penguatan RLS stok). Karena jumlah file lokal dan jumlah migrasi remote sama-sama bertambah tiga, selisih migrasi historis tanpa SQL counterpart tetap 81. Tidak ada data bisnis yang dihapus atau diubah.

## Versi migrasi pending setelah entitlement

- Migrasi referral capture belum diterapkan ke Production. File lokalnya telah diberi versi baru `20261106115500_license_package_checkout_referral_capture.sql`, karena versi sebelumnya `20261105170000` lebih tua daripada remote latest `20261106115240`.
- Migrasi ini tetap kandidat dan hanya boleh diterapkan setelah baseline historis/staging dan pengujian Midtrans Sandbox selesai. Re-version file tidak menjalankan SQL dan tidak mengubah database.

## Pembaruan RLS store_products 6 November 2026

Remote version `20261106115240` memperketat policy SELECT/INSERT/UPDATE/DELETE pada `store_products` agar selalu memerlukan lisensi terverifikasi dan entitlement `basic_stock`, sambil mempertahankan batas Owner/Karyawan dan perangkat berbayar. Semua empat paket aktif saat ini memiliki `basic_stock=true`. Migrasi diterapkan setelah dry-run transaksi rollback; tidak ada baris produk yang diubah.

## Pending referral migration version after latest RLS migration

The referral-capture SQL remains unapplied. Its repository file is now versioned `20261106115500_license_package_checkout_referral_capture.sql`, after remote latest `20261106115240`. The provider-paid-time reconciliation migration remains a draft candidate and must be ordered after referral capture. No SQL was executed by this file rename.

## Koreksi catatan versi remote

Versi remote `20261106113750` adalah migrasi helper entitlement/finance; versi remote `20261106115240` adalah migrasi policy RLS store_products. Keduanya berbeda dan harus tetap dicatat sesuai nama file masing-masing. Remote history kini 112; 32 file SQL lokal cocok dengan remote; 80 versi historis belum memiliki file lokal; satu migrasi referral tetap pending.


## Pembaruan audit 6 November 2026 — quick-sale guard dan refund/payment hardening

- Remote version `20261106121913` tercatat dengan nama `guard_quick_sale_cost_details_by_entitlement`.
- File SQL lokal yang sebelumnya bernama `20261106120000_guard_quick_sale_cost_details_by_entitlement.sql` telah diselaraskan menjadi `20261106121913_guard_quick_sale_cost_details_by_entitlement.sql`. Isi SQL tidak berubah dan tidak ada SQL yang dijalankan pada saat rename.
- Edge Function Midtrans diperkuat melalui source deployment terpisah; perubahan Edge Function tidak menambah versi migrasi database.
- Migrasi referral capture `20261106115500` tetap belum diterapkan.
- Jangan menjalankan `supabase db push`, `db reset --remote`, atau mengubah riwayat remote sampai 80 SQL historis dapat dipulihkan atau baseline skema yang terkontrol disiapkan dan diuji.


## Rekonsiliasi audit 7 November 2026

Pemeriksaan read-only terbaru menemukan 121 versi migrasi tercatat pada Supabase dan 41 file SQL pada `main`. Enam migrasi terbaru sudah diterapkan pada database, tetapi prefix versi pada nama file lokal berbeda dari versi yang tercatat pada remote. Nama migrasi pada riwayat remote cocok dengan nama SQL dan objek produksi yang diverifikasi.

Untuk mencegah migrasi yang sudah diterapkan dianggap pending, enam file hanya diselaraskan nama filenya ke versi remote berikut:

| Versi remote | Nama migrasi |
|---|---|
| `20261107104118` | `transaction_cash_validation_and_stock_movement_ledger_20261107` |
| `20261107141421` | `protect_public_product_shipping_and_write_paths` |
| `20261107142427` | `preserve_customer_and_table_labels_for_open_bill_settlement` |
| `20261107142954` | `bind_marketplace_products_to_verified_business_entitlement` |
| `20261107143320` | `hide_unentitled_marketplace_listings` |
| `20261107143852` | `fix_public_marketplace_entitlement_evaluation` |

Perubahan ini hanya rename file: isi SQL tidak diubah, tidak ada migrasi dijalankan ulang, dan tidak ada data atau skema database yang diubah. Verifikasi read-only mengonfirmasi tabel pergerakan stok, RPC kasir dengan validasi uang diterima, RPC profil pengiriman penjual, RPC penyelesaian tagihan, kolom workspace produk marketplace, RPC penetapan produk ke usaha, helper entitlement listing publik, dan policy listing publik tersedia.

Setelah penyelarasan, seluruh 41 file lokal memiliki versi yang cocok dengan riwayat remote. Sebanyak 80 migrasi historis remote tetap belum memiliki file SQL lokal. Karena itu, **jangan jalankan `supabase db push`, reset, atau rekonstruksi database hanya dari folder ini** sampai arsip SQL historis dipulihkan atau baseline skema terkontrol dibuat dan diuji. Jangan menghapus atau mengedit riwayat migrasi remote secara manual.

## Pembaruan audit 8 November 2026 — retry pembayaran setelah status Seller

- Remote migration history kini mencatat 141 versi; versi terbaru adalah `20261108100705`, `allow_processed_order_states_for_payment_retries`.
- File SQL yang cocok telah diselaraskan menjadi `supabase/migrations/20261108100705_allow_processed_order_states_for_payment_retries.sql`.
- Migrasi ini hanya menjalankan `CREATE OR REPLACE FUNCTION` pada `issue_kasusaha_license` dan `record_license_partner_commission`; tidak mengubah atau menghapus baris transaksi, saldo, komisi, referral, maupun lisensi.
- Kedua fungsi mempertahankan pemeriksaan `paid_at`, provider Midtrans, penanda pemeriksaan pembayaran, dan event pembayaran terverifikasi. Status `processing` dan `completed` hanya diterima sebagai kelanjutan dari pembayaran yang sudah diverifikasi.
- Versi remote dan nama file repo sudah diverifikasi cocok setelah penerapan.

**Peringatan tetap berlaku:** rekonstruksi seluruh migrasi historis yang hilang belum selesai. Jangan menjalankan `supabase db push`, reset, atau menerapkan migrasi DDL baru sebelum arsip historis dipulihkan atau baseline schema terkontrol dibuat dan diuji. Periksa ulang riwayat remote dan file lokal sebelum migrasi berikutnya.
