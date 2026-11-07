-- Add an optional client-generated request ID to make unpaid cashier bill creation idempotent.
-- Legacy open bills remain valid with NULL client_request_id.
ALTER TABLE public.store_open_bills
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS store_open_bills_business_client_request_unique
  ON public.store_open_bills (business_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

GRANT SELECT (client_request_id) ON TABLE public.store_open_bills TO authenticated;
GRANT INSERT (client_request_id) ON TABLE public.store_open_bills TO authenticated;
