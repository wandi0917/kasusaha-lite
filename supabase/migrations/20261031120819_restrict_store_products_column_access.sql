-- Remove table-wide access so authenticated members cannot read cost_price directly.
-- Regrant only the columns used by the application. Row-level policies continue
-- to restrict product writes to active Owners and reads to active business members.
REVOKE SELECT, INSERT, UPDATE ON TABLE public.store_products FROM authenticated;
REVOKE SELECT (cost_price), INSERT (cost_price), UPDATE (cost_price)
ON TABLE public.store_products FROM authenticated;

GRANT SELECT (
  id, business_id, product_code, product_name, price,
  stock_quantity, stock_unit, item_type, active, created_at, updated_at
) ON TABLE public.store_products TO authenticated;

GRANT INSERT (
  business_id, product_code, product_name, price,
  stock_quantity, stock_unit, item_type, active, updated_at
) ON TABLE public.store_products TO authenticated;

GRANT UPDATE (
  product_code, product_name, price, stock_quantity,
  stock_unit, item_type, active, updated_at
) ON TABLE public.store_products TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_store_product_costs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_store_product_cost(uuid, numeric) TO authenticated;
