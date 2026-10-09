import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import {
  createCentralNotificationIntent,
  deliverCentralNotification,
  reconcileUnknownNotifications,
  UNKNOWN_RECONCILIATION_DELAY_MS,
  processCentralNotificationQueue,
  getNextCentralNotificationAt,
} from '@/lib/notification-control-plane';
import { recoverAbandonedNotificationDispatches } from '@/lib/notification-dispatch-recovery';
import { notificationClaimAvailable } from '@/lib/notification-claim-lease';
const mocks = vi.hoisted(() => ({ send: vi.fn(), concurrency: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ sendWebhook: mocks.send }));
vi.mock('@/lib/encryption', () => ({
  encrypt: async (value: string) => `encrypted:${value}`,
  decrypt: async (value: string) => value.replace(/^encrypted:/, ''),
  getEncryptionKey: () => '11'.repeat(32),
}));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: async () => ({ allowed: true }),
  acquireProviderConcurrency: mocks.concurrency,
  releaseProviderConcurrency: async () => undefined,
  deferProviderAdmission: async () => undefined,
}));
vi.mock('@/lib/notification-capacity-control', async original => ({
  ...(await original<typeof import('@/lib/notification-capacity-control')>()),
  isBulkNotificationDeliveryPaused: async () => false,
}));
beforeEach(async () => {
  await resetDatabase();
  mocks.send.mockReset().mockResolvedValue({ success: true });
  mocks.concurrency.mockReset().mockResolvedValue({ allowed: true, leaseKey: 'test-lease' });
}, 30000);
afterAll(async () => {
  await db.$disconnect();
});
async function intent(key: string) {
  return createCentralNotificationIntent({
    category: 'SYSTEM',
    channel: 'WEBHOOK',
    recipientType: 'WEBHOOK',
    recipientAddress: 'https://example.com/recovery',
    templateKey: 'recovery',
    sourceType: 'SYSTEM',
    sourceId: key,
    eventKey: key,
    displayMessage: 'Recovery',
    payload: { kind: 'WEBHOOK', url: 'https://example.com/recovery', payload: { event: key } },
  });
}
it('reclaims a heartbeat-owned urgent notification after 20 seconds', async () => {
  const row = await intent('orphan');
  const old = new Date(Date.now() - 21000);
  await db.notification.update({
    where: { id: row.id },
    data: {
      trafficClass: 'CRITICAL',
      lastAttemptAt: old,
      claimToken: 'old-claim',
      claimHeartbeatAt: old,
    },
  });
  expect(await processCentralNotificationQueue({ batchSize: 1 })).toEqual({
    processed: 1,
    succeeded: 1,
    failed: 0,
  });
  expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT');
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it.each(['healthy', 'legacy', 'bulk'] as const)(
  'keeps %s claims unavailable to competitors',
  async kind => {
    const row = await intent(kind);
    const now = new Date();
    const old = new Date(now.getTime() - 21000);
    const heartbeat =
      kind === 'legacy' ? null : kind === 'healthy' ? new Date(now.getTime() - 5000) : old;
    await db.notification.update({
      where: { id: row.id },
      data: {
        trafficClass: kind === 'bulk' ? 'BULK' : 'CRITICAL',
        lastAttemptAt: old,
        claimToken: 'existing-claim',
        claimHeartbeatAt: heartbeat,
      },
    });
    expect(
      await db.notification.count({ where: { id: row.id, ...notificationClaimAvailable(now) } })
    ).toBe(0);
    const next = await getNextCentralNotificationAt(now);
    expect(next?.getTime()).toBe(
      kind === 'healthy' ? heartbeat!.getTime() + 20000 : old.getTime() + 600000
    );
    expect(await processCentralNotificationQueue({ batchSize: 1 })).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(mocks.send).not.toHaveBeenCalled();
  }
);
it('heartbeats the waiting members of a claimed batch without changing the ownership timestamp', async () => {
  const rows = await Promise.all(['one', 'two', 'three'].map(intent));
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  mocks.send.mockImplementationOnce(async () => {
    await gate;
    return { success: true };
  });
  const processing = processCentralNotificationQueue({ batchSize: 3, concurrency: 1 });
  try {
    await expect.poll(() => mocks.send.mock.calls.length).toBe(1);
    const original = await db.notification.findUniqueOrThrow({ where: { id: rows[0].id } });
    await expect
      .poll(
        async () =>
          db.notification.count({
            where: {
              id: { in: rows.map(row => row.id) },
              claimHeartbeatAt: { gt: original.lastAttemptAt! },
            },
          }),
        { timeout: 7000 }
      )
      .toBe(3);
    const current = await db.notification.findMany({
      where: { id: { in: rows.map(row => row.id) } },
    });
    expect(
      current.every(row => row.lastAttemptAt?.getTime() === original.lastAttemptAt?.getTime())
    ).toBe(true);
    release();
    expect(await processing).toEqual({ processed: 3, succeeded: 3, failed: 0 });
  } finally {
    release();
    await processing;
  }
}, 20000);
it('a replaced claim cannot dispatch after its provider admission resumes', async () => {
  const row = await intent('fenced');
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  mocks.concurrency.mockImplementationOnce(async () => {
    await gate;
    return { allowed: true, leaseKey: 'stale-lease' };
  });
  const stale = processCentralNotificationQueue({ batchSize: 1 });
  try {
    await expect.poll(() => mocks.concurrency.mock.calls.length).toBe(1);
    const old = new Date(Date.now() - 21000);
    await db.notification.update({
      where: { id: row.id },
      data: { claimToken: 'replacement-claim', lastAttemptAt: old, claimHeartbeatAt: old },
    });
    expect(await processCentralNotificationQueue({ batchSize: 1 })).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
    release();
    expect(await stale).toEqual({ processed: 0, succeeded: 0, failed: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'SENT'
    );
    expect(await db.notificationDeliveryAttempt.count({ where: { notificationId: row.id } })).toBe(
      1
    );
  } finally {
    release();
    await stale;
  }
});

it.each(['queue', 'inline'] as const)(
  'does not replay an abandoned dispatch through %s delivery',
  async path => {
    const row = await intent(`abandoned-${path}`);
    const old = new Date(Date.now() - 21000);
    await db.notification.update({
      where: { id: row.id },
      data: {
        trafficClass: 'TRANSACTIONAL',
        attempts: 1,
        lastAttemptAt: old,
        claimToken: 'lost-owner',
        claimHeartbeatAt: old,
        deliveryAttempts: {
          create: { ordinal: 1, outcome: 'IN_FLIGHT', provider: 'default', startedAt: old },
        },
      },
    });
    if (path === 'queue') await processCentralNotificationQueue({ batchSize: 1 });
    else await deliverCentralNotification(row.id);
    expect(mocks.send).not.toHaveBeenCalled();
    const stored = await db.notification.findUniqueOrThrow({
      where: { id: row.id },
      include: { deliveryAttempts: true },
    });
    expect(stored.status).toBe('UNKNOWN');
    expect(stored.attempts).toBe(1);
    expect(stored.deliveryAttempts).toMatchObject([
      { ordinal: 1, outcome: 'UNKNOWN', errorCode: 'DISPATCH_OWNER_LOST' },
    ]);
    expect(
      await reconcileUnknownNotifications(
        new Date(Date.now() + UNKNOWN_RECONCILIATION_DELAY_MS + 1000)
      )
    ).toEqual({ retried: 0, awaitingCallback: 0, unsupported: 1 });
    await processCentralNotificationQueue({ batchSize: 1 });
    expect(mocks.send).not.toHaveBeenCalled();
  }
);

it('sends nothing and preserves the attempt budget when the dispatch ledger cannot commit', async () => {
  const row = await intent('ledger-failure');
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_notification_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.outcome='IN_FLIGHT' THEN RAISE EXCEPTION 'injected dispatch ledger failure'; END IF; RETURN NEW; END $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER reject_notification_dispatch BEFORE INSERT ON "NotificationDeliveryAttempt" FOR EACH ROW EXECUTE FUNCTION reject_notification_dispatch()`
  );
  try {
    expect(await deliverCentralNotification(row.id)).toMatchObject({
      success: false,
      claimed: true,
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(await db.notification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastAttemptAt: null,
    });
    expect(await db.notificationDeliveryAttempt.count({ where: { notificationId: row.id } })).toBe(
      0
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER reject_notification_dispatch ON "NotificationDeliveryAttempt"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION reject_notification_dispatch()');
  }
});

it('lets a late provider acceptance settle its own recovered ambiguous marker', async () => {
  const row = await intent('late-acceptance');
  await db.notification.update({ where: { id: row.id }, data: { trafficClass: 'CRITICAL' } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  mocks.send.mockImplementationOnce(async () => {
    await gate;
    return { success: true };
  });
  const delivery = deliverCentralNotification(row.id);
  try {
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    const attempt = await db.notificationDeliveryAttempt.findFirstOrThrow({
      where: { notificationId: row.id },
    });
    expect(attempt.outcome).toBe('IN_FLIGHT');
    await db.notification.update({
      where: { id: row.id },
      data: { claimHeartbeatAt: new Date(Date.now() - 21000) },
    });
    expect(
      await recoverAbandonedNotificationDispatches(new Date(), UNKNOWN_RECONCILIATION_DELAY_MS)
    ).toBe(1);
    expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'UNKNOWN'
    );
  } finally {
    release();
  }
  expect(await delivery).toMatchObject({ success: true, claimed: true });
  expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT');
  expect(
    (await db.notificationDeliveryAttempt.findFirstOrThrow({ where: { notificationId: row.id } }))
      .outcome
  ).toBe('ACCEPTED');
  expect(mocks.send).toHaveBeenCalledOnce();
});

it('keeps ownership until a rejected dispatch can be durably settled', async () => {
  const row = await intent('rejected-ledger-failure');
  mocks.send.mockResolvedValue({ success: false, statusCode: 429, error: 'Rate limited' });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_reject_attempt_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.outcome <> 'IN_FLIGHT' THEN RAISE EXCEPTION 'test settlement unavailable'; END IF; RETURN NEW; END $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_reject_attempt_settlement BEFORE UPDATE ON "NotificationDeliveryAttempt" FOR EACH ROW EXECUTE FUNCTION test_reject_attempt_settlement()`
  );
  try {
    await deliverCentralNotification(row.id);
    const pending = await db.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(pending.status).toBe('PENDING');
    expect(pending.lastAttemptAt).not.toBeNull();
    expect(
      await db.notificationDeliveryAttempt.count({
        where: { notificationId: row.id, outcome: 'IN_FLIGHT' },
      })
    ).toBe(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER test_reject_attempt_settlement ON "NotificationDeliveryAttempt"`
    );
    await db.$executeRawUnsafe(`DROP FUNCTION test_reject_attempt_settlement()`);
  }
  const old = new Date(Date.now() - 21_000);
  await db.notification.update({
    where: { id: row.id },
    data: { trafficClass: 'TRANSACTIONAL', claimHeartbeatAt: old, lastAttemptAt: old },
  });
  expect(
    await recoverAbandonedNotificationDispatches(new Date(), UNKNOWN_RECONCILIATION_DELAY_MS)
  ).toBe(1);
  await processCentralNotificationQueue({ batchSize: 1 });
  expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'UNKNOWN'
  );
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
