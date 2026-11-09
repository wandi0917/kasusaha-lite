# Audit gap pencairan dana seller marketplace — 6 November 2026

Project Supabase Production: `flvdudmdltjjdjkdngbv`  
Repository: `wandi0917/kasusaha-lite`  
Scope: read-only schema/source review. No seller, payment, payout, or bank data was changed.

## Executive finding

Marketplace checkout, Midtrans payment verification, Biteship shipping gates, and the 2.5% platform commission calculation exist. A complete seller payout workflow does not yet exist. Physical marketplace Production payments must remain disabled until this gap is closed and tested.

## Verified live schema

### `marketplace_order_items`
- Has `order_id`, `seller_id`, `product_id`, item snapshot, `unit_price`, `quantity`, and `item_subtotal`.
- `seller_id` references `auth.users(id)`.
- The buyer/seller read policy limits each seller to their own item rows and buyers to their own order.

### `marketplace_commission_ledger`
- One row references an `order_item_id`, entry type, commission rate, calculation base, amount, unique idempotency key, and verified payment-event reference.
- It records platform commission, not seller payable balance.
- It does not store a seller ID or payout status. Seller identity can be derived through `marketplace_order_items.seller_id`.
- It has no direct `anon` or `authenticated` table access.

### `marketplace_payout_ledger`
- Supports recipient types `seller` and `platform_owner`, positive IDR amounts, statuses `pending`, `submitted`, `paid`, `failed`, `reversed`, and `cancelled`, provider/reference fields, idempotency key, timestamps, and notes.
- It has no order/item/commission detail relation, no approval actor, no transfer evidence field, and no seller payout profile relation.
- It has no direct `anon` or `authenticated` table access.

### Existing finance Edge Function
- `platform-marketplace-finance` is GET-only.
- It authorizes an active `platform_owner` in `platform_admins`.
- It selects payout rows only where `recipient_type = 'platform_owner'`.
- It does not provide a seller payout request, approval, transfer, or completion endpoint.

Snapshot Production read-only per 9 November 2026: 3 marketplace orders, 3 order-item rows, 5 payment-event rows, 1 marketplace commission row, and 0 payout rows. This includes two digital-license orders and one physical marketplace simulation order. No real seller payout has therefore been exercised; the simulation order is not evidence of a completed real-world seller transfer.

## Required design before seller payout is enabled

1. Add a payout-batch detail relation (for example, `marketplace_payout_items`) linking each payout batch to exact order items and commission ledger entries. Enforce unique linkage so an order item cannot be paid twice.
2. Build seller payable from server-owned records only. At minimum, reconcile the paid item subtotal against the platform commission and any explicit refund/reversal adjustments. Shipping must remain outside the 2.5% commission base and must not be silently added to seller proceeds.
3. Require the exact order to be paid, the matching Midtrans event to be verified and processed, the seller to match the item owner, and `payment_review_required = false`.
4. Define a release policy (for example, delivered plus a stated return/dispute hold period) before implementation. Do not infer a policy from a technical status alone.
5. Create batches atomically under row locks; enforce idempotency at batch and item level; prevent overlapping pending/submitted batches.
6. Use a controlled status transition model: pending → submitted → paid, with failed/cancelled/reversed handling and a documented retry path. A failed transfer must not lose the seller's entitlement or create a duplicate transfer.
7. Require two-person or maker/checker approval for manual transfers where practical. A request must never mark itself paid.
8. Store transfer reference and immutable evidence. Keep evidence in a private bucket with narrow access; never expose full bank account numbers in ordinary logs or UI.
9. Keep seller bank destination separate from public profile. Prefer a provider-managed recipient token; if account details must be stored, use an explicitly reviewed protected/encrypted design and strict access controls.
10. Add a seller-facing read-only statement and platform-owner reconciliation report, both derived from the same ledger rows.

## Recommended financial rule (not yet implemented)

For a physical product item:
- Platform fee = rounded 2.5% × item subtotal.
- Seller gross entitlement = item subtotal − platform fee.
- Shipping is excluded from the platform fee base and is reconciled separately.
- Refunds, chargebacks, partial refunds, and disputes hold the affected item until manually resolved; no automatic clawback or payout reversal without a matching audited adjustment.

Rounding, seller release timing, minimum payout threshold, bank-transfer fees, and who bears transfer fees must be formally fixed before enabling seller payout.

## Safe rollout sequence

1. Reconcile the Supabase migration baseline first. The current repository migration history is incomplete; do not run `db push`, reset, or guessed SQL.
2. Add additive schema only after the migration baseline is safely reconciled.
3. Implement server-side RPC/Edge Functions with explicit platform-owner authorization and service-role isolation.
4. Test on an isolated/staging database with synthetic users, orders, refunds, duplicate requests, concurrent payout attempts, failed transfers, and retries.
5. Verify every payout batch against the commission ledger and order items.
6. Keep physical marketplace Production payment gate disabled until all tests and merchant/shipping activation checks pass.

## Changes made by this audit

- No production schema or data changes.
- No payout was created and no money was transferred.
- This document is a verified gap assessment and design requirement, not an enabled payout feature.

