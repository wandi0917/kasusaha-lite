-- Marketplace public listing eligibility must recognize the active 31-day trial.
-- Keep the paid-license entitlement predicate unchanged; add the shared server-side
-- verified-license helper, which returns true for paid licenses or active trials.
do $migration$
declare
  v_def text;
  v_old text := E'AND coalesce((\n        SELECT CASE';
  v_new text := E'AND (private.kasusaha_business_license_is_verified(w.id) IS TRUE OR coalesce((\n        SELECT CASE';
  v_close text := '), false) IS TRUE';
  v_pos integer;
begin
  v_def := pg_get_functiondef('public.kasusaha_marketplace_product_is_public(bigint)'::regprocedure);
  if position(v_old in v_def)=0 then
    raise exception 'Expected marketplace paid-license predicate not found; migration stopped safely.';
  end if;
  if position(v_new in v_def)>0 then
    raise notice 'Marketplace trial eligibility already applied.';
    return;
  end if;
  v_def := replace(v_def,v_old,v_new);
  v_pos := strpos(v_def,v_close);
  if v_pos=0 then raise exception 'Expected marketplace entitlement predicate terminator not found.'; end if;
  v_def := overlay(v_def placing '), false) IS TRUE)' from v_pos for length(v_close));
  execute v_def;
end;
$migration$;

comment on function public.kasusaha_marketplace_product_is_public(bigint) is
  'Public marketplace product eligibility: active paid license with marketplace entitlement, or the active 31-day all-feature trial.';
