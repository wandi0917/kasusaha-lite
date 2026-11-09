-- Defense in depth: direct client table privileges are already absent.
-- The only application write path is the owner-checked SECURITY DEFINER RPC
-- public.adjust_store_product_stock, owned by postgres and pinned to an empty search_path.
-- No client-facing policies are intentionally created for this private idempotency table.
ALTER TABLE private.store_stock_adjustment_requests ENABLE ROW LEVEL SECURITY;
