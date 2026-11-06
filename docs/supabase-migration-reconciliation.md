# Rekonsiliasi riwayat migrasi Supabase

Tanggal audit: 6 November 2026  
Proyek: `flvdudmdltjjdjkdngbv`  
Repositori: `wandi0917/kasusaha-lite`

## Hasil pemeriksaan

- Supabase mencatat 111 versi migrasi yang telah diterapkan (pemeriksaan ulang 6 November 2026; versi terbaru `20261106115240`).
- Direktori `supabase/migrations` pada branch `main` berisi 27 file SQL.
- Semua 27 versi file yang ada sekarang cocok dengan versi migrasi yang tercatat di Supabase.
- Sebanyak 81 versi migrasi historis yang sudah tercatat di Supabase belum memiliki file SQL pasangannya di branch `main`; dua migrasi entitlement terbaru sudah direkam dengan file bernama versi remote yang tepat.
- Nama file untuk beberapa migrasi yang tersedia telah diselaraskan dengan versi yang tercatat di Supabase. Ini hanya mengganti nama file, bukan menjalankan ulang SQL.


## Pemeriksaan ulang 6 November 2026

- Jumlah riwayat migrasi remote bertambah menjadi 111; versi terakhir `20261106115240`.
- Branch `main` masih memiliki 27 file SQL migrasi yang cocok dengan versi remote.
- Dengan demikian, 81 versi historis belum memiliki pasangan SQL di branch `main`; dua migrasi entitlement terbaru sudah memiliki pasangan file yang cocok.
- Migrasi fail-closed entitlement telah diterapkan sebagai remote version `20261106113748` dan `20261106113750`; migrasi referral/commission lainnya tetap kandidat dan belum diterapkan.
- Jangan menutup selisih ini dengan `migration repair`, karena perintah tersebut tidak merekonstruksi isi SQL historis.

## Dampak

Aplikasi produksi tetap berjalan; kondisi ini tidak dengan sendirinya berarti skema database produksi rusak. Namun, repositori belum menjadi catatan migrasi lengkap. Menjalankan `supabase db push`, membuat project baru dari nol, atau merekonstruksi database hanya dari folder migrasi dapat gagal atau menghasilkan skema yang tidak setara.

## Aturan sementara

1. Jangan menjalankan `supabase db push` atau reset database dari folder migrasi saat ini.
2. Jangan membuat ulang 72 file yang hilang hanya berdasarkan nama migrasi. Nama tidak cukup untuk merekonstruksi SQL yang tepat.
3. Pulihkan SQL historis dari arsip/commit/backup yang tepercaya bila tersedia. Jika tidak, siapkan baseline schema terkontrol dari keadaan database saat ini, lalu dokumentasikan bahwa baseline tersebut bukan replay sejarah.
4. Sebelum menambah migrasi baru, pastikan versi file mengikuti versi remote berikutnya dan catat hasil penerapan melalui jalur migrasi yang sama.
5. Jangan mengubah atau menghapus baris riwayat migrasi Supabase secara manual untuk menyamarkan perbedaan.

## Perbaikan yang sudah dilakukan pada audit ini

- Menyamakan nama file migrasi yang tersedia dengan versi remote untuk 30 file yang ada.
- Menambahkan migrasi server timestamp dengan versi remote `20261105115528`.
- Menerapkan migrasi tersebut ke Supabase setelah pengujian aman dalam transaksi `BEGIN/ROLLBACK`.
- Memverifikasi kolom `server_recorded_at` tersedia, tidak ada nilai kosong, trigger aktif, dan belum ada usaha yang menyetujui atau memulai trial.

Status: perlu rekonstruksi/arsip untuk 81 migrasi historis yang belum tersedia di repositori.
## Update 6 November 2026 setelah fail-closed entitlement

- Remote migration history kini berisi 111 versi, berakhir pada `20261106115240`.
- Dua migrasi entitlement diterapkan sebagai remote version `20261106113748` dan `20261106113750`, dan file SQL dengan nama versi yang sama tersedia di repository.
- Karena remote history bertambah dua sementara baseline historis belum lengkap, jumlah versi historis tanpa pasangan SQL tetap 81. Ini bukan bukti schema rusak, tetapi tetap menghalangi rekonstruksi project baru yang dapat diulang.
- Migrasi referral capture yang masih pending dengan versi lokal `20261105170000` lebih tua daripada remote latest; harus diberi versi baru sebelum diterapkan. Migrasi komisi provider-paid-time juga harus mengikuti urutan versi yang sama.

## Update setelah store_products RLS 6 November 2026

Remote migration history berisi 111 versi dan berakhir pada `20261106115240`. Direktori main memiliki 30 file SQL yang cocok, sehingga 81 migrasi historis tetap belum memiliki file SQL pasangan. Pending referral capture kini menggunakan versi `20261106115500`, provider-paid-time commission reconciliation `20261106115600`, dan quick-sale entitlement guard `20261106120000`; ketiganya belum diterapkan.
