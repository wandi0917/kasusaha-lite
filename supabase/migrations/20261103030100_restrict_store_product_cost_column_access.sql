-- Do not expose store_products.cost_price to authenticated clients.
-- Owners read cost prices through get_store_product_costs(), a SECURITY DEFINER
-- function that checks the authenticated user is an active Owner with a
-- verified license and the full_finance entitlement.
REVOKE SELECT ON TABLE public.store_products FROM authenticated;

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
  IF NOT has_column_privilege('authenticated', 'public.store_products', 'product_name', 'SELECT') THEN
    RAISE EXCEPTION 'Regression check failed: authenticated cannot SELECT store_products.product_name';
  END IF;
END
$$;
