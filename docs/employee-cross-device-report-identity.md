# Employee cross-device identity and report history

## Audit finding

The paid employee invite claim records the canonical user and its invite binding in `employee_invite_code_users`. The recovery path for a used invite additionally required a matching row in the legacy `employee_identity_aliases` table. That legacy row is not guaranteed to exist for accounts created by the current invite-claim flow.

When it is absent, a new anonymous session can pass the used-invite and paid-activation checks but then be rejected while trying to register a legacy alias. Report and attendance history can also remain split between accounts even though they share the same verified invite.

## Repair

- Treat the already-used invite, exact registered employee name, and still-paid canonical account activation as the recovery proof.
- Bind the recovered session to the same `invite_code_id` only after those checks pass.
- Resolve report identity and the RLS identity predicate from the invite's verified canonical account and all server-recorded bindings, while retaining existing legacy aliases.
- Keep the private SQL functions behind `SECURITY DEFINER`, an empty `search_path`, and authenticated/service-role-only execution.

## Safety

The repair does not merge employees by display name, does not read or expose invite codes, and does not grant client access to `employee_invite_code_users`. It does not modify financial transaction rows. The additive migration was applied successfully to Supabase Production as remote version `20261124093623` (`fix_employee_cross_device_identity_history_20261124`). Edge Function `employee-device-activation` was deployed as version 51 with JWT verification still enabled. The migration added/replaced only private resolver functions and did not backfill, delete, or update transaction data. Full historical migration baseline reconciliation remains outstanding; do not use `supabase db push` or reset.
