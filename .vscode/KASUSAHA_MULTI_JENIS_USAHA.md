# KasUsaha Lite — Implementasi Multi-Jenis Usaha Dinamis

Dokumen kerja untuk VS Code / GitHub Copilot. Target: memperluas KasUsaha Lite tanpa merusak data, alur, atau fitur yang sudah berjalan.

## Status dan batasan

- Repository: `wandi0917/kasusaha-lite`
- Branch kerja: `feature/dynamic-business-modules-20261107`
- Branch produksi: `main`
- Frontend utama saat ini: `index.html` (aplikasi satu halaman dengan JavaScript inline).
- Backend: Supabase. Pembuatan workspace saat ini memanggil RPC `create_business_workspace_details` dengan parameter `p_business_type`.
- Validasi proyek yang sudah ada: `node scripts/validate-app.mjs`.
- Jangan mengubah `main`, jangan deploy, jangan menjalankan migrasi produksi, dan jangan menghapus data.
- Jangan meminta atau menampilkan password, Supabase service-role key, Midtrans key, Biteship key, atau secret lain.
- Semua perubahan harus additive, kompatibel dengan usaha lama, dan dapat dibatalkan.

## Tujuan produk

Saat Owner membuat atau mengatur usaha, Owner memilih jenis usaha. Aplikasi kemudian menyesuaikan dashboard, menu, submenu, form produk/jasa, kategori, satuan, dan panduan berdasarkan jenis usaha. Semua jenis usaha tetap memakai inti sistem yang sama: autentikasi, workspace, kasir, transaksi, persediaan, laporan, karyawan, lisensi, backup, dan hak akses.

## Jenis usaha yang harus tersedia

Gunakan value stabil (slug) dan label Bahasa Indonesia. Jangan menyimpan label tampilan sebagai identifier baru.

| Value | Label |
|---|---|
| `grocery` | Warung / Sembako |
| `food_beverage` | Restoran / Kedai / Kafe |
| `retail` | Toko Retail / Minimarket / Grosir |
| `pharmacy` | Apotek |
| `drugstore` | Toko Obat |
| `pharmaceutical_retail` | Toko Farmasi |
| `optical` | Optik |
| `medical_equipment` | Toko Alat Kesehatan |
| `clinic` | Klinik (administrasi usaha; bukan rekam medis klinis) |
| `fashion` | Pakaian / Sepatu / Tas |
| `beauty` | Salon / Kecantikan / Kosmetik |
| `service` | Jasa |
| `laundry` | Laundry |
| `workshop` | Bengkel |
| `electronics` | Elektronik / HP / Komputer |
| `manufacturing` | Produksi / Manufaktur |
| `agriculture` | Pertanian / Perikanan / Peternakan |
| `automotive_parts` | Suku Cadang Otomotif |
| `online_store` | Usaha Online |
| `other` | Usaha Lainnya |

### Kompatibilitas data lama (wajib)

Nilai lama yang tersimpan sekarang berupa label seperti `Warung / Sembako`, `Restoran / Kedai / Kafe`, `Toko Retail`, `Jasa`, `Produksi / Manufaktur`, `Usaha Online`, `Salon / Kecantikan`, `Bengkel`, `Pertanian / Perikanan`, dan `Lainnya`.

Buat fungsi normalisasi/mapping yang membaca nilai lama dan baru. Jangan memaksa migrasi data lama atau mengubah semua nilai existing. Jika jenis tidak dikenal, fallback ke modul umum `other` dan jangan menyembunyikan data atau fitur lama.

## Desain modul dan navigasi

Buat satu konfigurasi terpusat, misalnya `BUSINESS_TYPE_CONFIG`, dengan:
- label dan ikon jenis usaha;
- menu utama dan submenu;
- field tambahan formulir produk;
- kategori awal yang dapat diedit Owner;
- satuan yang relevan;
- peringatan stok/masa berlaku yang relevan;
- teks panduan singkat.

Pisahkan **fitur inti** dan **fitur khusus jenis usaha**. Jangan menduplikasi fungsi kasir atau transaksi per jenis usaha. Menu yang tidak relevan boleh disembunyikan dari navigasi, tetapi data dan akses backend tidak boleh diamankan hanya dengan menyembunyikan tombol. Perubahan jenis usaha setelah workspace dibuat harus melalui pengaturan Owner, meminta konfirmasi, dan tidak menghapus atau mengonversi data lama secara otomatis.

### Modul apotek / toko obat / toko farmasi

