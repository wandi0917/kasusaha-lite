-- Reassert the least-privilege catalog read boundary for authenticated business members.
-- The current production ACL was observed with table-wide SELECT on store_products,
-- which overrides the intended column-only protection and exposes cost_price.
BEGIN;

REVOKE SELECT ON TABLE public.store_products FROM authenticated;
REVOKE SELECT (cost_price) ON TABLE public.store_products FROM authenticated;

GRANT SELECT (
  id,
  business_id,
  product_code,
  product_name,
  price,
  active,
  created_at,
  updated_at,
  stock_quantity,
  stock_unit,
  item_type,
  barcode_value,
  barcode_type,
  barcode_aliases
) ON TABLE public.store_products TO authenticated;

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.store_products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'Security check failed: authenticated can still SELECT store_products.cost_price';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.store_products', 'price', 'SELECT') THEN
    RAISE EXCEPTION 'Regression check failed: authenticated cannot SELECT store_products.price';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.store_products', 'barcode_value', 'SELECT') THEN
    RAISE EXCEPTION 'Regression check failed: authenticated cannot SELECT store_products.barcode_value';
  END IF;
END
$$;

COMMIT;
