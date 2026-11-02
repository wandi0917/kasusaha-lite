create or replace function public.kasusaha_owner_employee_directory(p_business_id uuid)
returns table(identity_id uuid, user_id uuid, employee_name text)
language sql
security definer
set search_path to ''
as $function$
  with owner_access as (
    select 1 as allowed
    where (select auth.uid()) is not null
      and exists (
        select 1 from public.business_members m
        where m.business_id = p_business_id
          and m.user_id = (select auth.uid())
          and m.active = true
          and m.role = 'owner'
      )
      and private.kasusaha_business_license_is_verified(p_business_id)
      and private.kasusaha_business_has_feature(p_business_id, 'employees')
  ),
  identity_rows as (
    select i.id, i.business_id, i.employee_name, i.auth_user_id
    from private.employee_identities i
    where i.business_id = p_business_id
  )
  select i.id, i.auth_user_id,
         coalesce(nullif(pg_catalog.btrim(i.employee_name), ''), 'Karyawan')
  from identity_rows i cross join owner_access
  where i.auth_user_id is not null
  union
  select i.id, a.historical_user_id,
         coalesce(nullif(pg_catalog.btrim(i.employee_name), ''), 'Karyawan')
  from private.employee_identity_aliases a
  join identity_rows i on i.id = a.identity_id and i.business_id = a.business_id
  cross join owner_access
  where a.business_id = p_business_id
  union
  select null::uuid, m.user_id,
         coalesce(nullif(pg_catalog.btrim(ic.employee_name), ''), 'Karyawan')
  from public.business_members m
  left join public.employee_invite_code_users u
    on u.user_id = m.user_id and u.business_id = m.business_id
  left join public.employee_invite_codes ic
    on ic.id = u.invite_code_id and ic.business_id = u.business_id
  cross join owner_access
  where m.business_id = p_business_id and m.active = true and m.role = 'employee'
    and not exists (select 1 from identity_rows i where i.auth_user_id = m.user_id)
    and not exists (
      select 1 from private.employee_identity_aliases a
      where a.business_id = p_business_id and a.historical_user_id = m.user_id
    );
$function$;

