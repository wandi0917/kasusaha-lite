# Pencairan Seller Marketplace — transfer bank manual

## Status
Draft implementasi di branch `feat/manual-seller-payout-workflow`. Tidak diterapkan ke Supabase Production dan tidak mengubah data pesanan atau uang. Migrasi harus menunggu rekonsiliasi baseline 88 versi remote yang belum mempunyai pasangan file lokal.

## Kebijakan yang diterapkan
- Seller hanya dapat meminta payout untuk item miliknya.
- Item eligible hanya jika pesanan Midtrans berstatus paid/processing/completed, event capture/settlement terverifikasi dan diproses, tidak memerlukan review, Biteship menyatakan delivered, serta timestamp delivered tervalidasi sudah lewat 7 × 24 jam.
- Refund, chargeback, dispute, retur, dan penahanan manual menggagalkan eligibility. Status refunded/partially_refunded/returned tidak dibayar.
- Fee platform 2,5% dihitung dari subtotal produk per item. Ongkir tidak masuk dasar fee.
- Nilai seller = subtotal item − fee 2,5%. Penyesuaian/refund non-komisi membuat item ditahan sampai rekonsiliasi manual.
- Tidak ada minimum payout atau biaya transfer yang diasumsikan; keduanya belum ditetapkan.

## Alur transfer manual
1. Seller mengajukan payout; server memilih seluruh item eligible yang belum pernah dialokasikan dan mengunci permintaan per seller.
2. Sistem membuat satu payout ledger batch berstatus pending serta detail per item. Unique order_item_id mencegah alokasi kedua.
3. Platform Owner memeriksa penerima dan jumlah, lalu melakukan transfer bank di kanal bank di luar aplikasi.
4. Setelah transfer dimulai, Owner mencatat referensi, mengunggah bukti ke bucket privat, lalu mengubah status menjadi submitted.
5. Setelah bukti bank benar-benar dikonfirmasi, Owner mengubah status submitted menjadi paid. Permintaan seller tidak dapat mengubah status ini.
6. Transfer gagal dapat ditandai failed. Item tetap terikat pada batch lama; Owner dapat melakukan retry ke submitted pada batch yang sama, bukan membuat alokasi baru.

## Keamanan
- Service-role key hanya berada di Edge Function.
- RPC memeriksa auth.uid(); operasi Owner memeriksa platform_admins.active dan role platform_owner.
- Fungsi sensitif berada di schema private, search_path kosong, dan privilege dibatasi.
- Detail payout tidak dapat dibaca langsung melalui Data API. Seller statement difilter berdasarkan recipient_user_id di server.
- Bukti disimpan di bucket privat; akses melalui signed URL singkat untuk Platform Owner.
- Nomor rekening tidak disimpan. Tujuan rekening tetap melalui kanal operasional privat yang disetujui.
- Tabel payout_items mengikat satu order item ke satu payout untuk mencegah pembayaran ganda.
- Item yang telah submitted/paid tidak dapat di-hold atau diubah alokasinya.

## Catatan implementasi dan pengujian
- Webhook Biteship menulis shipping_delivered_at hanya saat signed status event delivered diterima; masa 7 hari dihitung dari timestamp server ini, bukan timestamp browser.
- Migrasi ini additive, tetapi BELUM boleh dijalankan pada Production sebelum migration baseline direkonsiliasi.
- CI menjalankan Deno lint seluruh Edge Functions dan scripts/validate-app.mjs.
- Test lokal harus meliputi request ganda, request paralel seller yang sama, seller mencoba item milik seller lain, pembayaran belum verified, masa tahan kurang dari 7 hari, retur/refund/dispute, hold manual, nominal komisi/ongkir, status submitted/paid, bukti transfer, gagal dan retry.
- Belum ada pengujian database staging karena tidak tersedia staging database terisolasi pada sesi ini. Tidak ada test payout uang sungguhan.
- Maker/checker belum tersedia; tahap pertama mempercayakan verifikasi transfer kepada Platform Owner aktif tunggal. Ini perlu dicatat sebagai risiko operasional.
