# Audit Menu Transaksi KasUsaha Lite — 7 November 2026

## Ruang lingkup pemeriksaan

- Kasir Cepat: input produk, jumlah, stok, total, uang diterima, kembalian, submit, retry, dan konfirmasi hasil.
- RPC Supabase `record_store_quick_sale`.
- Pengurangan stok dan pencatatan pergerakan stok.
- RLS `financial_transactions`, `store_products`, `business_members`, dan `business_attendance`.
- Constraint data transaksi, stok, dan absensi.
- Antrean offline dan idempotensi yang sudah tercakup pada validator aplikasi.

## Temuan yang diverifikasi

1. Frontend sebelumnya sudah memeriksa uang diterima di browser, tetapi pemanggilan RPC hanya mengirim empat argumen: `p_business_id`, `p_table_number`, `p_lines`, dan `p_request_id`. Dengan demikian nominal uang diterima belum diverifikasi oleh server.
2. Database produksi saat audit hanya memiliki RPC empat argumen. RPC lima argumen dengan `p_cash_received` belum tersedia.
3. Database produksi belum memiliki tabel `public.store_stock_movements`, trigger `store_products_stock_movement_audit`, dan RPC `adjust_store_product_stock`.
4. File migration `20261107120000_transaction_cash_validation_and_stock_movement_ledger.sql` sudah ada di repository, tetapi belum tercatat di riwayat migration project Supabase. Migration tersebut membuat ledger stok, trigger, RPC lima argumen, validasi uang diterima, dan mencabut akses client ke RPC lama empat argumen.
5. Kebijakan RLS pada transaksi, katalog, anggota usaha, dan absensi membatasi akses berdasarkan keanggotaan aktif, peran, identitas karyawan, lisensi, dan entitlement paket. Constraint database juga membatasi nominal positif, tipe transaksi, deskripsi, dan stok non-negatif.
6. Pemeriksaan log PostgreSQL 24 jam terakhir tidak menemukan error yang secara eksplisit menyebut `record_store_quick_sale`, `financial_transactions`, atau `business_attendance`. Ini bukan bukti bahwa seluruh alur runtime sudah lulus.

## Perubahan frontend pada branch ini

- Mengirim `p_cash_received` ke RPC lima argumen.
- Menambahkan uang diterima ke fingerprint idempotensi di perangkat.
- Memasukkan uang diterima dan kembalian ke dialog konfirmasi.
- Alur pembayaran tagihan tersimpan kini membedakan hasil settlement server dari kegagalan refresh laporan; kegagalan refresh tidak lagi dilaporkan sebagai pembayaran belum terkonfirmasi.
- Pembayaran tagihan tersimpan memeriksa nominal uang dan kembalian yang dikembalikan server, serta memberi instruksi jangan mengulang pembayaran bila settlement sudah dikonfirmasi.
- Form entri stok Owner menggunakan RPC atomik `adjust_store_product_stock`, request ID idempoten, dan verifikasi kuantitas sebelum/sesudah/delta dari server; pembaruan langsung kolom `stock_quantity` dari form klien dihapus.
- Form transaksi manual dan absensi membedakan keberhasilan write server dari kegagalan refresh layar/laporan, sehingga tidak salah melaporkan data tersimpan sebagai gagal.
- Form produk memverifikasi baris yang diperbarui, melewati RPC harga modal jika tidak ada perubahan harga modal (termasuk produk baru dengan modal nol), dan mempertahankan status sukses bila refresh daftar gagal.
- Nonaktifkan barang memverifikasi bahwa baris benar-benar berubah dan membedakan status server dari kegagalan refresh.
- Mode koreksi stok dapat menetapkan nilai nol; stok masuk/keluar tetap mensyaratkan jumlah minimal satu.
- Memverifikasi nilai uang diterima dan kembalian yang dikembalikan server.
- Jika server sudah mengonfirmasi penjualan tetapi nilai kas/kembalian tidak cocok, kunci idempotensi dipertahankan dan tombol submit dinonaktifkan. Pengguna diberi instruksi untuk tidak mengulang transaksi.
- Menampilkan nilai uang diterima dan kembalian yang sudah diverifikasi server pada pesan sukses.
- Menambah regression checks untuk kontrak frontend-RPC, pembayaran tagihan tersimpan, dan migration ledger stok/penyesuaian stok.