create or replace function public.record_store_quick_sale(
  p_business_id uuid, p_table_number text, p_lines jsonb,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_line jsonb;
  v_product_id uuid;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_stock integer;
  v_name text;
  v_code text;
  v_amount numeric;
  v_total numeric := 0;
  v_count integer := 0;
  v_location text;
  v_description text;
  v_request_id uuid := coalesce(p_request_id, pg_catalog.gen_random_uuid());
  v_request_hash text := md5(coalesce(p_table_number, '') || '|' || coalesce(p_lines::text, 'null'));
  v_existing_hash text;
  v_existing_result jsonb;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'Silakan login terlebih dahulu.'; end if;
  select m.role into v_role from public.business_members m
  where m.business_id = p_business_id and m.user_id = v_uid
    and m.active = true and m.role in ('owner', 'employee') limit 1;
  if v_role is null then raise exception 'Akun tidak memiliki akses aktif ke usaha ini.'; end if;
  if not private.kasusaha_business_license_is_verified(p_business_id) then
    raise exception 'Lisensi KasUsaha Lite belum memiliki pembayaran terverifikasi. Fitur kasir dikunci sampai verifikasi selesai.';
  end if;
  if not private.kasusaha_business_has_feature(p_business_id, 'cashier') then
    raise exception 'Paket lisensi ini tidak mencakup fitur kasir.';
  end if;
  if v_role = 'employee' and not private.kasusaha_employee_device_is_paid(p_business_id) then
    raise exception 'Perangkat Karyawan belum diaktifkan oleh Owner. Selesaikan pembayaran aktivasi terlebih dahulu.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':' || v_request_id::text, 0));
  select r.request_hash, r.result into v_existing_hash, v_existing_result
  from private.store_quick_sale_requests r
  where r.business_id = p_business_id and r.request_id = v_request_id for update;
  if found then
    if v_existing_hash <> v_request_hash then
      raise exception 'ID permintaan penjualan ini sudah dipakai untuk rincian berbeda. Muat ulang kasir dan periksa laporan sebelum membuat transaksi baru.';
    end if;
    if not exists (
      select 1 from private.store_quick_sale_requests r
      where r.business_id = p_business_id and r.request_id = v_request_id and r.user_id = v_uid
    ) then raise exception 'ID permintaan penjualan tidak cocok dengan akun yang login.'; end if;
    return v_existing_result || jsonb_build_object('replayed', true);
  end if;
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 50 then
    raise exception 'Daftar penjualan tidak valid. Isi 1 sampai 50 baris barang.';
  end if;
  v_location := case when nullif(trim(coalesce(p_table_number, '')), '') is null then 'Kasir'
    else 'Meja ' || left(regexp_replace(trim(p_table_number), '[<>]', '', 'g'), 20) end;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin
      v_product_id := (v_line->>'product_id')::uuid;
      v_qty := (v_line->>'quantity')::integer;
    exception when others then raise exception 'Data barang atau jumlah penjualan tidak valid.';
    end;
    if v_qty is null or v_qty < 1 then raise exception 'Jumlah barang harus bilangan bulat positif.'; end if;
    select sp.price, sp.product_name, sp.product_code, sp.cost_price, sp.stock_quantity
      into v_price, v_name, v_code, v_cost, v_stock
    from public.store_products sp
    where sp.id = v_product_id and sp.business_id = p_business_id
      and sp.active = true and sp.item_type <> 'ingredient' for update;
    if not found then raise exception 'Barang tidak ditemukan, nonaktif, atau bukan produk kasir.'; end if;
    if v_price is null or v_price <= 0 or v_price <> trunc(v_price) then
      raise exception 'Harga jual pada master produk belum valid. Periksa harga produk terlebih dahulu.';
    end if;
    if v_stock is null or v_stock < v_qty then
      raise exception 'Stok % tidak cukup atau belum ditetapkan. Stok tersedia: %.', v_name, coalesce(v_stock, 0);
    end if;
    v_amount := v_qty * v_price;
    if v_amount <= 0 or v_amount <> trunc(v_amount) then raise exception 'Subtotal penjualan tidak valid.'; end if;
    if v_role = 'owner' then
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || case when v_cost is null then ' | Modal belum dicatat'
          else ' | Modal/unit Rp' || to_char(v_cost, 'FM999,999,999,999,990')
          || ' | Modal total Rp' || to_char(v_cost * v_qty, 'FM999,999,999,999,990')
          || ' | Laba kotor Rp' || to_char((v_price - v_cost) * v_qty, 'FM999,999,999,999,990') end
        || ' | Jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    else
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || ' | Harga jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    end if;
    insert into public.financial_transactions
      (business_id, created_by, created_by_role, transaction_date, transaction_type, amount, description, category)
    values (p_business_id, v_uid, v_role, (now() at time zone 'Asia/Jakarta')::date, 'income', v_amount, v_description, 'Penjualan');
    update public.store_products set stock_quantity = stock_quantity - v_qty, updated_at = now()
    where id = v_product_id and business_id = p_business_id
      and stock_quantity is not null and stock_quantity >= v_qty;
    if not found then raise exception 'Stok berubah saat transaksi diproses. Silakan ulangi penjualan.'; end if;
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  end loop;
  v_result := jsonb_build_object('ok', true, 'total_amount', v_total, 'lines_count', v_count,
    'location', v_location, 'request_id', v_request_id);
  insert into private.store_quick_sale_requests (request_id, business_id, user_id, request_hash, result)
  values (v_request_id, p_business_id, v_uid, v_request_hash, v_result);
  return v_result;
end;
$function$;

revoke all on function public.kasusaha_owner_employee_directory(uuid) from public, anon;
grant execute on function public.kasusaha_owner_employee_directory(uuid) to authenticated;
revoke all on function public.record_store_quick_sale(uuid,text,jsonb,uuid) from public, anon;
grant execute on function public.record_store_quick_sale(uuid,text,jsonb,uuid) to authenticated;
