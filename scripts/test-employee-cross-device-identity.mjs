import fs from "node:fs";

const edge = fs.readFileSync("supabase/functions/employee-device-activation/index.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261124091800_fix_employee_cross_device_identity_history.sql",
  "utf8",
);

const checks = [
  [edge.includes('if (invite.status === "used")'), "recovery is limited to an already-used employee invite"],
  [edge.includes("canonicalActivation?.status !== \"paid\""), "recovery requires the canonical employee account's paid activation"],
  [edge.includes("verifiedRecoverySession = true"), "a verified code/name recovery is explicitly marked before membership restoration"],
  [edge.includes('admin.from("employee_invite_code_users")') && edge.includes("onConflict: \"invite_code_id,user_id\""), "recovered sessions are bound to the same verified invite"],
  [edge.includes('admin.from("business_members").upsert') && edge.includes('admin.from("kasusaha_device_activations").upsert'), "membership and paid account-device activation are restored for verified sessions"],
  [!edge.includes("kasusaha_employee_register_alias") && !edge.includes("kasusaha_employee_alias_matches"), "new invite recovery no longer depends on a legacy alias row that may not exist"],
  [(migration.match(/create or replace function private\.kasusaha_employee_identity_user_ids/g) || []).length === 1, "employee report identity resolver is replaced exactly once"],
  [(migration.match(/create or replace function private\.kasusaha_employee_same_identity_user/g) || []).length === 1, "employee RLS identity matcher is replaced exactly once"],
  [(migration.match(/public\.employee_invite_code_users current_binding/g) || []).length === 2, "both report and RLS identity resolution include verified invite bindings"],
  [(migration.match(/invite\.status = 'used'/g) || []).length === 2, "only already-used invites can join employee history"],
  [(migration.match(/canonical_binding\.user_id = invite\.user_id/g) || []).length === 2, "invite history must be anchored to the canonical account recorded on the invite"],
  [(migration.match(/security definer/g) || []).length === 2 && (migration.match(/set search_path = ''/g) || []).length === 2, "both private resolver functions retain a fixed search_path and definer boundary"],
  [migration.includes("revoke all on function private.kasusaha_employee_identity_user_ids(uuid) from public, anon") && migration.includes("revoke all on function private.kasusaha_employee_same_identity_user(uuid,uuid) from public, anon"), "private identity resolvers are not executable by anon or PUBLIC"],
  [migration.includes("grant execute on function private.kasusaha_employee_identity_user_ids(uuid) to authenticated, service_role") && migration.includes("grant execute on function private.kasusaha_employee_same_identity_user(uuid,uuid) to authenticated, service_role"), "only authenticated sessions and service role can execute the private identity resolvers"],

  [(migration.match(/canonical_activation\.status = 'paid'/g) || []).length === 2, "both history resolvers require the canonical account device activation to remain paid"],
];

for (const [ok, message] of checks) {
  if (!ok) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("PASS:", message);
  }
}
if (process.exitCode) process.exit(process.exitCode);
