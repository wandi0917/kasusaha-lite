-- Make Owner customer/supplier creation safe to retry after uncertain network responses.
-- Existing finance parties remain unchanged; NULL request IDs preserve legacy rows.
ALTER TABLE public.finance_parties
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS finance_parties_business_request_id_key
  ON public.finance_parties (business_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
