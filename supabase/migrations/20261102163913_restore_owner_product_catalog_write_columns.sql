-- Restore the minimum client write privileges required by the Owner product editor.
-- RLS policies remain the authorization boundary; cost_price stays server-only.
grant insert (
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
) on table public.store_products to authenticated;

grant update (
  product_code,
  product_name,
  price,
  active,
  updated_at,
  stock_quantity,
  stock_unit,
  item_type,
  barcode_value,
  barcode_type,
  barcode_aliases
) on table public.store_products to authenticated;

revoke insert (cost_price) on table public.store_products from anon, authenticated;
revoke update (cost_price) on table public.store_products from anon, authenticated;
