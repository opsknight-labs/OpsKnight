import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import {
  createCentralNotificationIntent,
  deliverCentralNotification,
  processCentralNotificationQueue,
} from '@/lib/notification-control-plane';

const mocks = vi.hoisted(() => ({ sendWebhook: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/webhooks', () => ({ sendWebhook: mocks.sendWebhook }));
vi.mock('@/lib/encryption', () => ({
  encrypt: async (value: string) => `encrypted:${value}`,
  decrypt: async (value: string) => value.replace(/^encrypted:/, ''),
  getEncryptionKey: () => '11'.repeat(32),
}));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: async () => ({ allowed: true }),
  acquireProviderConcurrency: async () => ({ allowed: true, leaseKey: 'test-lease' }),
  releaseProviderConcurrency: async () => undefined,
}));

beforeEach(async () => {
  await resetDatabase();
  mocks.sendWebhook.mockReset().mockResolvedValue({ success: true });
}, 30_000);
afterAll(async () => {
  await db.$disconnect();
});

it.each(['in-flight', 'completed'] as const)(
  'does not reclaim an %s inline delivery from a stale queue ranking',
  async phase => {
    const intent = await createCentralNotificationIntent({
      category: 'SYSTEM',
      channel: 'WEBHOOK',
      recipientType: 'WEBHOOK',
      recipientAddress: 'https://example.com/claim-race',
      templateKey: 'claim-race',
      sourceType: 'SYSTEM',
      sourceId: 'claim-race',
      eventKey: 'one',
      displayMessage: 'Claim race',
      payload: {
        kind: 'WEBHOOK',
        url: 'https://example.com/claim-race',
        payload: { event: 'one' },
      },
    });
    const gateClient = new PrismaClient();
    let releaseGate!: () => void;
    let announceGate!: () => void;
    const release = new Promise<void>(resolve => {
      releaseGate = resolve;
    });
    const ready = new Promise<void>(resolve => {
      announceGate = resolve;
    });
    const gate = gateClient.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(42424242)`;
        announceGate();
        await release;
      },
      { timeout: 20_000 }
    );
    await ready;
    const originalQuery = prisma.$queryRaw.bind(prisma);
    const interception = vi.spyOn(prisma, '$queryRaw').mockImplementation(((
      ...args: Parameters<typeof prisma.$queryRaw>
    ) => {
      const query = args[0];
      if ('strings' in query && query.strings.join('').includes('WITH ranked AS MATERIALIZED')) {
        // Pause the real queue SQL after its statement snapshot is established.
        // Inline delivery claims or completes while that snapshot still sees an unclaimed row.
        const strings = query.strings.map(part =>
          part
            .replace(
              'WITH ranked AS MATERIALIZED',
              'WITH gate AS MATERIALIZED (SELECT pg_advisory_xact_lock(42424242) /* automation-claim-race */), ranked AS MATERIALIZED'
            )
            .replace(
              'FROM "Notification" notification',
              'FROM "Notification" notification CROSS JOIN gate'
            )
        );
        return originalQuery(Prisma.sql(strings, ...query.values));
      }
      return originalQuery(...args);
    }) as typeof prisma.$queryRaw);
    let releaseDelivery!: () => void;
    const deliveryBarrier = new Promise<void>(resolve => {
      releaseDelivery = resolve;
    });
    mocks.sendWebhook.mockImplementationOnce(async () => {
      if (phase === 'in-flight') await deliveryBarrier;
      return { success: true };
    });
    const queued = processCentralNotificationQueue({ batchSize: 1 });
    let inline: ReturnType<typeof deliverCentralNotification> | undefined;
    try {
      await expect
        .poll(
          async () => {
            const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM pg_stat_activity
        WHERE query LIKE '%automation-claim-race%' AND wait_event = 'advisory'
      `;
            return Number(row.count);
          },
          { timeout: 10_000 }
        )
        .toBeGreaterThan(0);
      inline = deliverCentralNotification(intent.id);
      await expect.poll(() => mocks.sendWebhook.mock.calls.length).toBe(1);
      if (phase === 'completed') await inline;
      releaseGate();
      await gate;
      expect(await queued).toEqual({ processed: 0, succeeded: 0, failed: 0 });
      releaseDelivery();
      expect(await inline).toMatchObject({ success: true, claimed: true });
      expect((await db.notification.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe(
        'SENT'
      );
      expect(mocks.sendWebhook).toHaveBeenCalledTimes(1);
      expect(
        await db.notificationDeliveryAttempt.count({ where: { notificationId: intent.id } })
      ).toBe(1);
    } finally {
      releaseGate();
      releaseDelivery();
      await Promise.allSettled([gate, queued, inline]);
      interception.mockRestore();
      await gateClient.$disconnect();
    }
  },
  30_000
);
