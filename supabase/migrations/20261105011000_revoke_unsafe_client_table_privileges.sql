-- Remove client-side table maintenance and truncate capabilities.
-- Row-level security does not protect TRUNCATE; application clients do not need
-- TRUNCATE, REFERENCES, TRIGGER, or MAINTAIN privileges.
begin;

revoke truncate, references, trigger, maintain
  on all tables in schema public
  from anon, authenticated;

revoke all privileges
  on table public.store_open_bills
  from anon;

-- Open bills are read through member-scoped RLS and changed through the
-- protected write path; there is no client DELETE policy for this table.
revoke delete
  on table public.store_open_bills
  from authenticated;

-- Keep the same least-privilege boundary for future tables created by the migration owner. Ordinary row-level privileges remain unchanged.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- New public functions must receive explicit EXECUTE grants in their migration.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

commit;