## Urutan cutover wajib

**Jangan deploy frontend branch ini sebelum migration lima argumen diterapkan ke Supabase.** Jika frontend baru dipasang sementara database masih hanya memiliki RPC empat argumen, transaksi kasir akan ditolak dengan function signature tidak ditemukan.

Migration tersebut mencabut akses client ke RPC empat argumen. Karena itu, penerapan migration dan deployment frontend harus dilakukan dalam jendela pemeliharaan terkoordinasi:
1. Beri tahu pengguna kasir bahwa layanan transaksi akan dihentikan sementara.
2. Ambil backup/point-in-time recovery checkpoint dan verifikasi migration belum pernah diterapkan.
3. Terapkan migration `20261107120000_transaction_cash_validation_and_stock_movement_ledger.sql`.
4. Verifikasi RPC lima argumen, tabel ledger, trigger, grants, dan migration history.
5. Deploy frontend branch ini segera setelah migration berhasil.
6. Uji transaksi nominal pas, uang lebih/kembalian, uang kurang, nominal pecahan, stok kurang, retry request yang sama, dan request ID dengan rincian berbeda.
7. Periksa bahwa satu penjualan menghasilkan satu transaksi pemasukan, satu pengurangan stok per baris barang, dan satu stock movement bertipe `sale`.

Tidak ada perubahan schema/database produksi yang dilakukan selama audit ini. Migration dan deployment produksi memerlukan persetujuan cutover tersendiri.

## Status verifikasi

- 52 pemeriksaan regresi statis terarah untuk kasir, tagihan, stok, transaksi manual, absensi, dan pengelolaan barang: ditambahkan; hasil CI terbaru menunggu setelah commit terakhir.
- Pemeriksaan schema Supabase read-only: selesai.
- Pemeriksaan RLS/constraint terkait transaksi: selesai.
- Pemeriksaan log PostgreSQL terkait transaksi pada jendela 24 jam: tidak menemukan error yang cocok.
- Uji browser end-to-end dengan akun Owner dan Karyawan: belum dilakukan.
- Uji perangkat barcode fisik/Bluetooth/kamera: belum dilakukan dalam sesi audit ini.
- Penerapan migration dan deployment produksi: belum dilakukan.


## Inventaris UI menu Transaksi (audit statis lanjutan)

Pemeriksaan struktur HTML dan binding JavaScript pada branch PR #95:

- 63 elemen tombol ditemukan di area menu Transaksi, termasuk submenu Kasir Cepat, Absensi, katalog karyawan, Pengaturan Akun Karyawan, Catat Transaksi, Barang & Stok, Laporan, biaya layanan, akuntansi, dan transaksi lokal.
- 9 form ditemukan: `quickSaleForm`, `storeProductForm`, `stockEntryForm`, `financeForm`, `financeJournalForm`, `financePartyForm`, `financeOpenItemForm`, `financeSettlementForm`, dan `formKas`. Kesembilan form memiliki binding submit di JavaScript.
- Enam tombol nominal uang tunai menggunakan binding kelas `.quick-sale-cash-option`; masing-masing mengisi nominal dan memperbarui preview pembayaran.
- Tombol aksi utama dengan ID (simpan transaksi, simpan tagihan, bayar tagihan, tambah barang, cetak barcode, stok, absensi, dan simpan transaksi bersama) memiliki binding event JavaScript.
- Tombol submenu yang memakai `onclick` mengarahkan ke panel atau fungsi terkait. Tombol laporan mencakup penjualan, stok, keuangan Owner, akuntansi, pemasukan Karyawan, laporan harian lokal, dan riwayat lokal.

Inventaris ini adalah pemeriksaan statis struktur dan binding, bukan bukti bahwa seluruh klik berhasil pada browser/perangkat nyata. Tombol yang dibuat secara dinamis di baris tabel (misalnya edit/hapus produk, edit absensi, buka tagihan, dan aksi jurnal) masih harus diuji dengan akun Owner dan Karyawan.

## Status uji yang belum boleh diklaim lulus

