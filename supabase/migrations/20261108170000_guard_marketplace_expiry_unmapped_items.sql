-- Fail closed when an order item has no product_id.
-- Without the product reference, stock cannot be restored safely.
-- Preserve the existing service_role-only execution boundary.

CREATE OR REPLACE FUNCTION public.expire_marketplace_order(p_order_id uuid, p_transaction_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_item record;
  v_rows integer;
  v_item_count integer;
  v_unmapped_count integer;
BEGIN
  SELECT * INTO v_order
  FROM public.marketplace_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pesanan tidak ditemukan');
  END IF;

  IF v_order.status = 'cancelled' AND v_order.stock_restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'message', 'Sudah dibatalkan dan stok sudah dikembalikan');
  END IF;

  IF v_order.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status pesanan tidak mengizinkan pembatalan');
  END IF;

  IF v_order.payment_provider <> 'midtrans'
     OR v_order.provider_transaction_id IS DISTINCT FROM p_transaction_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Identitas transaksi tidak cocok');
  END IF;

  IF v_order.stock_restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Penanda pengembalian stok sudah terisi; periksa manual.';
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE product_id IS NULL OR quantity <= 0)
  INTO v_item_count, v_unmapped_count
  FROM public.marketplace_order_items
  WHERE order_id = p_order_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Detail barang pesanan tidak ditemukan.';
  END IF;

  -- A NULL product_id was previously skipped by NOT IN (...), which could
  -- mark the order cancelled while silently leaving its stock unreconciled.
  IF v_unmapped_count > 0 THEN
    RAISE EXCEPTION 'Ada detail barang tanpa produk atau jumlah yang valid; stok tidak diubah dan pesanan perlu diperiksa.';
  END IF;

  FOR v_item IN
    SELECT product_id, SUM(quantity)::bigint AS quantity
    FROM public.marketplace_order_items
    WHERE order_id = p_order_id
      AND product_id NOT IN (7, 8, 9, 10)
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    UPDATE public.produk
    SET stok = stok + v_item.quantity
    WHERE id = v_item.product_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Produk ID % tidak ditemukan.', v_item.product_id;
    END IF;
  END LOOP;

  UPDATE public.marketplace_orders
  SET status = 'cancelled',
      stock_restored_at = now(),
      payment_redirect_url = NULL,
      updated_at = now()
  WHERE id = p_order_id
    AND status = 'pending_payment'
    AND stock_restored_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Pesanan berubah; seluruh perubahan dibatalkan.';
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Pesanan dibatalkan dan stok dikembalikan');
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_marketplace_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_marketplace_order(uuid, text) TO service_role;
