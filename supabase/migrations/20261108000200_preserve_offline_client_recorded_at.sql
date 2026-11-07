-- Preserve the original device time of offline finance entries without allowing clients
-- to write the authoritative server timestamps used for service-fee calculations.
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS client_recorded_at timestamptz;

GRANT INSERT (client_recorded_at) ON TABLE public.financial_transactions TO authenticated;
GRANT SELECT (client_recorded_at) ON TABLE public.financial_transactions TO authenticated;
REVOKE UPDATE (client_recorded_at) ON TABLE public.financial_transactions FROM authenticated;

COMMENT ON COLUMN public.financial_transactions.client_recorded_at IS
  'Untrusted original device timestamp for offline-import display only. Never use for billing, audit ordering, or service-fee calculations; server_recorded_at remains authoritative.';