- Belum dilakukan uji klik end-to-end untuk seluruh 63 tombol pada browser desktop dan HP.
- Belum dilakukan uji akun Owner dan Karyawan pada data usaha nyata/simulasi yang terisolasi.
- Belum dilakukan uji fisik scanner Bluetooth dan kamera pada perangkat Android.
- Mode offline hanya menyimpan catatan lokal di perangkat; transaksi lokal tidak otomatis masuk ke laporan bersama. Pemindahan data dilakukan melalui aksi impor dan perlu verifikasi duplikasi sebelum dipakai pada data nyata.
- PR #95 masih draft. Tiga workflow CI pada commit `f147337df69d36068abd4c6b9c8981eacdbb6168` lulus, tetapi kelulusan CI tidak menggantikan pengujian browser, perangkat, dan cutover Supabase.


## Audit database dan keamanan lanjutan — 7 November 2026

### Kebijakan akses yang diverifikasi secara read-only

- `store_products`: SELECT dibatasi anggota aktif; Owner dapat menulis; Karyawan hanya membaca bila perangkat berbayar/aktif. Akses memerlukan lisensi terverifikasi dan fitur `basic_stock`.
- `financial_transactions`: Owner dapat membaca/mengubah/menghapus sesuai fitur paket; Karyawan hanya membuat dan membaca pemasukan yang dibuat oleh identitasnya, dengan perangkat aktif. Pengeluaran dan laporan keuangan penuh tetap Owner.
- `business_attendance`: pembacaan dibatasi Owner atau identitas Karyawan yang cocok dan perangkat aktif; RPC absensi memeriksa membership, lisensi, paket, serta identitas kanonis.
- `finance_accounts`, `finance_journal_entries`, `finance_journal_lines`, `finance_open_items`, dan `finance_parties`: kebijakan yang diperiksa membatasi operasi ke Owner dan fitur `full_finance`; jurnal yang sudah diposting tidak dapat diubah lewat jalur draft biasa.

### RPC SECURITY DEFINER yang diperiksa

- `record_store_quick_sale`: memeriksa sesi, membership aktif, peran, lisensi, entitlement kasir, dan aktivasi perangkat Karyawan; menggunakan advisory lock dan request ID idempoten.
- `settle_store_open_bill`: memeriksa membership, entitlement, nominal uang diterima, total terhadap rincian, status dan harga produk; mengunci tagihan saat settlement serta mencegah pembayaran kedua.
- `record_business_attendance_check_in/check_out`: memeriksa membership, lisensi, fitur absensi, aktivasi perangkat Karyawan, dan mencegah absen ganda.
- `edit_business_attendance_record` dan `set_business_attendance_hourly_wage`: memerlukan Owner terdaftar aktif dan fitur absensi.
- `get_store_product_costs`: hanya Owner terdaftar aktif dengan lisensi dan fitur keuangan penuh.

Advisor Supabase masih menampilkan peringatan umum untuk fungsi SECURITY DEFINER yang dapat dipanggil role authenticated. Fungsi-fungsi yang disebut di atas memiliki pemeriksaan otorisasi di dalam badan fungsi, tetapi seluruh daftar fungsi tersebut tetap perlu ditinjau satu per satu sebelum penjualan skala luas. Advisor juga menandai proteksi kata sandi bocor belum diaktifkan; ini perlu diaktifkan pada pengaturan Auth sebelum peluncuran komersial.

### Status branch dan integrasi

- PR #95 tetap draft dan belum digabung ke `main`.
- Branch PR #95 sebelumnya tertinggal dari perbaikan service-fee preview PR #96. Perbaikan frontend PR #96 dan migration RPC-nya sudah dibawa ke branch PR #95 agar penggabungan berikutnya tidak menghapus perbaikan yang sudah ada di `main`.
- Tiga workflow CI sebelumnya lulus pada commit `5fe9b43cb9dcf06c8b99a4b47316288646a195b3`. Setelah branch diperbarui untuk membawa perbaikan PR #96, workflow untuk commit terbaru belum tersedia/terkonfirmasi; jangan menganggapnya lulus.
- Database produksi belum menerapkan migration transaksi `20261107120000_transaction_cash_validation_and_stock_movement_ledger.sql`; frontend PR #95 tidak boleh dipasang ke produksi sebelum cutover terkoordinasi.
- Tidak ada transaksi usaha, stok, absensi, atau data keuangan yang diubah selama audit ini. Pemeriksaan database dilakukan read-only.
