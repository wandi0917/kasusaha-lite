-- Make receivable/payable settlement idempotent across network retries.
-- Existing 3-argument public/private functions are retained but removed from client execution.
CREATE OR REPLACE FUNCTION private.settle_finance_open_item(
  p_item_id uuid,
  p_amount numeric,
  p_date date,
  p_request_id uuid
)
RETURNS jsonb
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
  v_source_type text;
  v_source_id text;
  v_existing_date date;
  v_existing_status text;
  v_existing_created_by uuid;
  v_existing_debit numeric(18,2);
  v_existing_credit numeric(18,2);
  v_existing_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login diperlukan.'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'ID permintaan pelunasan tidak valid.'; END IF;
  IF p_date IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Tanggal dan nominal pelunasan harus valid.';
  END IF;

  SELECT * INTO v_item
  FROM public.finance_open_items
  WHERE id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tagihan tidak ditemukan.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id = v_item.business_id
      AND m.user_id = auth.uid()
      AND m.active
      AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Hanya Owner yang dapat mencatat pelunasan.';
  END IF;
  IF NOT private.kasusaha_business_license_is_verified(v_item.business_id) THEN
    RAISE EXCEPTION 'Lisensi usaha belum terverifikasi.';
  END IF;
  IF private.kasusaha_business_has_feature(v_item.business_id,'full_finance') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Pengelolaan piutang dan utang tersedia mulai paket Lite.';
  END IF;

  v_source_type := CASE WHEN v_item.direction='receivable' THEN 'receipt' ELSE 'payment' END;
  v_source_id := 'settle-' || v_item.id::text || '-' || p_request_id::text;

  -- A successful earlier request is replayed before checking the item's new status.
  SELECT e.id,e.entry_date,e.status,e.created_by
    INTO v_entry_id,v_existing_date,v_existing_status,v_existing_created_by
  FROM public.finance_journal_entries e
  WHERE e.business_id=v_item.business_id
    AND e.source_type=v_source_type
    AND e.source_id=v_source_id;

  IF FOUND THEN
    SELECT coalesce(sum(l.debit),0),coalesce(sum(l.credit),0),count(*)
      INTO v_existing_debit,v_existing_credit,v_existing_count
    FROM public.finance_journal_lines l
    WHERE l.business_id=v_item.business_id AND l.entry_id=v_entry_id;

    IF v_existing_date IS DISTINCT FROM p_date
       OR v_existing_status IS DISTINCT FROM 'posted'
       OR v_existing_created_by IS DISTINCT FROM auth.uid()
       OR v_existing_debit IS DISTINCT FROM p_amount
       OR v_existing_credit IS DISTINCT FROM p_amount
       OR v_existing_count <> 2 THEN
      RAISE EXCEPTION 'ID permintaan pelunasan sudah digunakan untuk rincian berbeda. Periksa jurnal sebelum melanjutkan.';
    END IF;

    RETURN jsonb_build_object(
      'ok',true,'replayed',true,'item_id',v_item.id,
      'journal_entry_id',v_entry_id,'amount',p_amount,
      'settled_amount',v_item.settled_amount,'status',v_item.status
    );
  END IF;

  IF v_item.status NOT IN ('open','partial') THEN
    RAISE EXCEPTION 'Tagihan tidak berstatus terbuka.';
  END IF;
  v_remaining := v_item.total_amount-v_item.settled_amount;
  IF p_amount > v_remaining THEN
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

  v_number := 'PAY-' || substr(replace(gen_random_uuid()::text,'-',''),1,20);
  INSERT INTO public.finance_journal_entries
    (business_id,entry_number,entry_date,description,source_type,source_id,status,created_by,posted_at)
  VALUES
    (v_item.business_id,v_number,p_date,
     CASE WHEN v_item.direction='receivable' THEN 'Penerimaan piutang ' ELSE 'Pembayaran utang ' END||v_item.document_number,
     v_source_type,v_source_id,'posted',auth.uid(),now())
  RETURNING id INTO v_entry_id;

  INSERT INTO public.finance_journal_lines
    (business_id,entry_id,account_id,party_id,description,debit,credit)
  VALUES
    (v_item.business_id,v_entry_id,v_debit_id,v_item.party_id,'Pembayaran tagihan '||v_item.document_number,p_amount,0),
    (v_item.business_id,v_entry_id,v_credit_id,v_item.party_id,'Pembayaran tagihan '||v_item.document_number,0,p_amount);

  v_new_settled := v_item.settled_amount+p_amount;
  UPDATE public.finance_open_items
  SET settled_amount=v_new_settled,
      status=CASE WHEN v_new_settled>=total_amount THEN 'settled' ELSE 'partial' END,
      updated_at=now()
  WHERE id=v_item.id;

  RETURN jsonb_build_object(
    'ok',true,'replayed',false,'item_id',v_item.id,
    'journal_entry_id',v_entry_id,'amount',p_amount,
    'settled_amount',v_new_settled,
    'status',CASE WHEN v_new_settled>=v_item.total_amount THEN 'settled' ELSE 'partial' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_finance_open_item(
  p_item_id uuid,
  p_amount numeric,
  p_date date,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT private.settle_finance_open_item(p_item_id,p_amount,p_date,p_request_id);
$function$;

REVOKE ALL ON FUNCTION public.settle_finance_open_item(uuid,numeric,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.settle_finance_open_item(uuid,numeric,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_finance_open_item(uuid,numeric,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.settle_finance_open_item(uuid,numeric,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_finance_open_item(uuid,numeric,date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.settle_finance_open_item(uuid,numeric,date,uuid) TO authenticated;
