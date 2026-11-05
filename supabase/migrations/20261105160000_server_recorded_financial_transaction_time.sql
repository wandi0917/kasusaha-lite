-- Server-authoritative timestamp for service-fee accounting.
-- Additive only: preserves existing created_at, transaction_date and transaction rows.

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS server_recorded_at timestamptz;

-- Existing rows predate this safeguard. Stamp them at migration time rather than
-- copying created_at, because created_at may contain a client-supplied offline
-- timestamp (including a future value). No business has accepted service-fee
-- terms yet, so these rows must remain outside any future trial-completion window.
UPDATE public.financial_transactions
SET server_recorded_at = transaction_timestamp()
WHERE server_recorded_at IS NULL;

ALTER TABLE public.financial_transactions
  ALTER COLUMN server_recorded_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN server_recorded_at SET NOT NULL;

COMMENT ON COLUMN public.financial_transactions.server_recorded_at IS
  'Server-authoritative insert timestamp. Immutable on updates; used for service-fee period attribution. Offline records are attributed to the month the server receives them.';

CREATE OR REPLACE FUNCTION private.stamp_financial_transaction_server_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.server_recorded_at := clock_timestamp();
  ELSE
    NEW.server_recorded_at := OLD.server_recorded_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.stamp_financial_transaction_server_time()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS financial_transactions_server_recorded_at
  ON public.financial_transactions;

CREATE TRIGGER financial_transactions_server_recorded_at
BEFORE INSERT OR UPDATE ON public.financial_transactions
FOR EACH ROW
EXECUTE FUNCTION private.stamp_financial_transaction_server_time();

CREATE INDEX IF NOT EXISTS financial_transactions_fee_recorded_idx
  ON public.financial_transactions (business_id, server_recorded_at)
  INCLUDE (transaction_type, category, amount);

CREATE OR REPLACE FUNCTION public.kasusaha_owner_service_fee_preview(
  p_business_id uuid,
  p_month date DEFAULT (date_trunc('month'::text, timezone('Asia/Jakarta'::text, now())))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_workspace public.business_workspaces%ROWTYPE;
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_month_start timestamptz := (date_trunc('month', p_month)::timestamp AT TIME ZONE 'Asia/Jakarta');
  v_month_end_exclusive timestamptz := ((date_trunc('month', p_month) + interval '1 month')::timestamp AT TIME ZONE 'Asia/Jakarta');
  v_sales numeric(18,2) := 0;
  v_returns numeric(18,2) := 0;
  v_net numeric(18,2) := 0;
  v_trial_ends timestamptz;
  v_eligible boolean := false;
BEGIN
  IF v_uid IS NULL OR coalesce(((auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Login Owner diperlukan.';
  END IF;

  SELECT w.* INTO v_workspace
  FROM public.business_workspaces w
  JOIN public.business_members m ON m.business_id = w.id
  WHERE w.id = p_business_id
    AND w.owner_id = v_uid
    AND m.user_id = v_uid
    AND m.role = 'owner'
    AND m.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laporan biaya hanya dapat dilihat Owner usaha.';
  END IF;

  v_trial_ends := v_workspace.service_fee_trial_started_at + interval '30 days';

  -- The fee period follows the immutable server receipt time, not a timestamp
  -- supplied by a browser/device. Offline records are therefore attributed to
  -- the month in which the server first receives them.
  SELECT coalesce(sum(t.amount),0)
  INTO v_sales
  FROM public.financial_transactions t
  WHERE t.business_id = p_business_id
    AND t.transaction_type = 'income'
    AND lower(trim(t.category)) = 'penjualan'
    AND v_trial_ends IS NOT NULL
    AND t.server_recorded_at >= greatest(v_month_start, v_trial_ends)
    AND t.server_recorded_at < v_month_end_exclusive;

  SELECT coalesce(sum(t.amount),0)
  INTO v_returns
  FROM public.financial_transactions t
  WHERE t.business_id = p_business_id
    AND t.transaction_type = 'expense'
    AND lower(trim(t.category)) IN ('retur penjualan','pengembalian penjualan')
    AND v_trial_ends IS NOT NULL
    AND t.server_recorded_at >= greatest(v_month_start, v_trial_ends)
    AND t.server_recorded_at < v_month_end_exclusive;

  v_net := greatest(0, v_sales - v_returns);
  v_eligible := v_workspace.service_fee_consent_at IS NOT NULL
    AND v_workspace.service_fee_trial_started_at IS NOT NULL
    AND v_trial_ends < v_month_end_exclusive
    AND v_trial_ends < now();

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'period_start', v_start,
    'period_end', v_end,
    'billing_time_basis', 'server_recorded_at',
    'offline_attribution', 'month_received_by_server',
    'gross_recorded_sales', v_sales,
    'recognized_returns', v_returns,
    'net_sales_for_preview', v_net,
    'free_threshold', 3000000,
    'billable_amount', greatest(0, v_net - 3000000),
    'fee_rate', 0.001,
    'estimated_fee', CASE WHEN v_eligible THEN round(greatest(0, v_net - 3000000) * 0.001, 0) ELSE 0 END,
    'trial_started_at', v_workspace.service_fee_trial_started_at,
    'trial_ends_at', v_trial_ends,
    'terms_version', v_workspace.service_fee_terms_version,
    'consent_recorded', v_workspace.service_fee_consent_at IS NOT NULL,
    'trial_completed_for_period', v_eligible,
    'billing_enabled', false,
    'warning', 'Pratinjau saja, bukan tagihan. Dasar periode memakai waktu penerimaan server yang tidak dapat diubah pengguna. Transaksi offline dialokasikan ke bulan saat sinkronisasi diterima server. Retur belum ditautkan ke penjualan asal dan koreksi manual belum memiliki audit trail penuh; jangan gunakan hasil ini untuk menagih sebelum rekonsiliasi dan persetujuan alur retur selesai.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_owner_service_fee_preview(uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kasusaha_owner_service_fee_preview(uuid, date)
  TO authenticated;
