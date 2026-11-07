-- Restore the narrowly scoped write privileges required by the open-bill UI.
-- RLS remains the authorization boundary; no payment/settlement columns are writable.
BEGIN;

GRANT INSERT (
  business_id,
  created_by,
  created_by_role,
  table_number,
  customer_name,
  lines,
  total_amount
) ON TABLE public.store_open_bills TO authenticated;

GRANT UPDATE (
  table_number,
  customer_name,
  lines,
  total_amount,
  updated_at,
  version,
  status
) ON TABLE public.store_open_bills TO authenticated;

-- Keep settlement fields server-controlled through settle_store_open_bill().
REVOKE UPDATE (
  payment_cash,
  change_amount,
  paid_at,
  paid_by,
  sale_request_id
) ON TABLE public.store_open_bills FROM authenticated;

COMMIT;
