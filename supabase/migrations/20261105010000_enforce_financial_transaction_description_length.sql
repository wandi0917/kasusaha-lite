-- Align source transaction validation with the journal description constraint.
-- Existing records were audited: all current descriptions are 5-135 characters.
begin;

alter table public.financial_transactions
  add constraint financial_transactions_description_min2_check
  check (
    length(btrim(description)) >= 2
    and length(btrim(description)) <= 300
  ) not valid;

alter table public.financial_transactions
  validate constraint financial_transactions_description_min2_check;

alter table public.financial_transactions
  drop constraint financial_transactions_description_check;

commit;
