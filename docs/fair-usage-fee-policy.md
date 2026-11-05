# Kebijakan Biaya Layanan KasUsaha Lite — Draft Implementasi

Status: rancangan teknis, belum berlaku untuk pengguna dan belum menagih.

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
- Penagihan tetap dinonaktifkan sampai pencatatan retur/pembatalan, rekonsiliasi, tampilan persetujuan, dan pengujian end-to-end selesai.

## Risiko yang harus ditutup sebelum aktivasi
1. Pastikan semua sumber penjualan (kasir cepat, bill meja, catatan manual, sinkronisasi offline) masuk ke sumber data yang benar.
2. Pastikan edit/hapus/retur tidak dapat mengubah dasar komisi secara tidak terlacak.
3. Pastikan transaksi marketplace tidak ikut dihitung sebagai omzet kasir.
4. Pastikan laporan, pembulatan rupiah, batas bulan Asia/Jakarta, dan idempotensi tagihan teruji.
5. Pastikan mekanisme tagihan dan pajak/aturan usaha ditinjau sebelum komersialisasi.
6. Pertahankan lisensi lama dan jalur Midtrans sampai migrasi hak akses gratis diuji terpisah.

## Status
Draft untuk review PR. Tidak diterapkan ke Supabase produksi dan tidak dideploy ke Cloudflare.
