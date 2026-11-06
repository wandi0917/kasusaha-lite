# Production security advisor review — 6 November 2026

Project: `flvdudmdltjjdjkdngbv` (KasUsaha-Lite, ap-southeast-1)  
Repository: `wandi0917/kasusaha-lite`  
Scope: read-only Supabase Production inspection; no customer data modified.

## Executive result

The Security Advisor currently reports:
- 15 `SECURITY DEFINER` functions executable by `authenticated`.
- 20 tables with RLS enabled and no policies.
- Anonymous sign-ins enabled.
- Leaked-password protection disabled.

The findings were checked against live grants and function definitions before any change. They are not all defects, and blanket revocation would break core Owner/Employee workflows.

## 1. SECURITY DEFINER functions — reviewed, intentionally callable by authenticated users

A read-only query confirmed for all 15 functions:
- `anon` does not have EXECUTE.
- `authenticated` does have EXECUTE.
- Function definitions contain an `auth.uid()` identity check.
- Function configuration fixes `search_path` to an empty path.
- Function bodies apply membership, role, verified-license, paid-employee-device, or invite-code checks appropriate to the operation.

Functions:
1. `create_business_workspace_details(text,text,text,text,text)`
2. `create_kasusaha_package_order(text,text,text,text)`
3. `edit_business_attendance_record(uuid,uuid,timestamptz,timestamptz)`
4. `get_store_product_costs(uuid)`
5. `join_business_workspace(text)`
6. `kasusaha_accept_service_fee_terms(uuid)`
7. `kasusaha_get_business_package_entitlements(uuid)`
8. `kasusaha_owner_employee_directory(uuid)`
9. `kasusaha_owner_service_fee_preview(uuid,date)`
10. `record_business_attendance_check_in(uuid)`
11. `record_business_attendance_check_out(uuid)`
12. `record_store_quick_sale(uuid,text,jsonb,uuid)`
13. `set_business_attendance_hourly_wage(uuid,uuid,uuid,numeric)`
14. `set_store_product_cost(uuid,numeric)`
15. `settle_store_open_bill(uuid,numeric)`

These are application RPCs used by logged-in accounts. Some intentionally permit the restricted anonymous Employee session used by the paid employee-device flow; the database functions then enforce active Employee membership, paid device activation, and verified license/feature entitlements. Do not revoke EXECUTE globally or change these functions to SECURITY INVOKER without a full migration of their private-schema access model and end-to-end regression tests.

## 2. RLS enabled with no policy — reviewed as server-only tables

The live grants query showed no `anon` or `authenticated` table grants on the 20 flagged tables. Access is limited to the database owner and/or `service_role`. RLS therefore remains fail-closed; adding broad policies would increase exposure rather than improve security.

Tables:
- `private.business_attendance_rates`
- `private.employee_identities`
- `private.employee_identity_aliases`
- `private.kasusaha_service_fee_monthly`
- `private.store_quick_sale_requests`
- `public.biteship_shipping_quotes`
- `public.employee_invite_code_users`
- `public.employee_invite_codes`
- `public.kasusaha_business_members`
- `public.kasusaha_device_activations`
- `public.kasusaha_license_plans`
- `public.kasusaha_transactions`
- `public.license_customer_attributions`
- `public.license_marketing_partners`
- `public.license_order_referrals`
- `public.license_partner_commission_ledger`
- `public.marketplace_commission_ledger`
- `public.marketplace_payment_events`
- `public.marketplace_payout_ledger`
- `public.platform_admins`

Keep these tables server-only. If a future frontend feature needs data from them, expose a narrowly scoped RPC or Edge Function with explicit ownership checks rather than granting direct table access.

## 3. Anonymous sign-ins

Anonymous sign-ins are enabled. This is currently an intentional dependency of the paid Employee invite/device session flow. The frontend and database restrict this session to the permitted Employee cashier/attendance paths and require a paid device activation plus verified business license.

Do not disable anonymous sign-ins until the Employee login flow is migrated to a non-anonymous authentication design and verified on real devices. Recheck the full Employee login, cashier, attendance, and logout lifecycle after any future change.

## 4. Manual Auth hardening still required

The Security Advisor reports leaked-password protection is disabled. Enable it in Supabase Dashboard:
- Authentication → Settings (or Security and Protection, depending on current Dashboard layout)
- Enable leaked password protection / compromised-password checks
- Save and verify the setting is active.

This setting was not changed by this audit because the available project connection does not expose the Auth setting mutation. Do not ask users to share passwords or tokens.

## 5. Performance advisor

The Performance Advisor currently reports 28 unused indexes. These are informational. Several relate to newer finance/referral tables with little or no production traffic. Do not drop them solely because they are currently unused; collect workload evidence after real usage and remove only with a reviewed migration and query-plan comparison.

## 6. Health advisor

No health-advisor findings were returned in this inspection.

## 7. Actions deliberately not taken

- No blanket function EXECUTE revocation.
- No SECURITY INVOKER conversion.
- No RLS policy added to service-only tables.
- No anonymous-auth setting change.
- No index dropped.
- No production data, license, payment, commission, or payout rows changed.
- No database migration applied.

## 8. Verification queries

Use these read-only checks after future changes:

```sql
-- SECURITY DEFINER functions exposed to authenticated/anon
select p.oid::regprocedure as function_signature,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by 1;

-- RLS-enabled tables without policies and any client grants
select c.relname,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = n.nspname and p.tablename = c.relname
  )
order by c.relname;
```

## References

- [Supabase Advisors — checks and remediation guidance](https://supabase.com/docs/guides/observability/advisors)
- [Supabase API security and RLS](https://supabase.com/docs/guides/api/securing-your-api)

This report records the findings and safe disposition. It is not a substitute for authenticated negative tests using separate Owner, Employee, buyer, seller, and unauthorized test accounts.
