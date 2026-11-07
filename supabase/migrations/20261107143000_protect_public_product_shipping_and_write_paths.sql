-- Protect private seller shipping-origin data and restrict client write columns.
-- Existing product, stock, and financial rows are preserved.
-- Existing product rows and Biteship service_role access are preserved.

-- Remove the broad table-level grants first; column-level REVOKE alone
-- cannot override a table-level SELECT/UPDATE grant.
REVOKE SELECT ON TABLE public.produk FROM anon, authenticated;
GRANT SELECT (
  id, nama_produk, deskripsi, kategori, harga, stok,
  nama_penjual, kota, foto_url, created_at, aktif,
  berat_gram, panjang_cm, lebar_cm, tinggi_cm
) ON TABLE public.produk TO anon, authenticated;
-- Seller dashboards filter by owner_id; do not expose this UUID to anon.
GRANT SELECT (owner_id) ON TABLE public.produk TO authenticated;

REVOKE UPDATE ON TABLE public.produk FROM authenticated;
-- The current seller UI only edits these public catalog fields directly.
GRANT UPDATE (harga, stok, aktif) ON TABLE public.produk TO authenticated;

-- Cost price is read-protected already, but table-level INSERT/UPDATE
-- currently allows direct API writes around the full_finance check in
-- set_store_product_cost. Stock updates must also use the idempotent RPC.
REVOKE INSERT ON TABLE public.store_products FROM authenticated;
GRANT INSERT (
  business_id, product_code, product_name, barcode_value, barcode_type,
  price, stock_quantity, stock_unit, item_type, active, updated_at
) ON TABLE public.store_products TO authenticated;
REVOKE UPDATE ON TABLE public.store_products FROM authenticated;
GRANT UPDATE (
  product_code, product_name, price, active, updated_at,
  stock_unit, item_type, barcode_value, barcode_type, barcode_aliases
) ON TABLE public.store_products TO authenticated;
-- stock_quantity remains insertable for initial stock (audited by trigger),
-- but cannot be changed directly; changes go through adjust_store_product_stock.

-- Keep transaction attribution and idempotency metadata immutable to clients.
-- The Owner UI only edits these five business fields; server_recorded_at is
-- separately protected by its immutable timestamp trigger.
REVOKE INSERT ON TABLE public.financial_transactions FROM authenticated;
GRANT INSERT (
  business_id, created_by, created_by_role, transaction_date,
  transaction_type, amount, description, category, legacy_ref
) ON TABLE public.financial_transactions TO authenticated;

REVOKE UPDATE ON TABLE public.financial_transactions FROM authenticated;
GRANT UPDATE (
  transaction_date, transaction_type, amount, description, category
) ON TABLE public.financial_transactions TO authenticated;

-- Owners must still be able to list their own inactive products so the
-- "Tampilkan lagi" action can work after a product is hidden.
DROP POLICY IF EXISTS "Penjual dapat melihat produk miliknya" ON public.produk;
CREATE POLICY "Penjual dapat melihat produk miliknya"
ON public.produk
FOR SELECT
TO authenticated
USING (
  owner_id = (SELECT auth.uid())
  AND NOT COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous')::boolean), false)
);

