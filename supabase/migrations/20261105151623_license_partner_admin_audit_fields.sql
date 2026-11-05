alter table public.license_marketing_partners
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references auth.users(id) on delete set null;

alter table public.license_partner_commission_ledger
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists paid_by uuid references auth.users(id) on delete set null;

comment on column public.license_marketing_partners.approved_by is
  'Platform Owner user who approved this partner.';
comment on column public.license_marketing_partners.suspended_by is
  'Platform Owner user who last suspended this partner.';
comment on column public.license_partner_commission_ledger.reviewed_by is
  'Platform Owner user who approved this commission.';
comment on column public.license_partner_commission_ledger.paid_by is
  'Platform Owner user who recorded the manual transfer.';