Tambahkan field produk khusus bila relevan:
- nama obat/produk, zat aktif, kekuatan/dosis dan bentuk sediaan;
- kategori obat dan status resep (sesuai klasifikasi yang diinput pihak usaha);
- nomor izin edar/NIE dan nomor registrasi yang relevan;
- nomor batch/lot, tanggal kedaluwarsa;
- pemasok, harga beli/jual, stok, satuan kemasan dan konversi satuan;
- batas stok minimum dan peringatan kedaluwarsa;
- riwayat pembelian, penjualan, retur, dan penyesuaian stok.

Persyaratan keselamatan:
- Jangan membuat rekomendasi obat, diagnosis, substitusi obat, atau keputusan klinis otomatis.
- Jangan mengizinkan sistem menganggap semua obat boleh dijual bebas. Sediakan flag/status resep dan validasi operasional yang dapat dikonfigurasi serta harus diverifikasi Owner/tenaga kefarmasian.
- Jangan menyimpan data pasien atau resep klinis rinci pada rilis pertama. Jika kelak dibutuhkan, rancang privasi, persetujuan, retensi, audit akses, dan kepatuhan secara terpisah.
- Tandai modul ini sebagai alat administrasi stok/penjualan, bukan pengganti izin apotek, apoteker/tenaga kefarmasian, atau kewajiban hukum. Jangan mengklaim aplikasi menjamin kepatuhan BPOM/Kemenkes.

### Modul optik

Field tambahan yang dapat digunakan:
- jenis frame, merek, warna, ukuran frame;
- jenis lensa, material, indeks, coating;
- status stok atau pesanan khusus;
- status pengerjaan (pesanan, diproses, selesai, diserahkan);
- data pelanggan minimum yang diperlukan.

Jangan menjadikan penyimpanan resep/parameter mata sebagai kewajiban. Jika diimplementasikan, batasi akses dan minimalkan data pribadi; jangan memberi diagnosis atau rekomendasi medis.

### Modul jenis usaha lain

- Makanan/minuman: varian, ukuran/porsi, bahan/komposisi opsional, satuan, catatan pesanan.
- Laundry: layanan, berat/jumlah, status proses, tanggal janji selesai.
- Bengkel: jasa servis, suku cadang, kendaraan/nomor pekerjaan secara opsional.
- Jasa: katalog layanan, durasi, tarif, status pekerjaan.
- Fashion/retail: ukuran, warna, varian, barcode.
- Elektronik: merek, model, nomor seri opsional, garansi.
- Pertanian: satuan berat/volume, varietas/jenis, batch dan tanggal opsional.
- Manufaktur: bahan baku, hasil produksi, biaya produksi; jangan menambahkan perhitungan kompleks tanpa rekonsiliasi stok.

## Rencana implementasi bertahap

### Tahap 1 — Audit sebelum edit
1. Baca seluruh `index.html`, terutama:
   - markup `financeBusinessType`;
   - `financeCreateBusiness()`;
   - `loadFinanceWorkspace()` dan pembacaan `business_type`;
   - pemilihan workspace Owner/Karyawan;
   - fungsi `buka()` dan navigasi;
   - formulir produk, kasir, stok, laporan dan absensi.
2. Periksa migrasi/RPC `create_business_workspace_details` dan skema tabel usaha/workspace yang sebenarnya. Jangan menebak nama tabel atau kolom.
3. Catat semua lokasi yang bergantung pada string jenis usaha. Pastikan tidak ada constraint database yang menolak slug baru.
4. Catat baseline hasil `node scripts/validate-app.mjs`.

### Tahap 2 — Implementasi frontend
1. Tambahkan pilihan jenis usaha baru ke form `financeBusinessType`, gunakan slug stabil.
2. Tambahkan normalisasi untuk seluruh label lama.
3. Render dashboard dan menu dari konfigurasi terpusat berdasarkan jenis usaha aktif.
4. Pertahankan menu inti dan seluruh route lama. Semua tombol menu baru harus menuju section/handler nyata; jangan membuat tombol dekoratif.
5. Tambahkan field khusus pada form produk dengan validasi yang sesuai; field tambahan tidak boleh merusak produk lama.
6. Kategori dan satuan default harus dapat diedit Owner.
7. Tampilkan ringkasan jenis usaha aktif dan tombol Pengaturan Jenis Usaha bagi Owner. Karyawan hanya mengikuti konfigurasi workspace.
8. Jika data jenis usaha gagal dimuat, gunakan navigasi umum yang aman dan tampilkan pesan; jangan membuat menu hilang total.

