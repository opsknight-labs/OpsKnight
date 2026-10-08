import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { provisionAutomationProviderCapacity } from '../load/helpers/automation';
import { providerDuplicateDelta } from '../load/helpers/automation-provider-telemetry';
it('provisions the identities actually used by SMTP, web push and generic webhook delivery', async () => {
  const upsert = vi.fn().mockResolvedValue({});
  await provisionAutomationProviderCapacity({
    notificationProviderCapacity: { upsert },
  } as unknown as PrismaClient);
  expect(upsert.mock.calls.map(([args]) => args.where.provider_channel)).toEqual([
    { provider: 'smtp', channel: 'EMAIL' },
    { provider: 'web-push', channel: 'PUSH' },
    { provider: 'default', channel: 'WEBHOOK' },
  ]);
});
it('measures only new duplicate deliveries across a certification profile', () => {
  expect(
    providerDuplicateDelta(
      { email: { duplicateDeliveries: 5 }, push: { duplicateDeliveries: 1 } },
      { email: { duplicateDeliveries: 7 }, push: { duplicateDeliveries: 1 } }
    )
  ).toBe(2);
});
it('rejects missing telemetry, missing providers and reset counters instead of claiming zero duplicates', () => {
  for (const [before, after] of [
    [{}, {}],
    [{ email: { duplicateDeliveries: 0 } }, {}],
    [{ email: { duplicateDeliveries: 3 } }, { email: { duplicateDeliveries: 1 } }],
    [{ email: {} }, { email: { duplicateDeliveries: 0 } }],
    [{ email: { duplicateDeliveries: 0 } }, { sms: { duplicateDeliveries: 0 } }],
  ])
    expect(providerDuplicateDelta(before, after)).toBeNull();
});