## Pembaruan audit read-only 9 November 2026

Snapshot Production terbaru yang diperiksa secara agregat:
- 3 pesanan marketplace, 3 baris item, dan 5 event pembayaran tercatat.
- Dua pesanan adalah lisensi digital KasUsaha Lite; satu pesanan barang fisik merupakan data simulasi lama yang tidak diubah.
- Terdapat 1 baris komisi marketplace sebesar Rp300 pada item simulasi fisik, sesuai 2,5% dari subtotal barang Rp12.000 (ongkos kirim tidak menjadi dasar komisi).
- Komisi mitra lisensi: 0.
- Baris payout: 0; tidak ada bukti transfer seller.
- Rekonsiliasi agregat menemukan pesanan berstatus paid/processing/completed memiliki jumlah item yang cocok dengan subtotal pesanan, dan semua pesanan tersebut memiliki event pembayaran terverifikasi yang telah diproses.

Komisi Rp300 tersebut berasal dari data simulasi lama dan **bukan bukti bahwa alur pembayaran/pencairan seller sungguhan telah diuji**. Karena payout ledger masih kosong dan workflow seller payout belum tersedia, **jangan mengaktifkan pembayaran marketplace barang fisik Production atau menjanjikan pencairan dana otomatis**. Tampilan pencairan yang ada hanya laporan platform-owner dan bukan bukti transfer ke rekening.


## Keputusan pemilik — aturan pelepasan dana seller (disetujui 9 November 2026)

Pemilik menyetujui aturan berikut:
- Dana item seller baru eligible setelah pesanan memiliki status pembayaran `paid` yang sah, event Midtrans untuk pesanan tersebut berstatus `verified` dan sudah diproses, `payment_review_required = false`, dan status pengiriman Biteship item/pesanan adalah `delivered`.
- Masa tahan adalah **7 × 24 jam sejak waktu event delivered yang tervalidasi**, bukan sejak tanggal checkout, pembayaran, atau status yang dikirim browser.
- Item yang sedang terkena refund, chargeback, komplain/dispute, atau status pengembalian/retur harus tetap ditahan sampai pemeriksaan manual selesai.
- Komisi platform tetap 2,5% dari subtotal produk per item; ongkos kirim dikecualikan dari dasar komisi.
- Nilai bersih seller per item pada tahap awal = subtotal item dikurangi komisi 2,5%, dikurangi hanya penyesuaian/refund yang tercatat dan disetujui. Jangan membuat potongan tersembunyi.

## Desain implementasi yang wajib dipertahankan

1. Buat relasi payout-batch-item yang unik agar satu item pesanan tidak dapat dialokasikan ke dua batch.
2. Pembuatan batch harus server-side, atomik, menggunakan row lock dan idempotency key. Request ulang tidak boleh membuat transfer kedua.
3. Seller hanya dapat melihat statement miliknya; seller tidak boleh mengubah nominal, status, atau bukti transfer.
4. Platform Owner dapat meninjau, mengirim transfer manual, dan mencatat referensi/bukti. Status `paid` hanya boleh dicatat setelah transfer benar-benar dikonfirmasi; permintaan seller tidak boleh menandai dirinya paid.
5. Jangan menyimpan nomor rekening mentah di tabel publik, log, atau Edge Function response. Untuk tahap manual, detail rekening dikumpulkan melalui kanal operasional privat yang disetujui pemilik; desain penyimpanan rekening terproteksi/provider recipient token perlu review terpisah.
6. Status transfer harus mendukung retry aman untuk gagal; kegagalan transfer tidak menghapus hak seller dan tidak membuka alokasi ganda.
7. Semua perubahan ledger harus dapat direkonsiliasi dengan item order, event pembayaran, komisi, refund, dan bukti transfer.
8. Jangan aktifkan pembayaran marketplace barang fisik Production sampai workflow diuji pada staging terisolasi dengan synthetic users/orders, duplicate/concurrent requests, dispute/refund, failed transfer, dan retry.

## Keputusan operasional yang belum disepakati

Persetujuan aturan delivered + 7 hari **tidak** menentukan hal-hal berikut; jangan menebak:
- minimum nominal pencairan;
- siapa menanggung biaya transfer bank;
- kanal transfer (manual bank transfer atau penyedia disbursement);
- prosedur dan batas waktu sengketa/refund serta siapa yang mengesahkan penyesuaian;
- apakah akun Owner tunggal cukup untuk maker/checker, atau perlu admin kedua.

## Status implementasi setelah persetujuan

- Kebijakan release: **disetujui**.
- Perubahan skema/fungsi payout di Production: **belum diterapkan**.
- Alasan: migration baseline Production masih belum direkonsiliasi (88 versi remote belum memiliki pasangan file lokal dan satu file lokal belum cocok). Menambahkan migration baru lalu menjalankan `db push` saat ini berisiko mengeksekusi migration lama yang belum terpetakan.
- Tidak ada payout, transfer, perubahan saldo, atau data pesanan yang dibuat/diubah selama audit ini.
