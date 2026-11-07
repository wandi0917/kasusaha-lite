-- Preserve both customer and table attribution when settling an open cashier bill.
-- This is a function-only change: no existing transactions, stock, or balances are modified.
CREATE OR REPLACE FUNCTION public.settle_store_open_bill(p_bill_id uuid, p_cash_received numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=(select auth.uid()); v_bill public.store_open_bills%rowtype; v_role text; v_result jsonb; v_location text; v_expected numeric;
begin
 if v_uid is null then raise exception 'Silakan login terlebih dahulu.'; end if;
 select b.* into v_bill from public.store_open_bills b where b.id=p_bill_id for update;
 if not found then raise exception 'Tagihan tidak ditemukan.'; end if;
 select m.role into v_role from public.business_members m where m.business_id=v_bill.business_id and m.user_id=v_uid and m.active=true and m.role in ('owner','employee') limit 1;
 if v_role is null then raise exception 'Akun tidak memiliki akses aktif ke usaha ini.'; end if;
 if v_role='employee' and not private.kasusaha_employee_device_is_paid(v_bill.business_id) then raise exception 'Perangkat Karyawan belum diaktifkan Owner.'; end if;
 if not private.kasusaha_business_license_is_verified(v_bill.business_id) or not private.kasusaha_business_has_feature(v_bill.business_id,'cashier') then raise exception 'Lisensi atau paket belum mengizinkan fitur kasir.'; end if;
 if v_bill.status='paid' then return jsonb_build_object('ok',true,'already_paid',true,'total_amount',v_bill.total_amount,'bill_id',v_bill.id); end if;
 if v_bill.status<>'open' then raise exception 'Tagihan tidak lagi terbuka.'; end if;
 if p_cash_received is null or p_cash_received<v_bill.total_amount or p_cash_received<>trunc(p_cash_received) then raise exception 'Uang diterima belum mencukupi total tagihan.'; end if;
 select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into v_expected from jsonb_array_elements(v_bill.lines) x;
 if v_expected<>v_bill.total_amount then raise exception 'Total tagihan tidak cocok dengan rincian barang. Buka dan simpan ulang tagihan.'; end if;
 if exists(select 1 from jsonb_array_elements(v_bill.lines) x left join public.store_products p on p.id=(x->>'product_id')::uuid and p.business_id=v_bill.business_id where p.id is null or p.active is not true or p.item_type='ingredient' or p.price<>(x->>'unit_price')::numeric) then
  raise exception 'Harga/status produk berubah sejak tagihan dibuat. Buka dan perbarui tagihan sebelum pembayaran.';
 end if;
 v_location := coalesce(
   nullif(pg_catalog.concat_ws(' • ',
     CASE WHEN nullif(trim(v_bill.table_number),'') IS NOT NULL THEN 'Meja '||left(trim(v_bill.table_number),20) END,
     CASE WHEN nullif(trim(v_bill.customer_name),'') IS NOT NULL THEN 'Pelanggan: '||left(trim(v_bill.customer_name),80) END
   ), ''),
   'Kasir'
 );
 v_result:=public.record_store_quick_sale(v_bill.business_id,v_location,v_bill.lines,v_bill.sale_request_id);
 update public.store_open_bills set status='paid',payment_cash=p_cash_received,change_amount=p_cash_received-v_bill.total_amount,paid_at=now(),paid_by=v_uid,updated_at=now(),version=version+1 where id=v_bill.id and status='open';
 if not found then raise exception 'Status tagihan berubah saat pembayaran diproses.'; end if;
 return v_result||jsonb_build_object('bill_id',v_bill.id,'payment_cash',p_cash_received,'change_amount',p_cash_received-v_bill.total_amount,'paid_at',now());
end; $function$
