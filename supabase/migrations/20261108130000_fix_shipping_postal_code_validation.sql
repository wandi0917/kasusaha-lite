-- Fix postal-code validation in seller shipping profile RPCs.
-- Use a POSIX digit class to avoid backslash-escaping ambiguity in SQL/regex strings.
BEGIN;

CREATE OR REPLACE FUNCTION public.kasusaha_update_my_product_shipping_profile(p_product_id bigint, p_contact text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric)
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
  IF p_postal_code IS NOT NULL AND trim(p_postal_code) !~ '^[0-9]{5} THEN
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
$function$
 THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.kasusaha_update_my_product_shipping_profiles(p_contact text, p_phone text, p_address text, p_postal_code text)
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
     OR trim(COALESCE(p_postal_code, '')) !~ '^[0-9]{5} THEN
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
$function$
 THEN
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
$function$
;

DO $validation$
BEGIN
  IF '12345' !~ '^[0-9]{5}$' THEN
    RAISE EXCEPTION 'Postal-code regression check failed for a valid 5-digit code';
  END IF;
  IF '1234' ~ '^[0-9]{5}$' OR '123456' ~ '^[0-9]{5}$' OR '12A45' ~ '^[0-9]{5}$' THEN
    RAISE EXCEPTION 'Postal-code regression check failed for an invalid code';
  END IF;
END;
$validation$;

COMMIT;
