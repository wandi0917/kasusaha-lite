-- Restore only the column-level writes required by the cashier open-bill UI.
-- RLS policies continue to enforce active membership, role, license and cashier entitlement.
-- Do not grant table-wide INSERT/UPDATE: paid fields and ownership fields remain immutable to clients.

GRANT INSERT (
  business_id,
  created_by,
  created_by_role,
  table_number,
  customer_name,
  lines,
  total_amount,
  client_request_id
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
