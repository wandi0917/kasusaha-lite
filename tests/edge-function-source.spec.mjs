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