### Tahap 3 — Database / Supabase
1. Hanya setelah skema aktual diperiksa, buat migrasi SQL additive jika diperlukan.
2. Jangan mengganti nama atau menghapus kolom existing. Jangan mengubah RPC lama secara breaking.
3. Bila menambah kolom metadata atau tabel konfigurasi, beri default aman, index seperlunya, RLS ketat, dan kebijakan Owner/Karyawan yang eksplisit.
4. Jangan menyimpan field khusus yang sensitif secara berlebihan. Pastikan RLS dan validasi server-side tetap berlaku.
5. Migrasi harus idempotent bila pola proyek mendukungnya dan harus punya instruksi rollback.
6. Jangan menjalankan migrasi pada Supabase produksi tanpa persetujuan Owner setelah SQL ditinjau.

### Tahap 4 — Pengujian wajib
Buat/update test otomatis untuk:
- seluruh jenis baru dapat dipilih dan tersimpan;
- jenis lama tetap terbaca dan dipetakan benar;
- Owner dapat membuka menu sesuai jenis;
- Karyawan hanya melihat menu yang diizinkan;
- menu inti (kasir, produk, stok, transaksi, laporan, absensi) tetap tersedia sesuai paket dan role;
- perubahan jenis usaha tidak menghapus produk/transaksi;
- usaha tanpa jenis atau jenis tak dikenal tetap dapat dibuka;
- apotek: batch, kedaluwarsa, stok minimum, dan status resep tidak dapat dilewati secara tidak sengaja;
- optik: variasi frame/lensa dan status pengerjaan tersimpan;
- semua tombol baru punya handler/target yang ada;
- tidak ada duplicate HTML ID atau syntax error;
- seluruh tes lama tetap lulus.

Jalankan `node scripts/validate-app.mjs` dan test tambahan yang relevan. Laporkan tes yang tidak dapat dijalankan karena belum ada environment/akun uji; jangan mengarang hasil.

### Tahap 5 — Review dan rilis
1. Tampilkan daftar file yang berubah dan alasan.
2. Tampilkan SQL/migrasi sebelum dijalankan.
3. Buat ringkasan risiko, hasil test, dan langkah rollback.
4. Buat Pull Request ke `main`; jangan merge atau deploy sebelum Owner memeriksa dan menyetujui.
5. Setelah disetujui, lakukan smoke test pada staging/preview dahulu, lalu verifikasi Cloudflare Pages.

## Prompt siap tempel ke VS Code AI / GitHub Copilot

> Anda adalah senior engineer yang bertanggung jawab memperbaiki dan menyiapkan KasUsaha Lite untuk penjualan. Baca dokumen `.vscode/KASUSAHA_MULTI_JENIS_USAHA.md` sampai selesai, lalu audit repository aktual sebelum mengubah kode. Implementasikan Dynamic Business Modules untuk semua jenis usaha yang tercantum, terutama Apotek, Toko Obat, Toko Farmasi, Optik, Toko Alat Kesehatan, serta jenis usaha lama. Gunakan konfigurasi terpusat untuk dashboard, navigasi, form produk, kategori, satuan, dan panduan. Pertahankan kompatibilitas data lama dan seluruh alur kasir, barcode, stok, transaksi, absensi, laporan, lisensi, marketplace, pembayaran, pengiriman, dan backup.
>
> Jangan menebak skema Supabase. Telusuri RPC, migrasi, RLS, dan pemanggilan frontend sebelum membuat perubahan database. Semua perubahan harus additive dan tidak merusak data. Jangan mengubah branch main, jangan deploy, jangan menjalankan migrasi produksi, dan jangan mengakses atau mencetak secret. Kerjakan bertahap, jalankan test yang tersedia, perbaiki regresi, dan laporkan file yang berubah, hasil tes pass/fail, risiko yang belum terselesaikan, serta rollback. Jika ada keputusan yang berdampak pada data/uang/keamanan atau memerlukan migrasi produksi, berhenti dan minta persetujuan Owner. Akhiri dengan Pull Request draft untuk review, bukan merge otomatis.

## Definisi selesai

Fitur belum dianggap selesai hanya karena pilihan jenis usaha muncul. Selesai berarti:
- jenis usaha tersimpan dan terbaca setelah logout/login;
- navigasi benar untuk Owner dan Karyawan;
- form dan alur khusus berfungsi;
- data lama tetap aman;
- RLS dan lisensi tidak bocor;
- tes regresi lulus;
- preview dapat diuji sebelum rilis produksi.
