-- Do not persist cost-price or gross-profit details in cashier descriptions
-- unless the owner has the full_finance entitlement. Employee descriptions
-- remain sales-price-only. Patch the current function definition so earlier
-- employee-session safeguards are preserved.
DO $migration$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.record_store_quick_sale(uuid,text,jsonb,uuid)'::regprocedure
  );

  v_old := $old$
    IF v_role = 'owner' THEN
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || CASE WHEN v_cost IS NULL THEN ' | Modal belum dicatat'
          ELSE ' | Modal/unit Rp' || to_char(v_cost, 'FM999,999,999,999,990')
          || ' | Modal total Rp' || to_char(v_cost * v_qty, 'FM999,999,999,999,990')
          || ' | Laba kotor Rp' || to_char((v_price - v_cost) * v_qty, 'FM999,999,999,999,990') END
        || ' | Jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    ELSE
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || ' | Harga jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    END IF;
$old$;

  v_new := $new$
    IF v_role = 'owner'
       AND private.kasusaha_business_has_feature(p_business_id, 'full_finance') IS TRUE THEN
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || CASE WHEN v_cost IS NULL THEN ' | Modal belum dicatat'
          ELSE ' | Modal/unit Rp' || to_char(v_cost, 'FM999,999,999,999,990')
          || ' | Modal total Rp' || to_char(v_cost * v_qty, 'FM999,999,999,999,990')
          || ' | Laba kotor Rp' || to_char((v_price - v_cost) * v_qty, 'FM999,999,999,999,990') END
        || ' | Jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    ELSE
      v_description := v_location || ' — Penjualan ' || v_name || ' [' || coalesce(v_code, '-') || '] × ' || v_qty
        || ' | Harga jual/unit Rp' || to_char(v_price, 'FM999,999,999,999,990');
    END IF;
$new$;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected owner cost-detail block not found in record_store_quick_sale; refusing to replace an unknown function body.';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;
