# Backup Supabase KasUsaha Lite

Workflow ini membuat dump PostgreSQL dan salinan objek bucket Storage `product-photos` dari runner GitHub-hosted. Arsip digabung dan dienkripsi AES-256 sebelum diunggah sebagai GitHub Actions artifact.

## Prasyarat satu kali

Di GitHub, buka **Settings → Secrets and variables → Actions → New repository secret** pada repository `wandi0917/kasusaha-lite`. Buat empat repository secrets berikut:

| Nama secret | Isi |
|---|---|
| `SUPABASE_URL` | `https://flvdudmdltjjdjkdngbv.supabase.co` |
| `SUPABASE_DB_URL` | Connection URI database dari Supabase Dashboard → Connect → Session pooler. Gunakan password database yang benar dan `sslmode=require`. Jika password memiliki karakter khusus, URL-encode password sebelum membentuk URI. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key dari Supabase API settings. Ini kredensial sangat berkuasa; simpan hanya sebagai GitHub Actions secret dan jangan pernah menaruhnya di kode, issue, log, atau chat. |
| `BACKUP_PASSPHRASE` | Frasa sandi acak yang kuat, minimal 32 karakter. Simpan salinan frasa sandi ini secara terpisah di tempat aman. Tanpanya arsip tidak dapat dibuka. |

**Penting:** Jangan gunakan database password, service-role key, atau frasa sandi yang sama. Jangan pernah menaruh nilai secret ke file repository.

## Menjalankan backup

1. Setelah empat secrets disimpan, buka tab **Actions** repository.
2. Pilih **Encrypted Supabase backup**.
3. Klik **Run workflow**, pilih branch `main`, lalu jalankan.
4. Buka hasil run. Pastikan seluruh langkah berstatus hijau.
5. Unduh artifact `kasusaha-supabase-backup-...` sebelum masa simpan 7 hari berakhir.
6. Simpan ZIP/artifact terenkripsi di penyimpanan pribadi dengan akses terbatas. Artifact GitHub hanya penampung sementara, bukan arsip permanen.

Workflow dijadwalkan **setiap hari pukul 02.17 WIB** (cron `17 19 * * *` UTC). Setelah setiap run terjadwal, periksa GitHub Actions dan pastikan run berstatus berhasil serta artifact terenkripsi tersedia. Artifact hanya disimpan 7 hari; unduh salinan secara berkala dan pindahkan ke penyimpanan privat dengan akses terbatas. Jangan menganggap jadwal berarti backup telah berhasil: keberhasilan tetap bergantung pada empat repository secrets yang valid dan run yang selesai tanpa error.

## Isi dan batasan

- Database dibuat sebagai PostgreSQL custom dump menggunakan klien PostgreSQL 17.
- Isi objek bucket `product-photos` diunduh secara terpisah.
- Arsip dienkripsi AES-256 dan diverifikasi dapat didekripsi serta dibaca sebelum artifact diunggah.
- Workflow tidak menjalankan migrasi, tidak mengubah data produksi, dan tidak melakukan restore.
- Bucket yang dicadangkan saat ini hanya `product-photos`. Jika bucket baru ditambahkan, workflow harus ditinjau dan diperluas.
- File konfigurasi/migrasi/Edge Functions tetap tersedia dari riwayat Git repository; jangan pernah memasukkan secrets ke Git.
- Restore belum dianggap teruji sampai dump dipulihkan ke proyek Supabase terpisah dan objek Storage diverifikasi.

## Retensi dan keamanan

Artifact GitHub disimpan selama 7 hari. Repository ini bersifat publik, sehingga artifact juga mungkin dapat diunduh publik; karena itu hanya ciphertext terenkripsi yang diunggah. Jaga kerahasiaan `BACKUP_PASSPHRASE`. Jika frasa sandi hilang, backup tidak dapat dipulihkan. Gunakan hanya workflow dari branch `main`, dan jangan menambahkan trigger `pull_request` untuk pekerjaan yang memakai secrets.
