-- KasUsaha: grant every existing application feature during the one-time 31-day trial.
-- Paid plan feature flags and existing business data are unchanged.
-- Employee-ID activation remains separately enforced as a device/account add-on.
do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
  v_features constant jsonb := jsonb_build_object(
    'barcode', true, 'cashier', true, 'employees', true, 'attendance', true,
    'basic_stock', true, 'marketplace', true, 'full_finance', true,
    'sales_reports', true, 'basic_products', true, 'advanced_reports', true,
    'priority_support', true
  );
begin
  v_def := pg_get_functiondef('private.kasusaha_business_has_feature(uuid,text)'::regprocedure);
  v_old := 'coalesce((lite_plan.features ->> p_feature)::boolean, false)';
  v_new := 'coalesce((' || quote_literal(v_features::text) || '::jsonb ->> p_feature)::boolean, false)';
  if position(v_old in v_def) = 0 then raise exception 'Trial feature branch not found; no changes applied.'; end if;
  execute replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef('public.kasusaha_get_business_package_entitlements(uuid)'::regprocedure);
  v_old := 'else coalesce(lite_plan.features, ''{}''::jsonb)';
  v_new := 'else ' || quote_literal(v_features::text) || '::jsonb';
  if position(v_old in v_def) = 0 then raise exception 'Trial entitlement branch not found; no changes applied.'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, 'Lite (Uji Coba Gratis 31 Hari)', 'Semua Fitur (Uji Coba Gratis 31 Hari)');
  execute v_def;
end;
$migration$;

comment on function public.kasusaha_get_business_package_entitlements(uuid) is
  'Returns verified paid-package entitlements, or all in-app feature flags during the one-time 31-day trial. Employee-ID activation remains separately enforced.';
