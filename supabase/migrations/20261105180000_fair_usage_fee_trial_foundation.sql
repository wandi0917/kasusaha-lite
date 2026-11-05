-- Additive, opt-in foundation for KasUsaha Lite's fair usage-fee model.
-- This migration does NOT change current cashier/license gates, issue invoices,
-- charge merchants, or modify historical transactions.
ALTER TABLE public.business_workspaces
  ADD COLUMN IF NOT EXISTS service_fee_trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_fee_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_fee_terms_version text;

CREATE TABLE IF NOT EXISTS private.kasusaha_service_fee_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_workspaces(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  sales_net numeric(18,2) NOT NULL DEFAULT 0 CHECK (sales_net >= 0),
  free_threshold numeric(18,2) NOT NULL DEFAULT 3000000 CHECK (free_threshold >= 0),
  billable_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (billable_amount >= 0),
  fee_rate numeric(8,6) NOT NULL DEFAULT 0.001 CHECK (fee_rate >= 0 AND fee_rate <= 1),
  fee_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview','issued','paid','void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, period_start),
  CHECK (period_end >= period_start)
);

ALTER TABLE private.kasusaha_service_fee_monthly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.kasusaha_service_fee_monthly FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.business_workspaces FROM anon;

CREATE OR REPLACE FUNCTION public.kasusaha_accept_service_fee_terms(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_workspace public.business_workspaces%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR coalesce(((auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Login Owner diperlukan untuk menyetujui ketentuan biaya layanan.';
  END IF;

  SELECT w.* INTO v_workspace
  FROM public.business_workspaces w
  JOIN public.business_members m ON m.business_id = w.id
  WHERE w.id = p_business_id
    AND w.owner_id = v_uid
    AND m.user_id = v_uid
    AND m.role = 'owner'
    AND m.active = true
  FOR UPDATE OF w;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hanya Owner usaha yang sah yang dapat menyetujui ketentuan.';
  END IF;

  IF v_workspace.service_fee_consent_at IS NULL THEN
    UPDATE public.business_workspaces
    SET service_fee_consent_at = now(),
        service_fee_trial_started_at = now(),
        service_fee_terms_version = '2026-11-v1'
    WHERE id = p_business_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'trial_started_at', coalesce(v_workspace.service_fee_trial_started_at, now()),
    'trial_days', 30,
    'terms_version', '2026-11-v1',
    'fee_enabled', false,
    'message', 'Persetujuan tercatat. Perhitungan hanya pratinjau; penagihan belum diaktifkan.'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.kasusaha_owner_service_fee_preview(
  p_business_id uuid,
  p_month date DEFAULT (date_trunc('month', timezone('Asia/Jakarta', now())))::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_workspace public.business_workspaces%ROWTYPE;
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
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

  SELECT coalesce(sum(t.amount),0)
  INTO v_sales
  FROM public.financial_transactions t
  WHERE t.business_id = p_business_id
    AND t.transaction_type = 'income'
    AND lower(trim(t.category)) = 'penjualan'
    AND t.transaction_date BETWEEN v_start AND v_end;

  SELECT coalesce(sum(t.amount),0)
  INTO v_returns
  FROM public.financial_transactions t
  WHERE t.business_id = p_business_id
    AND t.transaction_type = 'expense'
    AND lower(trim(t.category)) IN ('retur penjualan','pengembalian penjualan')
    AND t.transaction_date BETWEEN v_start AND v_end;

  v_net := greatest(0, v_sales - v_returns);
  v_trial_ends := v_workspace.service_fee_trial_started_at + interval '30 days';
  v_eligible := v_workspace.service_fee_consent_at IS NOT NULL
    AND v_workspace.service_fee_trial_started_at IS NOT NULL
    AND (v_end::timestamp AT TIME ZONE 'Asia/Jakarta') >= v_trial_ends;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'period_start', v_start,
    'period_end', v_end,
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
    'warning', 'Pratinjau saja. Penjualan manual dan retur yang tidak dicatat dengan kategori retur belum dapat direkonsiliasi otomatis.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_accept_service_fee_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kasusaha_accept_service_fee_terms(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.kasusaha_owner_service_fee_preview(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kasusaha_owner_service_fee_preview(uuid,date) TO authenticated;

COMMENT ON TABLE private.kasusaha_service_fee_monthly IS
  'Monthly service fee ledger foundation; no automatic invoice or collection enabled.';
