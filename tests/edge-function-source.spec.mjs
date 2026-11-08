import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const paymentSource = readFileSync(
  new URL('../supabase/functions/create-midtrans-payment/index.ts', import.meta.url),
  'utf8',
);

test('Production payment gates run before any Midtrans transaction reservation', async () => {
  const marketplaceGate = paymentSource.indexOf(
    'if (production && hasPhysicalProduct && norm(Deno.env.get("MARKETPLACE_PRODUCTION_PAYMENTS_ENABLED")) !== "true")',
  );
  const generalGate = paymentSource.indexOf(
    'if (!productionPaymentsEnabled(production))',
  );
  const attemptCreation = paymentSource.indexOf(
    'const attemptId = newAttemptId()',
  );
  const reservation = paymentSource.indexOf(
    '.update({\n        payment_provider: "midtrans",\n        provider_transaction_id: attemptId,',
  );

  expect(marketplaceGate, 'marketplace production gate must exist').toBeGreaterThanOrEqual(0);
  expect(generalGate, 'general production gate must exist').toBeGreaterThanOrEqual(0);
  expect(attemptCreation, 'transaction attempt must exist').toBeGreaterThanOrEqual(0);
  expect(reservation, 'transaction reservation must exist').toBeGreaterThanOrEqual(0);
  expect(marketplaceGate, 'marketplace gate must precede transaction creation').toBeLessThan(attemptCreation);
  expect(generalGate, 'general gate must precede transaction creation').toBeLessThan(attemptCreation);
  expect(attemptCreation, 'transaction creation must precede reservation').toBeLessThan(reservation);
  expect(paymentSource.indexOf('if (!productionPaymentsEnabled(production))', generalGate + 1), 'no late duplicate gate should remain').toBe(-1);
});

test('verified Midtrans webhook accepts already-paid orders after seller processing', async () => {
  const webhookSource = readFileSync(
    new URL('../supabase/functions/midtrans-webhook/index.ts', import.meta.url),
    'utf8',
  );

  expect(webhookSource).toContain(
    'if (!["paid", "processing", "completed"].includes(paidOrder.status))',
  );
  expect(webhookSource).not.toContain('if (paidOrder.status !== "paid")');
  expect(webhookSource).toContain(
    '.in("status", ["paid", "processing", "completed"])',
  );
});
 
test('license activation accepts processed paid orders only with verified Midtrans events', async () => {
  const activationSource = readFileSync(
    new URL('../supabase/functions/activate-kasusaha-license/index.ts', import.meta.url),
    'utf8',
  );

  expect(activationSource).toContain(
    '.in("status", ["paid", "processing", "completed"])',
  );
  expect(activationSource).toContain(
    '!["paid", "processing", "completed"].includes(order.status)',
  );
  expect(activationSource.match(/\.eq\("payment_provider", "midtrans"\)/g)).toHaveLength(1);
  expect(activationSource.match(/\.eq\("provider", "midtrans"\)/g)).toHaveLength(2);
  expect(activationSource.match(/\.eq\("verification_status", "verified"\)/g)).toHaveLength(2);
  expect(activationSource.match(/\.not\("processed_at", "is", null\)/g)).toHaveLength(2);
});

test('platform finance endpoint allows the configured Playwright preview origin for CORS preflight', async () => {
  const financeSource = readFileSync(
    new URL('../supabase/functions/platform-marketplace-finance/index.ts', import.meta.url),
    'utf8',
  );
  const playwrightConfig = readFileSync(
    new URL('../playwright.config.mjs', import.meta.url),
    'utf8',
  );

  expect(playwrightConfig).toContain(
    'https://fix-navigation-serialization.kasusaha-lite.pages.dev',
  );
  expect(financeSource).toContain(
    '"https://fix-navigation-serialization.kasusaha-lite.pages.dev"',
  );
  expect(financeSource).toContain('if (req.method === "OPTIONS")');
});

test('Midtrans webhook bounds Status API wait and keeps provider response bodies out of logs', async () => {
  const webhookSource = readFileSync(
    new URL('../supabase/functions/midtrans-webhook/index.ts', import.meta.url),
    'utf8',
  );

  expect(webhookSource).toContain('signal: AbortSignal.timeout(12_000)');
  expect(webhookSource).toContain('"Status API Midtrans gagal:",\n        statusResponse.status,');
  expect(webhookSource).not.toContain('"Status API Midtrans gagal:",\n        statusResponse.status,\n        responseText');
});


test('Midtrans server key is trimmed and encoded using HTTP Basic authentication', async () => {
  const paymentSource = readFileSync(
    new URL('../supabase/functions/create-midtrans-payment/index.ts', import.meta.url),
    'utf8',
  );

  expect(paymentSource).toContain('const serverKey = configuredServerKey?.trim();');
  expect(paymentSource).toContain('const authHeader = "Basic " + btoa(serverKey + ":");');
  expect(paymentSource).toContain('https://api.sandbox.midtrans.com');
  expect(paymentSource).toContain('https://app.sandbox.midtrans.com');
});


test('physical marketplace checkout blocks incomplete seller sender profile before payment', async () => {
  const checkoutSource = readFileSync(
    new URL('../supabase/functions/create-marketplace-order/index.ts', import.meta.url),
    'utf8',
  );

  expect(checkoutSource).toContain('alamat_asal_pengiriman,telepon_pengirim,nama_kontak_pengirim,nama_penjual');
  expect(checkoutSource).toContain('SELLER_SHIPPING_PROFILE_INCOMPLETE');
  expect(checkoutSource).toContain('const invalidSenderProfile = currentProducts.some');
  expect(checkoutSource).toContain('if (invalidSenderProfile)');
  expect(checkoutSource.indexOf('if (invalidSenderProfile)')).toBeLessThan(
    checkoutSource.indexOf('create_marketplace_order_secure'),
  );
});


test('Midtrans webhook returns retryable failure when an attempted physical shipment booking fails', async () => {
  const webhookSource = readFileSync(
    new URL('../supabase/functions/midtrans-webhook/index.ts', import.meta.url),
    'utf8',
  );

  expect(webhookSource).toContain('shipmentBooking?.attempted === true && shipmentBooking?.success !== true');
  expect(webhookSource).toContain('retry_required: true');
  expect(webhookSource).toContain('}, 502);');
});


test('Biteship webhook guards against out-of-order status downgrades', async () => {
  const source = readFileSync(
    new URL('../supabase/functions/biteship-webhook/index.ts', import.meta.url),
    'utf8',
  );
  expect(source).toContain('function shouldApplyStatus(current: unknown, incoming: string)');
  expect(source).toContain('return incomingRank >= currentRank;');
  expect(source).toContain('shouldApplyStatus(currentOrder.shipping_status, status)');
});
