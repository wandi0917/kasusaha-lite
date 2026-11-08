-- Keep verified Midtrans retries idempotent after the Seller advances an order.
-- These routines remain restricted by existing grants and verified-payment checks.
-- No ledger rows, balances, license rows, or order data are modified by this migration.

CREATE OR REPLACE FUNCTION public.issue_kasusaha_license(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_item public.marketplace_order_items%ROWTYPE;
  v_product public.produk%ROWTYPE;
  v_plan public.kasusaha_license_plans%ROWTYPE;
  v_license public.kasusaha_licenses%ROWTYPE;
  v_items_subtotal numeric := 0;
  v_digital_count integer := 0;
  v_physical_count integer := 0;
  v_code text;
  v_legacy boolean := false;
BEGIN
  SELECT * INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan.'; END IF;

  IF v_order.status NOT IN ('paid', 'processing', 'completed')
     OR v_order.paid_at IS NULL
     OR v_order.payment_provider <> 'midtrans'
     OR COALESCE(v_order.payment_review_required, false) THEN
    RAISE EXCEPTION 'Pesanan belum memenuhi syarat penerbitan lisensi.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_payment_events e
    WHERE e.order_id = p_order_id
      AND e.provider = 'midtrans'
      AND e.verification_status = 'verified'
  ) THEN
    RAISE EXCEPTION 'Lisensi tidak dapat diterbitkan tanpa event pembayaran Midtrans terverifikasi.';
  END IF;

  SELECT * INTO v_item
  FROM public.marketplace_order_items
  WHERE order_id = p_order_id AND product_id IN (7, 8, 9, 10)
  ORDER BY product_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'license_issued', false, 'reason', 'not_kasusaha_license_order');
  END IF;

  SELECT * INTO v_product
  FROM public.produk
  WHERE id = v_item.product_id AND kategori = 'Software Digital';
  IF NOT FOUND THEN RAISE EXCEPTION 'Produk paket digital tidak tersedia.'; END IF;

  v_legacy := NULLIF(TRIM(COALESCE(v_item.package_code, '')), '') IS NULL;
  IF v_legacy THEN
    IF v_item.product_id <> 7 THEN
      RAISE EXCEPTION 'Paket digital baru wajib memiliki kode paket.';
    END IF;
  ELSE
    v_code := LOWER(TRIM(v_item.package_code));
    -- Checkout paket resmi dapat menyimpan seluruh paket melalui produk induk ID 7.
    -- Checkout marketplace alternatif dapat menyimpan produk paket spesifik ID 8-10.
    SELECT * INTO v_plan
    FROM public.kasusaha_license_plans
    WHERE plan_code = v_code
      AND active IS TRUE
      AND (
        v_item.product_id = 7
        OR product_id = v_item.product_id
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kode paket tidak cocok dengan produk atau paket tidak aktif.';
    END IF;
    IF v_plan.product_id NOT IN (7, 8, 9, 10) THEN
      RAISE EXCEPTION 'Pemetaan produk paket tidak valid.';
    END IF;
    IF v_item.product_id <> 7 AND v_product.harga IS DISTINCT FROM v_plan.license_price THEN
      RAISE EXCEPTION 'Harga produk tidak sama dengan harga paket lisensi aktif.';
    END IF;
  END IF;

  SELECT COUNT(*) FILTER (WHERE p.kategori = 'Software Digital'),
         COUNT(*) FILTER (WHERE p.kategori IS DISTINCT FROM 'Software Digital')
  INTO v_digital_count, v_physical_count
  FROM public.marketplace_order_items i
  JOIN public.produk p ON p.id = i.product_id
  WHERE i.order_id = p_order_id;

  IF v_digital_count <> 1 OR v_physical_count <> 0 THEN
    RAISE EXCEPTION 'Pesanan lisensi harus berisi tepat satu paket digital tanpa produk fisik.';
  END IF;

  SELECT COALESCE(SUM(item_subtotal), 0)
  INTO v_items_subtotal
  FROM public.marketplace_order_items
  WHERE order_id = p_order_id;

  IF v_item.quantity <> 1
     OR (
       v_item.product_name_snapshot IS DISTINCT FROM v_product.nama_produk
       AND v_item.product_name_snapshot IS DISTINCT FROM 'KasUsaha Lite'
     )
     OR (NOT v_legacy AND COALESCE(v_item.package_term, '') <> 'initial')
     OR (v_legacy AND v_item.unit_price NOT IN (39000, 49000))
     OR (NOT v_legacy AND v_item.unit_price IS DISTINCT FROM v_plan.license_price)
     OR v_item.item_subtotal IS DISTINCT FROM v_item.unit_price
     OR v_order.item_subtotal IS DISTINCT FROM v_items_subtotal
     OR v_order.total_amount IS DISTINCT FROM (v_order.item_subtotal + COALESCE(v_order.shipping_amount, 0))
     OR COALESCE(v_order.shipping_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'Rincian paket lisensi atau nominal pesanan tidak sesuai.';
  END IF;

  SELECT * INTO v_license
  FROM public.kasusaha_licenses
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_license.buyer_id <> v_order.buyer_id THEN
      RAISE EXCEPTION 'Data lisensi yang sudah ada tidak cocok.';
    END IF;

    IF v_legacy THEN
      UPDATE public.kasusaha_licenses
      SET status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
          plan_code = NULL, package_code = NULL, package_name = NULL,
          product_name = 'KasUsaha Lite',
          activated_at = COALESCE(activated_at, now()),
          cloud_started_at = NULL, cloud_expires_at = NULL, updated_at = now()
      WHERE id = v_license.id
      RETURNING * INTO v_license;
      RETURN jsonb_build_object(
        'success', true, 'license_issued', true, 'already_exists', true,
        'license_id', v_license.id, 'status', v_license.status,
        'plan_code', 'legacy', 'package_name', 'Lisensi lama', 'cloud_expires_at', NULL
      );
    END IF;

    IF v_license.plan_code IS NOT NULL AND v_license.plan_code <> v_plan.plan_code THEN
      RAISE EXCEPTION 'Paket lisensi yang sudah tercatat berbeda dari paket pada pesanan.';
    END IF;

    IF v_license.status = 'pending' THEN
      UPDATE public.kasusaha_licenses
      SET status = 'active',
          plan_code = v_plan.plan_code,
          package_code = v_plan.plan_code,
          package_name = v_plan.plan_name,
          product_name = 'KasUsaha Lite',
          activated_at = COALESCE(activated_at, now()),
          cloud_started_at = COALESCE(cloud_started_at, now()),
          cloud_expires_at = COALESCE(cloud_expires_at, now() + make_interval(months => v_plan.cloud_months)),
          updated_at = now()
      WHERE id = v_license.id
      RETURNING * INTO v_license;
    ELSIF v_license.plan_code IS DISTINCT FROM v_plan.plan_code THEN
      RAISE EXCEPTION 'Lisensi aktif belum cocok dengan paket pesanan; perlu pemeriksaan manual.';
    END IF;

    RETURN jsonb_build_object(
      'success', true, 'license_issued', true, 'already_exists', true,
      'license_id', v_license.id, 'status', v_license.status,
      'plan_code', v_plan.plan_code, 'package_name', v_plan.plan_name,
      'cloud_expires_at', v_license.cloud_expires_at
    );
  END IF;

  INSERT INTO public.kasusaha_licenses (
    id, order_id, buyer_id, license_key, product_name, status,
    activated_at, created_at, updated_at, plan_code, package_code,
    package_name, cloud_started_at, cloud_expires_at
  )
  VALUES (
    gen_random_uuid(), p_order_id, v_order.buyer_id,
    'KS-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 24)),
    'KasUsaha Lite', 'active', now(), now(), now(),
    CASE WHEN v_legacy THEN NULL ELSE v_plan.plan_code END,
    CASE WHEN v_legacy THEN NULL ELSE v_plan.plan_code END,
    CASE WHEN v_legacy THEN NULL ELSE v_plan.plan_name END,
    CASE WHEN v_legacy THEN NULL ELSE now() END,
    CASE WHEN v_legacy THEN NULL ELSE now() + make_interval(months => v_plan.cloud_months) END
  )
  ON CONFLICT (order_id) DO NOTHING
  RETURNING * INTO v_license;

  IF NOT FOUND THEN
    SELECT * INTO v_license
    FROM public.kasusaha_licenses
    WHERE order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND OR v_license.buyer_id <> v_order.buyer_id THEN
      RAISE EXCEPTION 'Lisensi perlu diperiksa karena terjadi konflik.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'license_issued', true, 'already_exists', false,
    'license_id', v_license.id, 'status', v_license.status,
    'plan_code', CASE WHEN v_legacy THEN 'legacy' ELSE v_plan.plan_code END,
    'package_name', CASE WHEN v_legacy THEN 'Lisensi lama' ELSE v_plan.plan_name END,
    'cloud_expires_at', v_license.cloud_expires_at
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.record_license_partner_commission(p_order_id uuid, p_payment_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_first_order public.marketplace_orders%ROWTYPE;
  v_event public.marketplace_payment_events%ROWTYPE;
  v_referral public.license_order_referrals%ROWTYPE;
  v_partner public.license_marketing_partners%ROWTYPE;
  v_existing public.license_partner_commission_ledger%ROWTYPE;
  v_paid_order record;
  v_item_count integer := 0;
  v_digital_count integer := 0;
  v_base numeric := 0;
  v_rate numeric;
  v_type text;
  v_amount numeric;
  v_idempotency_key text;
  v_rows_inserted integer := 0;
  v_rows_updated integer := 0;
  v_current_created boolean := false;
  v_manual_review boolean := false;
  v_current_ledger public.license_partner_commission_ledger%ROWTYPE;
BEGIN
  SELECT * INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_order.status NOT IN ('paid', 'processing', 'completed')
     OR v_order.paid_at IS NULL
     OR v_order.payment_provider IS DISTINCT FROM 'midtrans'
     OR COALESCE(v_order.payment_review_required, false) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_verified_paid');
  END IF;

  SELECT * INTO v_event
  FROM public.marketplace_payment_events
  WHERE id = p_payment_event_id
    AND order_id = p_order_id
    AND provider = 'midtrans'
    AND event_type IN ('settlement', 'capture')
    AND verification_status = 'verified';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'payment_event_not_verified');
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE product_id IN (7, 8, 9, 10)),
         COALESCE(sum(item_subtotal) FILTER (WHERE product_id IN (7, 8, 9, 10)), 0)
    INTO v_item_count, v_digital_count, v_base
  FROM public.marketplace_order_items
  WHERE order_id = p_order_id;

  IF v_item_count = 0 OR v_digital_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'commission_created', false, 'reason', 'not_license_order');
  END IF;

  IF v_item_count <> v_digital_count OR v_base <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'mixed_or_invalid_license_order');
  END IF;

  -- Serialize every commission reconciliation for this buyer.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_order.buyer_id::text, 0)
  );

  -- Use provider-paid time, not webhook arrival order. Exclude mixed carts.
  SELECT o.* INTO v_first_order
  FROM public.marketplace_orders o
  WHERE o.buyer_id = v_order.buyer_id
    AND o.status IN ('paid', 'processing', 'completed')
    AND o.paid_at IS NOT NULL
    AND COALESCE(o.payment_review_required, false) = false
    AND EXISTS (
      SELECT 1
      FROM public.marketplace_payment_events e
      WHERE e.order_id = o.id
        AND e.provider = 'midtrans'
        AND e.event_type IN ('settlement', 'capture')
        AND e.verification_status = 'verified'
    )
    AND EXISTS (
      SELECT 1 FROM public.marketplace_order_items i
      WHERE i.order_id = o.id AND i.product_id IN (7, 8, 9, 10)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.marketplace_order_items i
      WHERE i.order_id = o.id AND (i.product_id IS NULL OR i.product_id NOT IN (7, 8, 9, 10))
    )
  ORDER BY o.paid_at ASC, o.created_at ASC, o.id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'first_paid_license_order_not_found');
  END IF;

  SELECT * INTO v_referral
  FROM public.license_order_referrals
  WHERE order_id = v_first_order.id
    AND buyer_id = v_order.buyer_id;

  IF NOT FOUND THEN
    -- A later order's referral must not receive first-purchase credit if the
    -- earliest provider-paid license order had no referral.
    DELETE FROM public.license_customer_attributions
    WHERE customer_id = v_order.buyer_id;

    UPDATE public.license_partner_commission_ledger
    SET status = 'cancelled',
        available_at = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        notes = concat_ws(' ', NULLIF(notes, ''),
          'Dibatalkan: pembelian lisensi pertama berdasarkan waktu pembayaran provider tidak memiliki referral.')
    WHERE customer_id = v_order.buyer_id
      AND status IN ('held', 'approved');

    UPDATE public.license_partner_commission_ledger
    SET notes = concat_ws(' ', NULLIF(notes, ''),
      'REVIEW MANUAL: komisi sudah dibayar tetapi urutan/referral pembelian pertama tidak lagi cocok.')
    WHERE customer_id = v_order.buyer_id
      AND status = 'paid'
      AND notes NOT LIKE '%REVIEW MANUAL:%';

    SELECT EXISTS (
      SELECT 1 FROM public.license_partner_commission_ledger
      WHERE customer_id = v_order.buyer_id AND status = 'paid'
        AND notes LIKE '%REVIEW MANUAL:%'
    ) INTO v_manual_review;

    RETURN jsonb_build_object(
      'success', true,
      'commission_created', false,
      'reason', 'first_paid_order_has_no_referral',
      'manual_review_required', v_manual_review
    );
  END IF;

  SELECT * INTO v_partner
  FROM public.license_marketing_partners
  WHERE id = v_referral.partner_id
    AND referral_code = v_referral.referral_code
    AND user_id <> v_order.buyer_id
  FOR SHARE;

  IF NOT FOUND THEN
    UPDATE public.license_partner_commission_ledger
    SET status = 'cancelled',
        available_at = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        notes = concat_ws(' ', NULLIF(notes, ''),
          'Dibatalkan: referral pada pembelian lisensi pertama tidak valid atau merupakan self-referral.')
    WHERE customer_id = v_order.buyer_id
      AND status IN ('held', 'approved');

    UPDATE public.license_partner_commission_ledger
    SET notes = concat_ws(' ', NULLIF(notes, ''),
      'REVIEW MANUAL: komisi sudah dibayar tetapi referral pembelian pertama tidak valid.')
    WHERE customer_id = v_order.buyer_id
      AND status = 'paid'
      AND notes NOT LIKE '%REVIEW MANUAL:%';

    SELECT EXISTS (
      SELECT 1 FROM public.license_partner_commission_ledger
      WHERE customer_id = v_order.buyer_id AND status = 'paid'
        AND notes LIKE '%REVIEW MANUAL:%'
    ) INTO v_manual_review;

    RETURN jsonb_build_object(
      'success', true,
      'commission_created', false,
      'reason', 'first_order_referral_invalid',
      'manual_review_required', v_manual_review
    );
  END IF;

  INSERT INTO public.license_customer_attributions
    (customer_id, partner_id, first_order_id, attributed_at)
  VALUES
    (v_order.buyer_id, v_partner.id, v_first_order.id, v_first_order.paid_at)
  ON CONFLICT (customer_id) DO UPDATE
    SET partner_id = EXCLUDED.partner_id,
        first_order_id = EXCLUDED.first_order_id,
        attributed_at = EXCLUDED.attributed_at;

  IF v_partner.status IS DISTINCT FROM 'active' THEN
    UPDATE public.license_partner_commission_ledger
    SET status = 'held',
        available_at = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        notes = concat_ws(' ', NULLIF(notes, ''),
          'Ditahan: mitra referral pembelian pertama tidak berstatus aktif.')
    WHERE customer_id = v_order.buyer_id
      AND status = 'approved';

    RETURN jsonb_build_object(
      'success', true,
      'commission_created', false,
      'reason', 'first_order_partner_not_active',
      'manual_review_required', false
    );
  END IF;

  -- Reconcile every already-paid license order for this buyer. This repairs
  -- out-of-order webhooks while commissions remain unpaid. Approved rows that
  -- change are returned to held; paid rows are never altered financially.
  FOR v_paid_order IN
    SELECT
      o.id AS order_id,
      o.paid_at,
      COALESCE(sum(i.item_subtotal), 0)::numeric AS calculation_base,
      (
        SELECT e.id
        FROM public.marketplace_payment_events e
        WHERE e.order_id = o.id
          AND e.provider = 'midtrans'
          AND e.event_type IN ('settlement', 'capture')
          AND e.verification_status = 'verified'
        ORDER BY e.processed_at DESC NULLS LAST, e.id DESC
        LIMIT 1
      ) AS payment_event_id
    FROM public.marketplace_orders o
    JOIN public.marketplace_order_items i ON i.order_id = o.id
    WHERE o.buyer_id = v_order.buyer_id
      AND o.status IN ('paid', 'processing', 'completed')
      AND o.paid_at IS NOT NULL
      AND COALESCE(o.payment_review_required, false) = false
      AND i.product_id IN (7, 8, 9, 10)
      AND EXISTS (
        SELECT 1
        FROM public.marketplace_payment_events ev
        WHERE ev.order_id = o.id
          AND ev.provider = 'midtrans'
          AND ev.event_type IN ('settlement', 'capture')
          AND ev.verification_status = 'verified'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.marketplace_order_items ix
        WHERE ix.order_id = o.id
          AND (ix.product_id IS NULL OR ix.product_id NOT IN (7, 8, 9, 10))
      )
    GROUP BY o.id, o.paid_at, o.created_at
    ORDER BY o.paid_at ASC, o.created_at ASC, o.id ASC
  LOOP
    IF v_paid_order.payment_event_id IS NULL OR v_paid_order.calculation_base <= 0 THEN
      CONTINUE;
    END IF;

    IF v_paid_order.order_id = v_first_order.id THEN
      v_rate := v_partner.first_purchase_rate;
      v_type := 'first_purchase';
    ELSE
      v_rate := v_partner.renewal_rate;
      v_type := 'renewal';
    END IF;

    v_amount := round(v_paid_order.calculation_base * v_rate, 0);
    -- A configured zero rate or a sub-rupiah rounded amount must not create a zero-value ledger row.
    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;
    v_idempotency_key := 'license-partner:' || v_paid_order.order_id::text;

    SELECT * INTO v_existing
    FROM public.license_partner_commission_ledger
    WHERE idempotency_key = v_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.status IN ('held', 'approved') AND (
        v_existing.partner_id IS DISTINCT FROM v_partner.id
        OR v_existing.payment_event_id IS DISTINCT FROM v_paid_order.payment_event_id
        OR v_existing.commission_type IS DISTINCT FROM v_type
        OR v_existing.commission_rate IS DISTINCT FROM v_rate
        OR v_existing.calculation_base IS DISTINCT FROM v_paid_order.calculation_base
        OR v_existing.amount IS DISTINCT FROM v_amount
        OR v_existing.status = 'approved'
      ) THEN
        UPDATE public.license_partner_commission_ledger
        SET partner_id = v_partner.id,
            payment_event_id = v_paid_order.payment_event_id,
            commission_type = v_type,
            commission_rate = v_rate,
            calculation_base = v_paid_order.calculation_base,
            amount = v_amount,
            status = 'held',
            available_at = NULL,
            reviewed_at = NULL,
            reviewed_by = NULL,
            notes = CASE WHEN v_type = 'first_purchase'
              THEN 'Rekonsiliasi: komisi pembelian lisensi pertama menggunakan first_purchase_rate mitra berdasarkan waktu pembayaran Midtrans; menunggu persetujuan admin.'
              ELSE 'Rekonsiliasi: komisi pembelian ulang lisensi menggunakan renewal_rate mitra berdasarkan waktu pembayaran Midtrans; menunggu persetujuan admin.'
            END
        WHERE id = v_existing.id;
        v_rows_updated := v_rows_updated + 1;
      ELSIF v_existing.status = 'paid' AND (
        v_existing.partner_id IS DISTINCT FROM v_partner.id
        OR v_existing.commission_type IS DISTINCT FROM v_type
        OR v_existing.commission_rate IS DISTINCT FROM v_rate
        OR v_existing.calculation_base IS DISTINCT FROM v_paid_order.calculation_base
        OR v_existing.amount IS DISTINCT FROM v_amount
      ) THEN
        UPDATE public.license_partner_commission_ledger
        SET notes = concat_ws(' ', NULLIF(notes, ''),
          'REVIEW MANUAL: komisi telah dibayar sebelum urutan pembayaran/referral direkonsiliasi. Jangan lakukan clawback otomatis.')
        WHERE id = v_existing.id
          AND notes NOT LIKE '%REVIEW MANUAL:%';
        v_manual_review := true;
      END IF;
    ELSE
      INSERT INTO public.license_partner_commission_ledger
        (partner_id, customer_id, order_id, payment_event_id, commission_type,
         commission_rate, calculation_base, amount, status, idempotency_key, notes)
      VALUES
        (v_partner.id, v_order.buyer_id, v_paid_order.order_id,
         v_paid_order.payment_event_id, v_type, v_rate,
         v_paid_order.calculation_base, v_amount, 'held',
         v_idempotency_key,
         CASE WHEN v_type = 'first_purchase'
           THEN 'Komisi pembelian lisensi pertama menggunakan first_purchase_rate mitra; berdasarkan waktu pembayaran Midtrans dan menunggu persetujuan admin.'
           ELSE 'Komisi pembelian ulang lisensi menggunakan renewal_rate mitra; berdasarkan waktu pembayaran Midtrans dan menunggu persetujuan admin.'
         END);
      v_rows_inserted := v_rows_inserted + 1;
      IF v_paid_order.order_id = p_order_id THEN
        v_current_created := true;
      END IF;
    END IF;
  END LOOP;

  SELECT * INTO v_current_ledger
  FROM public.license_partner_commission_ledger
  WHERE idempotency_key = 'license-partner:' || p_order_id::text;

  RETURN jsonb_build_object(
    'success', true,
    'commission_created', v_current_created,
    'already_recorded', v_current_ledger.id IS NOT NULL AND NOT v_current_created,
    'ledger_id', v_current_ledger.id,
    'commission_type', v_current_ledger.commission_type,
    'commission_rate', v_current_ledger.commission_rate,
    'amount', v_current_ledger.amount,
    'status', v_current_ledger.status,
    'first_paid_order_id', v_first_order.id,
    'reconciled_rows_inserted', v_rows_inserted,
    'reconciled_rows_updated', v_rows_updated,
    'manual_review_required', v_manual_review
  );
END;
$function$

