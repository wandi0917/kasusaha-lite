-- Reconcile license-partner commissions against the earliest provider-paid license order.
-- The webhook stores Midtrans settlement_time/transaction_time in marketplace_orders.paid_at.
-- Recalculate only unpaid ledger rows; never claw back a commission already marked paid.
CREATE OR REPLACE FUNCTION public.record_license_partner_commission(
  p_order_id uuid,
  p_payment_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
     OR v_order.status <> 'paid'
     OR v_order.paid_at IS NULL
     OR v_order.payment_provider <> 'midtrans'
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
    AND o.status = 'paid'
    AND o.paid_at IS NOT NULL
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
    AND user_id <> v_order.buyer_id;

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

  IF v_partner.status <> 'active' THEN
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
      AND o.status = 'paid'
      AND o.paid_at IS NOT NULL
      AND i.product_id IN (7, 8, 9, 10)
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
      v_rate := 0.1500;
      v_type := 'first_purchase';
    ELSE
      v_rate := 0.1000;
      v_type := 'renewal';
    END IF;

    v_amount := round(v_paid_order.calculation_base * v_rate, 0);
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
              THEN 'Rekonsiliasi: komisi pembelian lisensi pertama 15% berdasarkan waktu pembayaran Midtrans; menunggu persetujuan admin.'
              ELSE 'Rekonsiliasi: komisi pembelian ulang lisensi 10% berdasarkan waktu pembayaran Midtrans; menunggu persetujuan admin.'
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
           THEN 'Komisi pembelian lisensi pertama 15%; berdasarkan waktu pembayaran Midtrans dan menunggu persetujuan admin.'
           ELSE 'Komisi pembelian ulang lisensi 10%; berdasarkan waktu pembayaran Midtrans dan menunggu persetujuan admin.'
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
$function$;

REVOKE ALL ON FUNCTION public.record_license_partner_commission(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_license_partner_commission(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.record_license_partner_commission(uuid, uuid)
  IS 'Records and reconciles license-partner commissions using provider-paid timestamps; recalculates only held/approved rows and never automatically claws back paid commissions.';


-- Backfill historical paid_at values only from independently verified Midtrans
-- settlement/capture events. Manual CSV reconciliation events are excluded.
-- Midtrans timestamps without an offset are interpreted as Asia/Jakarta (GMT+7).
WITH provider_times AS (
  SELECT DISTINCT ON (e.order_id)
    e.order_id,
    COALESCE(
      NULLIF(e.payload #>> '{verified_status,settlement_time}', ''),
      NULLIF(e.payload #>> '{verified_status,transaction_time}', '')
    ) AS provider_time
  FROM public.marketplace_payment_events e
  JOIN public.marketplace_orders o ON o.id = e.order_id
  WHERE e.provider = 'midtrans'
    AND e.event_type IN ('settlement', 'capture')
    AND e.verification_status = 'verified'
    AND o.status = 'paid'
  ORDER BY e.order_id, e.processed_at DESC NULLS LAST, e.id DESC
),
parsed_provider_times AS (
  SELECT
    order_id,
    CASE
      WHEN provider_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$'
        THEN provider_time::timestamptz
      WHEN provider_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?$'
        THEN replace(provider_time, 'T', ' ')::timestamp AT TIME ZONE 'Asia/Jakarta'
      ELSE NULL
    END AS provider_paid_at
  FROM provider_times
  WHERE provider_time IS NOT NULL
)
UPDATE public.marketplace_orders o
SET paid_at = p.provider_paid_at,
    updated_at = now()
FROM parsed_provider_times p
WHERE o.id = p.order_id
  AND p.provider_paid_at IS NOT NULL
  AND o.paid_at IS DISTINCT FROM p.provider_paid_at;
