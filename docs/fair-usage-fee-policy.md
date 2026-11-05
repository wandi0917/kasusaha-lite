# Kebijakan Biaya Layanan KasUsaha Lite — Draft Implementasi

Status: fondasi teknis sudah digabung ke main dan migrasi additive sudah diterapkan ke Supabase produksi. Belum berlaku untuk pengguna dan belum menagih.

## Kebijakan yang disepakati
- Lisensi/penggunaan awal tanpa biaya pendaftaran atau biaya bulanan tetap.
- Uji coba 30 hari sejak Owner menyetujui ketentuan untuk suatu usaha.
- Omzet bersih sampai Rp3.000.000 per bulan bebas biaya.
- Tarif 0,1% hanya atas bagian omzet bersih di atas Rp3.000.000.
- Formula: round(max(0, omzet_bersih - 3.000.000) * 0,001).
- Transaksi batal tidak masuk omzet jika tidak pernah diposting sebagai penjualan.
- Retur harus dicatat sebagai kategori retur penjualan agar dapat mengurangi dasar hitung.
- Tagihan bulanan dibayar Owner; tidak ada pemotongan diam-diam dari kasir.
- Komisi marketplace 2,5% tetap terpisah dan hanya atas subtotal produk yang pembayarannya telah diverifikasi.
- Tidak boleh ada penguncian/kehilangan/penahanan data karena tagihan.

## Batasan implementasi tahap pertama
- Migrasi menambahkan kolom persetujuan dan tabel ledger privat.
- RPC persetujuan memulai masa uji coba 30 hari untuk usaha yang menyetujui.
- RPC pratinjau hanya dapat dipanggil Owner; menghitung penjualan kategori Penjualan dikurangi kategori Retur Penjualan/Pengembalian Penjualan.
- Tidak ada invoice otomatis, pembayaran otomatis, pemotongan saldo, atau penguncian fitur.
- Data usaha lama tidak otomatis diberi tanggal mulai uji coba dan tidak otomatis ditagih.
- Migrasi additive sudah tercatat di Supabase produksi; belum ada usaha yang memulai trial (semua timestamp consent/trial tetap NULL).
- Penagihan tetap dinonaktifkan sampai pencatatan retur/pembatalan, rekonsiliasi, tampilan persetujuan, dan pengujian end-to-end selesai.

## Risiko yang harus ditutup sebelum aktivasi
1. Pastikan semua sumber penjualan (kasir cepat, bill meja, catatan manual, sinkronisasi offline) masuk ke sumber data yang benar.
2. Pastikan edit/hapus/retur tidak dapat mengubah dasar komisi secara tidak terlacak.
3. Pastikan transaksi marketplace tidak ikut dihitung sebagai omzet kasir.
4. Pastikan laporan, pembulatan rupiah, batas bulan Asia/Jakarta, dan idempotensi tagihan teruji.
5. Pastikan mekanisme tagihan dan pajak/aturan usaha ditinjau sebelum komersialisasi.
6. Pertahankan lisensi lama dan jalur Midtrans sampai migrasi hak akses gratis diuji terpisah.

## Status
Fondasi sudah digabung ke main dan migrasi additive sudah diterapkan ke Supabase produksi. Perubahan ini belum mengaktifkan UI, trial pengguna, invoice, penagihan, atau deployment pembayaran produksi.


## Audit tambahan — batas periode dan akurasi
- Penjualan dan retur pada pratinjau dibatasi pada `created_at >= trial_started_at + 30 days` dan sebelum awal bulan berikutnya dalam zona waktu Asia/Jakarta. Ini mencegah penjualan sebelum akhir masa uji coba ikut masuk dalam pratinjau bulan yang sama.
- Batas akhir periode memakai awal bulan berikutnya (exclusive), sehingga transaksi pada hari terakhir bulan tetap dihitung.
- RPC persetujuan mengembalikan timestamp trial yang benar-benar tersimpan di database, bukan perkiraan `now()` kedua.
- Karena `financial_transactions` saat ini hanya memiliki `transaction_date` bertipe DATE dan `created_at`, waktu kejadian asli transaksi offline belum dapat dipastikan. Karena itu pratinjau tetap bukan tagihan dan tidak boleh digunakan untuk menagih sampai semua jalur offline menyimpan waktu kejadian asli dan audit trail.
- Pengembalian harus dicatat sebagai expense dengan kategori retur yang dikenal; hubungan retur dengan penjualan asal belum tersedia pada fondasi ini.

## Kasus uji wajib sebelum aktivasi
1. Owner sah dapat menyetujui; Employee, user anonim, dan Owner usaha lain ditolak.
2. Persetujuan kedua tidak mengulang atau memperpanjang masa trial.
3. Penjualan sebelum trial berakhir tidak masuk ke pratinjau komisi.
4. Penjualan setelah trial berakhir masuk ke bulan lokal Asia/Jakarta yang benar.
5. Transaksi pada detik sebelum dan sesudah pergantian bulan masuk ke periode yang tepat.
6. Omzet bersih Rp3.000.000 menghasilkan Rp0; Rp3.000.001 menghasilkan pembulatan 0 rupiah menurut aturan pembulatan saat ini; Rp3.005.000 menghasilkan Rp5.
7. Retur mengurangi omzet sesuai tanggal dan kategori yang tercatat.
8. Penjualan marketplace, ongkir, pembayaran Midtrans, dan komisi affiliate tidak masuk ke omzet POS.
9. RPC tidak membocorkan data usaha lain; akses ledger privat tetap tertutup untuk anon/authenticated.
10. Penagihan tetap nonaktif dan tidak mengubah transaksi, saldo kasir, lisensi, atau hak akses.

