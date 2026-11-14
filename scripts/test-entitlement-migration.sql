\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

CREATE TABLE public.business_workspaces (id uuid PRIMARY KEY, owner_id uuid NOT NULL);
CREATE TABLE public.business_members (business_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, active boolean NOT NULL);
CREATE TABLE public.kasusaha_licenses (id uuid PRIMARY KEY, buyer_id uuid NOT NULL, order_id uuid NOT NULL, status text NOT NULL, product_name text NOT NULL, activated_at timestamptz, cloud_expires_at timestamptz, created_at timestamptz NOT NULL, plan_code text);
CREATE TABLE public.marketplace_orders (id uuid PRIMARY KEY, buyer_id uuid NOT NULL, status text NOT NULL, paid_at timestamptz, payment_review_required boolean);
CREATE TABLE public.marketplace_payment_events (order_id uuid NOT NULL, verification_status text NOT NULL, processed_at timestamptz);
CREATE TABLE public.kasusaha_license_plans (plan_code text PRIMARY KEY, features jsonb NOT NULL, active boolean NOT NULL);
CREATE TABLE private.kasusaha_free_trials (business_id uuid, owner_id uuid, plan_code text, started_at timestamptz, expires_at timestamptz);

CREATE FUNCTION private.kasusaha_employee_device_is_paid(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION private.kasusaha_business_license_is_verified(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

-- Minimal production-shaped function fixture: same authorization and paid-license predicates.
CREATE OR REPLACE FUNCTION private.kasusaha_business_has_feature(p_business_id uuid, p_feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select coalesce((
    select case
      when paid.license_id is not null then
        case
          when paid.plan_code is null or btrim(paid.plan_code) = '' then true
          else coalesce((paid_plan.features ->> p_feature)::boolean, false)
        end
      when trial.business_id is not null then
        coalesce(('{"barcode": true, "cashier": true, "employees": true, "attendance": true, "basic_stock": true, "marketplace": true, "full_finance": true, "sales_reports": true, "basic_products": true, "advanced_reports": true, "priority_support": true}'::jsonb ->> p_feature)::boolean, false)
      else false
    end
    from public.business_workspaces w
    join public.business_members m
      on m.business_id = w.id
     and m.user_id = (select auth.uid())
     and m.active = true
    left join lateral (
      select l.id as license_id, l.plan_code
      from public.kasusaha_licenses l
      join public.marketplace_orders o
        on o.id = l.order_id and o.buyer_id = l.buyer_id
      join public.marketplace_payment_events e
        on e.order_id = o.id
      where l.buyer_id = w.owner_id
        and l.status = 'active'
        and l.product_name = 'KasUsaha Lite'
        and l.activated_at is not null
        and (l.cloud_expires_at is null or l.cloud_expires_at > now())
        and o.status in ('paid', 'processing', 'completed')
        and o.paid_at is not null
        and o.payment_review_required is not true
        and e.verification_status = 'verified'
        and e.processed_at is not null
      order by l.activated_at desc nulls last, l.created_at desc
      limit 1
    ) paid on true
    left join public.kasusaha_license_plans paid_plan
      on paid_plan.plan_code = paid.plan_code and paid_plan.active = true
    left join private.kasusaha_free_trials trial
      on trial.business_id = w.id
     and trial.owner_id = w.owner_id
     and trial.plan_code = 'lite'
     and trial.started_at <= now()
     and trial.expires_at > now()
    left join public.kasusaha_license_plans lite_plan
      on lite_plan.plan_code = 'lite' and lite_plan.active = true
    where w.id = p_business_id
      and (select auth.uid()) is not null
      and (
        not coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false)
        or (m.role = 'employee' and private.kasusaha_employee_device_is_paid(w.id))
      )
      and private.kasusaha_business_license_is_verified(w.id)
    limit 1
  ), false);
$function$;

-- Fix typo in fixture identifier before migration: the table name is kasusaha_licenses.

INSERT INTO public.business_workspaces VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.business_members VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'owner', true);
INSERT INTO public.kasusaha_license_plans VALUES
  ('pro_hidden', '{"cashier": true, "advanced_reports": true}'::jsonb, false);
INSERT INTO public.marketplace_orders VALUES
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'paid', now(), false);
INSERT INTO public.marketplace_payment_events VALUES
  ('00000000-0000-0000-0000-000000000003', 'verified', now());
INSERT INTO public.kasusaha_licenses VALUES
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'active', 'KasUsaha Lite', now(), now() + interval '30 days', now(), 'pro_hidden');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SELECT set_config('request.jwt.claims', '{"is_anonymous": false}', false);
DO $test$
BEGIN
  IF private.kasusaha_business_has_feature('00000000-0000-0000-0000-000000000001', 'cashier') THEN
    RAISE EXCEPTION 'Regression fixture failed: hidden plan unexpectedly grants feature before migration';
  END IF;
END;
$test$;
