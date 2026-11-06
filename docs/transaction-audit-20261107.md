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

- 30 pemeriksaan regresi statis terarah untuk penjualan, tagihan tersimpan, dan penyesuaian stok: lulus.
- Pemeriksaan schema Supabase read-only: selesai.
- Pemeriksaan RLS/constraint terkait transaksi: selesai.
- Pemeriksaan log PostgreSQL terkait transaksi pada jendela 24 jam: tidak menemukan error yang cocok.
- Uji browser end-to-end dengan akun Owner dan Karyawan: belum dilakukan.
- Uji perangkat barcode fisik/Bluetooth/kamera: belum dilakukan dalam sesi audit ini.
- Penerapan migration dan deployment produksi: belum dilakukan.
