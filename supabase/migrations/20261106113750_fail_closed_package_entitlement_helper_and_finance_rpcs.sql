-- Fail closed when package entitlement lookup has no matching row.
-- Legacy licenses with an empty plan_code remain grandfathered as before.
CREATE OR REPLACE FUNCTION private.kasusaha_business_has_feature(
  p_business_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT coalesce((
    SELECT CASE
      WHEN l.plan_code IS NULL OR btrim(l.plan_code) = '' THEN true
      ELSE coalesce((p.features ->> p_feature)::boolean, false)
    END
    FROM public.business_workspaces w
    JOIN public.business_members m
      ON m.business_id = w.id
     AND m.user_id = (SELECT auth.uid())
     AND m.active = true
    JOIN public.kasusaha_licenses l
      ON l.buyer_id = w.owner_id
     AND l.status = 'active'
     AND l.product_name = 'KasUsaha Lite'
    LEFT JOIN public.kasusaha_license_plans p
      ON p.plan_code = l.plan_code
     AND p.active = true
    WHERE w.id = p_business_id
      AND (SELECT auth.uid()) IS NOT NULL
      AND (
        NOT coalesce((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
        OR (m.role = 'employee' AND private.kasusaha_employee_device_is_paid(w.id))
      )
      AND private.kasusaha_business_license_is_verified(w.id)
    ORDER BY l.activated_at DESC NULLS LAST, l.created_at DESC
    LIMIT 1
  ), false);
$function$;

-- Two finance RPCs previously treated a missing entitlement result as allowed.
CREATE OR REPLACE FUNCTION private.post_finance_journal_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
  v_status text;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login diperlukan.'; END IF;
  SELECT e.business_id,e.status INTO v_business_id,v_status
  FROM public.finance_journal_entries e WHERE e.id=p_entry_id;
  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Jurnal tidak ditemukan.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id=v_business_id AND m.user_id=auth.uid() AND m.active AND m.role='owner'
  ) THEN RAISE EXCEPTION 'Hanya Owner yang dapat mem-posting jurnal.'; END IF;
  IF NOT private.kasusaha_business_license_is_verified(v_business_id) THEN
    RAISE EXCEPTION 'Lisensi usaha belum terverifikasi.';
  END IF;
  IF private.kasusaha_business_has_feature(v_business_id,'full_finance') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Jurnal keuangan lengkap tersedia mulai paket Lite.';
  END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Hanya jurnal draft yang dapat diposting.'; END IF;
  SELECT coalesce(sum(l.debit),0),coalesce(sum(l.credit),0),count(*)
    INTO v_debit,v_credit,v_count
  FROM public.finance_journal_lines l
  WHERE l.entry_id=p_entry_id AND l.business_id=v_business_id;
  IF v_count < 2 OR v_debit <= 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'Jurnal tidak seimbang. Total debit harus sama dengan kredit dan minimal dua baris.';
  END IF;
  UPDATE public.finance_journal_entries
  SET status='posted',posted_at=now()
  WHERE id=p_entry_id AND business_id=v_business_id AND status='draft';
END;
$function$;

CREATE OR REPLACE FUNCTION private.settle_finance_open_item(
  p_item_id uuid,
  p_amount numeric,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_item public.finance_open_items%rowtype;
  v_debit_id uuid;
  v_credit_id uuid;
  v_entry_id uuid;
  v_number text;
  v_remaining numeric(18,2);
  v_new_settled numeric(18,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login diperlukan.'; END IF;
  SELECT * INTO v_item FROM public.finance_open_items WHERE id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tagihan tidak ditemukan.'; END IF;
  IF v_item.status NOT IN ('open','partial') THEN RAISE EXCEPTION 'Tagihan tidak berstatus terbuka.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id=v_item.business_id AND m.user_id=auth.uid() AND m.active AND m.role='owner'
  ) THEN RAISE EXCEPTION 'Hanya Owner yang dapat mencatat pelunasan.'; END IF;
  IF NOT private.kasusaha_business_license_is_verified(v_item.business_id) THEN
    RAISE EXCEPTION 'Lisensi usaha belum terverifikasi.';
  END IF;
  IF private.kasusaha_business_has_feature(v_item.business_id,'full_finance') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Pengelolaan piutang dan utang tersedia mulai paket Lite.';
  END IF;
  v_remaining:=v_item.total_amount-v_item.settled_amount;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>v_remaining THEN
    RAISE EXCEPTION 'Nominal pembayaran melebihi sisa tagihan atau tidak valid.';
  END IF;
  SELECT id INTO v_debit_id FROM public.finance_accounts
  WHERE business_id=v_item.business_id
    AND account_code=CASE WHEN v_item.direction='receivable' THEN '1001' ELSE '2001' END;
  SELECT id INTO v_credit_id FROM public.finance_accounts
  WHERE business_id=v_item.business_id
    AND account_code=CASE WHEN v_item.direction='receivable' THEN '1101' ELSE '1001' END;
  IF v_debit_id IS NULL OR v_credit_id IS NULL THEN
    RAISE EXCEPTION 'Akun kas/piutang/utang belum tersedia.';
  END IF;
  v_number:='PAY-'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  INSERT INTO public.finance_journal_entries
    (business_id,entry_number,entry_date,description,source_type,source_id,status,created_by,posted_at)
  VALUES
    (v_item.business_id,v_number,p_date,
     CASE WHEN v_item.direction='receivable' THEN 'Penerimaan piutang ' ELSE 'Pembayaran utang ' END||v_item.document_number,
     CASE WHEN v_item.direction='receivable' THEN 'receipt' ELSE 'payment' END,
     'settle-'||v_item.id::text||'-'||gen_random_uuid()::text,'posted',auth.uid(),now())
  RETURNING id INTO v_entry_id;
  INSERT INTO public.finance_journal_lines
    (business_id,entry_id,account_id,party_id,description,debit,credit)
  VALUES
    (v_item.business_id,v_entry_id,v_debit_id,v_item.party_id,'Pembayaran tagihan '||v_item.document_number,p_amount,0),
    (v_item.business_id,v_entry_id,v_credit_id,v_item.party_id,'Pembayaran tagihan '||v_item.document_number,0,p_amount);
  v_new_settled:=v_item.settled_amount+p_amount;
  UPDATE public.finance_open_items
  SET settled_amount=v_new_settled,
      status=CASE WHEN v_new_settled>=total_amount THEN 'settled' ELSE 'partial' END,
      updated_at=now()
  WHERE id=v_item.id;
END;
$function$;