CREATE OR REPLACE FUNCTION public.kasusaha_get_my_product_shipping_profiles()
RETURNS TABLE (
  id bigint,
  nama_produk text,
  nama_penjual text,
  kota text,
  alamat_asal_pengiriman text,
  kode_pos_asal_pengiriman text,
  nama_kontak_pengirim text,
  telepon_pengirim text,
  latitude_asal_pengiriman numeric,
  longitude_asal_pengiriman numeric,
  aktif boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL
     OR COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Login penjual terdaftar diperlukan.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.nama_produk, p.nama_penjual, p.kota,
         p.alamat_asal_pengiriman, p.kode_pos_asal_pengiriman,
         p.nama_kontak_pengirim, p.telepon_pengirim,
         p.latitude_asal_pengiriman, p.longitude_asal_pengiriman, p.aktif
  FROM public.produk p
  WHERE p.owner_id = v_uid
    AND lower(trim(COALESCE(p.nama_produk, ''))) <> 'kasusaha lite'
  ORDER BY p.id DESC
  LIMIT 100;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kasusaha_update_my_product_shipping_profile(
  p_product_id bigint,
  p_contact text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_updated_id bigint;
BEGIN
  IF v_uid IS NULL
     OR COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Login penjual terdaftar diperlukan.';
  END IF;
  IF p_product_id IS NULL THEN RAISE EXCEPTION 'Produk tidak valid.'; END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'Koordinat latitude dan longitude harus dikirim bersamaan.';
  END IF;
  IF p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90) THEN
    RAISE EXCEPTION 'Latitude di luar rentang yang valid.';
  END IF;
  IF p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180) THEN
    RAISE EXCEPTION 'Longitude di luar rentang yang valid.';
  END IF;
  IF p_contact IS NOT NULL AND length(trim(p_contact)) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Nama kontak wajib 1 sampai 150 karakter.';
  END IF;
  IF p_phone IS NOT NULL AND length(trim(p_phone)) NOT BETWEEN 6 AND 40 THEN
    RAISE EXCEPTION 'Telepon wajib 6 sampai 40 karakter.';
  END IF;
  IF p_address IS NOT NULL AND length(trim(p_address)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Alamat wajib 10 sampai 1000 karakter.';
  END IF;
  IF p_postal_code IS NOT NULL AND trim(p_postal_code) !~ '^\d{5}$' THEN
    RAISE EXCEPTION 'Kode pos harus 5 digit.';
  END IF;

  UPDATE public.produk p
  SET nama_kontak_pengirim = CASE WHEN p_contact IS NULL THEN p.nama_kontak_pengirim ELSE trim(p_contact) END,
      telepon_pengirim = CASE WHEN p_phone IS NULL THEN p.telepon_pengirim ELSE trim(p_phone) END,
      alamat_asal_pengiriman = CASE WHEN p_address IS NULL THEN p.alamat_asal_pengiriman ELSE trim(p_address) END,
      kode_pos_asal_pengiriman = CASE WHEN p_postal_code IS NULL THEN p.kode_pos_asal_pengiriman ELSE trim(p_postal_code) END,
      latitude_asal_pengiriman = CASE WHEN p_latitude IS NULL THEN p.latitude_asal_pengiriman ELSE p_latitude END,
      longitude_asal_pengiriman = CASE WHEN p_longitude IS NULL THEN p.longitude_asal_pengiriman ELSE p_longitude END
  WHERE p.id = p_product_id
    AND p.owner_id = v_uid
    AND lower(trim(COALESCE(p.nama_produk, ''))) <> 'kasusaha lite'
  RETURNING p.id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau bukan milik akun ini.';
  END IF;

  RETURN jsonb_build_object('success', true, 'product_id', v_updated_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kasusaha_update_my_product_shipping_profiles(
  p_contact text,
  p_phone text,
  p_address text,
  p_postal_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_updated_count integer := 0;
BEGIN
  IF v_uid IS NULL
     OR COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'Login penjual terdaftar diperlukan.';
  END IF;
  IF length(trim(COALESCE(p_contact, ''))) NOT BETWEEN 1 AND 150
     OR length(trim(COALESCE(p_phone, ''))) NOT BETWEEN 6 AND 40
     OR length(trim(COALESCE(p_address, ''))) NOT BETWEEN 10 AND 1000
     OR trim(COALESCE(p_postal_code, '')) !~ '^\d{5}$' THEN
    RAISE EXCEPTION 'Nama kontak, telepon, alamat, atau kode pos tidak valid.';
  END IF;

  UPDATE public.produk p
  SET nama_kontak_pengirim = trim(p_contact),
      telepon_pengirim = trim(p_phone),
      alamat_asal_pengiriman = trim(p_address),
      kode_pos_asal_pengiriman = trim(p_postal_code)
  WHERE p.owner_id = v_uid
    AND p.aktif IS TRUE
    AND lower(trim(COALESCE(p.nama_produk, ''))) <> 'kasusaha lite';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'success', v_updated_count > 0,
    'updated_count', v_updated_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_get_my_product_shipping_profiles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kasusaha_update_my_product_shipping_profile(bigint, text, text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kasusaha_update_my_product_shipping_profiles(text, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kasusaha_get_my_product_shipping_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kasusaha_update_my_product_shipping_profile(bigint, text, text, text, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kasusaha_update_my_product_shipping_profiles(text, text, text, text) TO authenticated;
