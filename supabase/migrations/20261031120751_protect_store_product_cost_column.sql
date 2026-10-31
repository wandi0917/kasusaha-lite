-- Defense-in-depth: cost_price is exposed only through owner-checked SECURITY DEFINER RPCs.
REVOKE SELECT (cost_price), INSERT (cost_price), UPDATE (cost_price)
ON TABLE public.store_products FROM authenticated;

GRANT EXECUTE ON FUNCTION public.get_store_product_costs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_store_product_cost(uuid, numeric) TO authenticated;
