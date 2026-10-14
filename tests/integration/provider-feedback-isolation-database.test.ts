// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import {
  collectProviderFeedbackMetrics,
  providerFeedbackMetricsQuery,
} from '@/lib/provider-feedback-metrics';
import { encrypt } from '@/lib/encryption';
import {
  ingestNotificationProviderFeedback,
  reconcileNotificationProviderFeedback,
  cleanNotificationProviderFeedback,
} from '@/lib/notification-provider-feedback';
import {
  createCentralNotificationIntent,
  processCentralNotificationQueue,
  deliverCentralNotification,
} from '@/lib/notification-control-plane';

const mocks = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async original => ({
  ...(await original<typeof import('@/lib/email')>()),
  sendEmail: mocks.sendEmail,
}));
vi.mock('@/lib/notification-providers', async original => ({
  ...(await original<typeof import('@/lib/notification-providers')>()),
  getAllConfiguredEmailProviders: vi.fn().mockResolvedValue([]),
}));
// Provider admission is outside this receipt-ordering fixture; database queue claims,
// receipt rollback, retry persistence and fan-out counters remain real PostgreSQL.
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: vi.fn().mockResolvedValue({ allowed: true }),
  acquireProviderConcurrency: vi
    .fn()
    .mockResolvedValue({ allowed: true, leaseKey: 'receipt-isolation' }),
  releaseProviderConcurrency: vi.fn().mockResolvedValue(undefined),
  deferProviderAdmission: vi.fn().mockResolvedValue(undefined),
}));
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
suite('provider receipt isolation against PostgreSQL', () => {
  const prefix = `receipt-isolation-${Date.now()}`;
  let pageId: string;
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw Error('Isolated certification database required');
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    pageId = (await prisma.statusPage.create({ data: { name: prefix } })).id;
  });
  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { sourceId: { startsWith: prefix } } });
    await prisma.notificationProviderFeedback.deleteMany({
      where: { providerEventId: { startsWith: prefix } },
    });
    await prisma.notificationFanout.deleteMany({ where: { sourceId: { startsWith: prefix } } });
    await prisma.notificationContent.deleteMany({ where: { contentHash: { startsWith: prefix } } });
    await prisma.statusPage.delete({ where: { id: pageId } });
  });
  async function critical(key: string, fanoutId?: string) {
    return createCentralNotificationIntent({
      category: 'SECURITY',
      channel: 'EMAIL',
      recipientType: 'EMAIL',
      recipientId: key,
      recipientAddress: 'fixture@example.test',
      templateKey: 'isolation-fixture',
      sourceType: 'TEST',
      sourceId: key,
      eventKey: key,
      trafficClass: 'CRITICAL',
      displayMessage: 'Critical fixture',
      fanoutId,
      payload: {
        kind: 'EMAIL',
        to: 'fixture@example.test',
        subject: 'Fixture',
        html: '<p>Fixture</p>',
      },
    });
  }
  it('quarantines a deleted subscriber soft bounce while a critical notification drains', async () => {
    const key = `${prefix}-deleted`;
    const subscription = await prisma.statusPageSubscription.create({
      data: { statusPageId: pageId, email: 'deleted@example.test', token: key },
    });
    await prisma.notification.create({
      data: {
        channel: 'EMAIL',
        status: 'SENT',
        category: 'SECURITY',
        recipientType: 'SUBSCRIBER',
        recipientId: subscription.id,
        recipientHash: key,
        sourceId: key,
        providerMessageId: key,
        deliveryProvider: 'fixture',
      },
    });
    await prisma.statusPageSubscription.delete({ where: { id: subscription.id } });
    await prisma.notificationProviderFeedback.create({
      data: {
        provider: 'fixture',
        providerEventId: key,
        providerMessageId: key,
        eventType: 'SOFT_BOUNCE',
        occurredAt: new Date(),
      },
    });
    const intent = await critical(`${key}-critical`);
    mocks.sendEmail.mockResolvedValue({
      success: true,
      providerMessageId: `${key}-sent`,
      selectedProvider: 'fixture',
    });
    const result = await processCentralNotificationQueue({
      trafficClasses: ['CRITICAL'],
      batchSize: 10,
      concurrency: 1,
    });
    expect(result.succeeded).toBeGreaterThanOrEqual(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe(
      'SENT'
    );
    const receipt = await prisma.notificationProviderFeedback.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
    });
    expect(receipt.quarantinedAt).not.toBeNull();
    expect(receipt.reconciliationReason).toBe('RECIPIENT_DELETED');
    await reconcileNotificationProviderFeedback();
    expect(
      (await prisma.notificationProviderFeedback.findUniqueOrThrow({ where: { id: receipt.id } }))
        .reconciliationAttempts
    ).toBe(receipt.reconciliationAttempts);
  });
  it('isolates a PostgreSQL replay failure from accepted submission, fanout accounting and the next valid receipt', async () => {
    const key = `${prefix}-failure`;
    const content = await prisma.notificationContent.create({
      data: {
        contentHash: key,
        subject: 'Fixture',
        encryptedTemplate: await encrypt('<p>Fixture</p>'),
      },
    });
    const fanout = await prisma.notificationFanout.create({
      data: {
        statusPageId: pageId,
        sourceType: 'TEST',
        sourceId: key,
        eventKey: key,
        trafficClass: 'CRITICAL',
        contentId: content.id,
      },
    });
    const intent = await critical(key, fanout.id);
    await prisma.notificationProviderFeedback.create({
      data: {
        provider: 'fixture',
        providerEventId: key,
        providerMessageId: key,
        eventType: 'DELIVERED',
        occurredAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION feedback_isolation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."providerEventId" LIKE '%-failure' AND NEW."processedAt" IS NOT NULL THEN RAISE EXCEPTION 'injected receipt failure'; END IF; RETURN NEW; END $$`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER feedback_isolation_failure BEFORE UPDATE ON "NotificationProviderFeedback" FOR EACH ROW EXECUTE FUNCTION feedback_isolation_failure()`
    );
    try {
      mocks.sendEmail.mockResolvedValue({
        success: true,
        providerMessageId: key,
        selectedProvider: 'fixture',
      });
      expect(await deliverCentralNotification(intent.id)).toMatchObject({
        success: true,
        claimed: true,
      });
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: intent.id } })).status
      ).toBe('SENT');
      expect(
        (await prisma.notificationFanout.findUniqueOrThrow({ where: { id: fanout.id } }))
          .completedTargets
      ).toBe(1);
      const failed = await prisma.notificationProviderFeedback.findUniqueOrThrow({
        where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
      });
      expect(failed.processedAt).toBeNull();
      expect(failed.reconciliationAttempts).toBe(1);
      expect(failed.reconciliationReason).toBe('RECONCILIATION_ERROR');
      const validKey = `${prefix}-valid-receipt`;
      const valid = await critical(validKey);
      mocks.sendEmail.mockResolvedValue({
        success: true,
        providerMessageId: validKey,
        selectedProvider: 'fixture',
      });
      await processCentralNotificationQueue({ trafficClasses: ['CRITICAL'], concurrency: 1 });
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: valid.id } })).status
      ).toBe('SENT');
      await prisma.notificationProviderFeedback.create({
        data: {
          provider: 'fixture',
          providerEventId: validKey,
          providerMessageId: validKey,
          eventType: 'DELIVERED',
          occurredAt: new Date(),
        },
      });
      await prisma.notificationProviderFeedback.update({
        where: { id: failed.id },
        data: { nextReconcileAt: new Date(0) },
      });
      await reconcileNotificationProviderFeedback();
      expect(
        (
          await prisma.notificationProviderFeedback.findUniqueOrThrow({
            where: { provider_providerEventId: { provider: 'fixture', providerEventId: validKey } },
          })
        ).processedAt
      ).not.toBeNull();
      await prisma.notificationProviderFeedback.update({
        where: { id: failed.id },
        data: { reconciliationAttempts: 11, nextReconcileAt: new Date(0) },
      });
      await reconcileNotificationProviderFeedback();
      const dead = await prisma.notificationProviderFeedback.findUniqueOrThrow({
        where: { id: failed.id },
      });
      expect(dead.quarantinedAt).toBeNull();
      expect(dead.reconciliationAttempts).toBe(12);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER feedback_isolation_failure ON "NotificationProviderFeedback"'
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION feedback_isolation_failure()');
    }
    await reconcileNotificationProviderFeedback(intent.id);
    const recovered = await prisma.notificationProviderFeedback.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
    });
    expect(recovered.processedAt).not.toBeNull();
    expect(recovered.quarantinedAt).toBeNull();
  });
  it.each(['DELIVERED', 'HARD_BOUNCE'] as const)(
    'recovers a provider-matched %s receipt after a 48-hour outage and exhausted infrastructure attempts',
    async type => {
      const key = `${prefix}-outage-${type}`;
      const old = new Date(Date.now() - 48 * 60 * 60_000);
      const notification = await prisma.notification.create({
        data: {
          channel: 'EMAIL',
          status: 'SENT',
          category: 'SECURITY',
          recipientId: key,
          recipientHash: key,
          sourceId: key,
          sourceType: 'AUTHENTICATION',
          templateKey: 'authentication-security-alert',
          providerMessageId: key,
          deliveryProvider: 'fixture',
        },
      });
      const alert = await prisma.authenticationAlert.create({
        data: {
          eventId: key,
          recipientId: key,
          title: 'Fixture',
          message: 'Fixture',
          notificationId: notification.id,
          acceptedAt: old,
        },
      });
      const receipt = await prisma.notificationProviderFeedback.create({
        data: {
          provider: 'fixture',
          providerEventId: key,
          providerMessageId: key,
          eventType: type,
          occurredAt: old,
          createdAt: old,
          reconciliationAttempts: 20,
          reconciliationReason:
            type === 'DELIVERED' ? 'UNMATCHED_PROVIDER_MESSAGE' : 'RECONCILIATION_ERROR',
          quarantinedAt: old,
        },
      });
      try {
        const migration = readFileSync(
          'prisma/migrations/20261014180000_restore_transient_provider_feedback/migration.sql',
          'utf8'
        );
        // The same additive repair works on already-quarantined legacy data and repeats safely.
        await prisma.$executeRawUnsafe(migration);
        await prisma.$executeRawUnsafe(migration);
        await reconcileNotificationProviderFeedback();
        const result = await prisma.notificationProviderFeedback.findUniqueOrThrow({
          where: { id: receipt.id },
        });
        expect(result.quarantinedAt).toBeNull();
        expect(result.processedAt).not.toBeNull();
        const transport = await prisma.notification.findUniqueOrThrow({
          where: { id: notification.id },
        });
        const linked = await prisma.authenticationAlert.findUniqueOrThrow({
          where: { id: alert.id },
        });
        expect(transport.status).toBe(type === 'DELIVERED' ? 'DELIVERED' : 'FAILED');
        expect(type === 'DELIVERED' ? linked.deliveredAt : linked.failedAt).toEqual(old);
      } finally {
        await prisma.authenticationAlert.delete({ where: { id: alert.id } });
      }
    }
  );
  it('defers a lock-contended receipt while critical delivery progresses and reconciles after release', async () => {
    const key = `${prefix}-locked`;
    const notification = await prisma.notification.create({
      data: {
        channel: 'EMAIL',
        status: 'SENT',
        category: 'SECURITY',
        recipientId: key,
        recipientHash: key,
        sourceId: key,
        providerMessageId: key,
        deliveryProvider: 'fixture',
      },
    });
    await prisma.notificationProviderFeedback.create({
      data: {
        provider: 'fixture',
        providerEventId: key,
        providerMessageId: key,
        eventType: 'DELIVERED',
        occurredAt: new Date(),
      },
    });
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const acquired = new Promise<void>(resolve => {
      ready = resolve;
    });
    const blocker = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "Notification" WHERE id = ${notification.id} FOR UPDATE`;
        ready();
        await held;
      },
      { timeout: 10000 }
    );
    try {
      await acquired;
      const intent = await critical(`${key}-critical`);
      mocks.sendEmail.mockResolvedValue({
        success: true,
        providerMessageId: `${key}-critical-sent`,
        selectedProvider: 'fixture',
      });
      expect(
        (await processCentralNotificationQueue({ trafficClasses: ['CRITICAL'], concurrency: 1 }))
          .succeeded
      ).toBeGreaterThanOrEqual(1);
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: intent.id } })).status
      ).toBe('SENT');
      const feedback = await prisma.notificationProviderFeedback.findUniqueOrThrow({
        where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
      });
      expect(feedback.processedAt).toBeNull();
      expect(feedback.reconciliationReason).toBe('RECONCILIATION_ERROR');
    } finally {
      release();
      await blocker;
    }
    await reconcileNotificationProviderFeedback(notification.id);
    expect(
      (
        await prisma.notificationProviderFeedback.findUniqueOrThrow({
          where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
        })
      ).processedAt
    ).not.toBeNull();
  });
  it('durably acknowledges ingestion even when replay and retry-state persistence both fail', async () => {
    const key = `${prefix}-double-failure`;
    await prisma.notification.create({
      data: {
        channel: 'EMAIL',
        status: 'SENT',
        category: 'SECURITY',
        recipientId: key,
        recipientHash: key,
        sourceId: key,
        providerMessageId: key,
        deliveryProvider: 'fixture',
      },
    });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION feedback_isolation_unavailable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."providerEventId" LIKE '%-double-failure' THEN RAISE EXCEPTION 'injected receipt storage failure'; END IF; RETURN NEW; END $$`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER feedback_isolation_unavailable BEFORE UPDATE ON "NotificationProviderFeedback" FOR EACH ROW EXECUTE FUNCTION feedback_isolation_unavailable()`
    );
    try {
      expect(
        await ingestNotificationProviderFeedback({
          provider: 'fixture',
          providerEventId: key,
          providerMessageId: key,
          type: 'DELIVERED',
          occurredAt: new Date(),
        })
      ).toMatchObject({ reason: 'deferred' });
      const stored = await prisma.notificationProviderFeedback.findUniqueOrThrow({
        where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
      });
      expect(stored.processedAt).toBeNull();
      expect(stored.reconciliationAttempts).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER feedback_isolation_unavailable ON "NotificationProviderFeedback"'
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION feedback_isolation_unavailable()');
    }
    await reconcileNotificationProviderFeedback();
    expect(
      (
        await prisma.notificationProviderFeedback.findUniqueOrThrow({
          where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
        })
      ).processedAt
    ).not.toBeNull();
  });
  it('limits cleanup to one hundred terminal records per state and preserves active evidence', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60_000);
    await prisma.notificationProviderFeedback.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        provider: 'fixture',
        providerEventId: `${prefix}-retention-${i}`,
        eventType: 'DELIVERED',
        occurredAt: old,
        processedAt: old,
      })),
    });
    await cleanNotificationProviderFeedback(now);
    expect(
      await prisma.notificationProviderFeedback.count({
        where: { providerEventId: { startsWith: `${prefix}-retention-` } },
      })
    ).toBe(1);
    await cleanNotificationProviderFeedback(now);
    expect(
      await prisma.notificationProviderFeedback.count({
        where: { providerEventId: { startsWith: `${prefix}-retention-` } },
      })
    ).toBe(0);
  });
  it('reconsiders only provider-matched unmatched quarantine when a notification is committed later', async () => {
    const key = `${prefix}-late-quarantine`;
    await prisma.notificationProviderFeedback.createMany({
      data: ['UNMATCHED_PROVIDER_MESSAGE', 'RECIPIENT_DELETED', 'INVALID_EVENT_TYPE'].map(
        reason => ({
          provider: 'fixture',
          providerEventId: `${key}-${reason}`,
          providerMessageId: key,
          eventType: 'DELIVERED',
          occurredAt: new Date(),
          quarantinedAt: new Date(),
          reconciliationReason: reason,
          reconciliationAttempts: 12,
        })
      ),
    });
    const notification = await prisma.notification.create({
      data: {
        channel: 'EMAIL',
        status: 'SENT',
        category: 'SECURITY',
        recipientId: key,
        recipientHash: key,
        sourceId: key,
        providerMessageId: key,
        deliveryProvider: 'wrong-provider',
      },
    });
    await reconcileNotificationProviderFeedback(notification.id);
    expect(
      await prisma.notificationProviderFeedback.count({
        where: { providerMessageId: key, quarantinedAt: { not: null } },
      })
    ).toBe(3);
    await prisma.notification.update({
      where: { id: notification.id },
      data: { deliveryProvider: 'fixture' },
    });
    await reconcileNotificationProviderFeedback(notification.id);
    const recovered = await prisma.notificationProviderFeedback.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: 'fixture',
          providerEventId: `${key}-UNMATCHED_PROVIDER_MESSAGE`,
        },
      },
    });
    expect(recovered.processedAt).not.toBeNull();
    expect(recovered.quarantinedAt).toBeNull();
    expect(
      await prisma.notificationProviderFeedback.count({
        where: { providerMessageId: key, quarantinedAt: { not: null } },
      })
    ).toBe(2);
  });
  it('clears an obsolete provider message ID when a later accepted submission has no message ID', async () => {
    const key = `${prefix}-no-provider-id`;
    const intent = await critical(key);
    await prisma.notification.update({
      where: { id: intent.id },
      data: {
        status: 'FAILED',
        attempts: 1,
        providerMessageId: `${key}-obsolete`,
        deliveryProvider: 'obsolete',
        nextAttemptAt: new Date(0),
      },
    });
    mocks.sendEmail.mockResolvedValue({ success: true, selectedProvider: 'fixture' });
    expect(await deliverCentralNotification(intent.id)).toMatchObject({ success: true });
    const result = await prisma.notification.findUniqueOrThrow({ where: { id: intent.id } });
    expect(result.status).toBe('SENT');
    expect(result.providerMessageId).toBeNull();
    expect(result.feedbackPending).toBe(false);
    await ingestNotificationProviderFeedback({
      provider: 'obsolete',
      providerEventId: key,
      providerMessageId: `${key}-obsolete`,
      type: 'DELIVERED',
      occurredAt: new Date(),
    });
    expect(
      (
        await prisma.notificationProviderFeedback.findUniqueOrThrow({
          where: { provider_providerEventId: { provider: 'obsolete', providerEventId: key } },
        })
      ).processedAt
    ).toBeNull();
  });
  it('fences a provider result changing after receipt lookup but before the notification lock', async () => {
    const key = `${prefix}-provider-race`;
    const notification = await prisma.notification.create({
      data: {
        channel: 'EMAIL',
        status: 'SENT',
        category: 'SECURITY',
        recipientId: key,
        recipientHash: key,
        sourceId: key,
        sourceType: 'AUTHENTICATION',
        templateKey: 'authentication-security-alert',
        providerMessageId: key,
        deliveryProvider: 'fixture',
      },
    });
    const transaction = prisma.$transaction.bind(prisma);
    const intercept = vi.spyOn(prisma, '$transaction').mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) =>
      transaction(async tx => {
        const delegate = new Proxy(tx.notification, {
          get(target, field) {
            if (field !== 'findUnique') return Reflect.get(target, field);
            return async (args: Prisma.NotificationFindUniqueArgs) => {
              const found = await target.findUnique(args);
              await prisma.notification.update({
                where: { id: notification.id },
                data: { providerMessageId: `${key}-replacement`, deliveryProvider: 'replacement' },
              });
              return found;
            };
          },
        });
        const fenced = new Proxy(tx, {
          get(target, field) {
            return field === 'notification' ? delegate : Reflect.get(target, field);
          },
        });
        return callback(fenced);
      })) as never);
    try {
      await ingestNotificationProviderFeedback({
        provider: 'fixture',
        providerEventId: key,
        providerMessageId: key,
        type: 'DELIVERED',
        occurredAt: new Date(),
      });
    } finally {
      intercept.mockRestore();
    }
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status
    ).toBe('SENT');
    expect(
      (
        await prisma.notificationProviderFeedback.findUniqueOrThrow({
          where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
        })
      ).processedAt
    ).toBeNull();
  });
  it('recovers late quarantine evidence even when the immediate post-send correlation query fails', async () => {
    const key = `${prefix}-durable-late-evidence`;
    await ingestNotificationProviderFeedback({
      provider: 'fixture',
      providerEventId: key,
      providerMessageId: key,
      type: 'DELIVERED',
      occurredAt: new Date(),
    });
    const stored = await prisma.notificationProviderFeedback.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: 'fixture', providerEventId: key } },
    });
    await prisma.notificationProviderFeedback.update({
      where: { id: stored.id },
      data: {
        createdAt: new Date(Date.now() - 48 * 60 * 60_000),
        nextReconcileAt: new Date(0),
      },
    });
    await reconcileNotificationProviderFeedback();
    expect(
      (await prisma.notificationProviderFeedback.findUniqueOrThrow({ where: { id: stored.id } }))
        .quarantinedAt
    ).not.toBeNull();
    const intent = await critical(key);
    mocks.sendEmail.mockResolvedValue({
      success: true,
      providerMessageId: key,
      selectedProvider: 'fixture',
    });
    const query = vi
      .spyOn(prisma.notificationProviderFeedback, 'findMany')
      .mockRejectedValueOnce(new Error('injected post-send query failure'));
    try {
      expect(await deliverCentralNotification(intent.id)).toMatchObject({ success: true });
    } finally {
      query.mockRestore();
    }
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: intent.id } })).feedbackPending
    ).toBe(true);
    await processCentralNotificationQueue({ trafficClasses: ['CRITICAL'], concurrency: 1 });
    const recovered = await prisma.notificationProviderFeedback.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(recovered.quarantinedAt).toBeNull();
    expect(recovered.processedAt).not.toBeNull();
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: intent.id } })).feedbackPending
    ).toBe(false);
  });
  it('benchmarks exact receipt metrics against a 100000-row backlog while critical mail drains', async () => {
    const key = `${prefix}-benchmark`;
    await prisma.$executeRaw`INSERT INTO "NotificationProviderFeedback" (id,provider,"providerEventId","eventType","occurredAt","createdAt","reconciliationAttempts","quarantinedAt")
      SELECT ${key} || '-' || i, 'fixture', ${key} || '-' || i, 'DELIVERED', NOW(), NOW(), CASE WHEN i % 2 = 0 THEN 1 ELSE 0 END,
        CASE WHEN i % 4 = 0 THEN NOW() ELSE NULL END FROM generate_series(1,100000) i`;
    try {
      await prisma.$executeRawUnsafe('ANALYZE "NotificationProviderFeedback"');
      const explain = await prisma.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
        Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${providerFeedbackMetricsQuery}`
      );
      const intent = await critical(`${key}-critical`);
      mocks.sendEmail.mockResolvedValue({
        success: true,
        providerMessageId: `${key}-sent`,
        selectedProvider: 'fixture',
      });
      const startedAt = performance.now();
      const [counts, delivery] = await Promise.all([
        collectProviderFeedbackMetrics(),
        processCentralNotificationQueue({ trafficClasses: ['CRITICAL'], concurrency: 1 }),
      ]);
      expect(counts.pending).toBeGreaterThanOrEqual(74900);
      expect(counts.quarantined).toBeGreaterThanOrEqual(25000);
      expect(delivery.succeeded).toBeGreaterThanOrEqual(1);
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: intent.id } })).status
      ).toBe('SENT');
      mkdirSync('plans/certification', { recursive: true });
      writeFileSync(
        'plans/certification/enterprise-sso-2.1-receipt-metrics.json',
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            rows: 100000,
            scope:
              'Isolated PostgreSQL; mocked provider send/admission; concurrent real queue dispatch and exact metric collector',
            concurrentDurationMs: performance.now() - startedAt,
            counts,
            explain,
            criticalDrained: true,
            serverStatementTimeoutMs: 500,
          },
          null,
          2
        ) + '\n'
      );
    } finally {
      await prisma.notificationProviderFeedback.deleteMany({
        where: { providerEventId: { startsWith: key } },
      });
    }
  });
  it('quarantines exhausted and old unmatched events and retains searchable evidence for ninety days', async () => {
    const now = new Date();
    for (const [suffix, data] of [
      ['exhausted', { reconciliationAttempts: 11 }],
      ['old', { createdAt: new Date(now.getTime() - 25 * 60 * 60_000) }],
    ] as const) {
      const key = `${prefix}-${suffix}`;
      await prisma.notificationProviderFeedback.create({
        data: {
          provider: 'fixture',
          providerEventId: key,
          providerMessageId: key,
          eventType: 'DELIVERED',
          occurredAt: now,
          ...data,
        },
      });
    }
    await reconcileNotificationProviderFeedback();
    const exhausted = await prisma.notificationProviderFeedback.findMany({
      where: { providerEventId: { in: [`${prefix}-exhausted`, `${prefix}-old`] } },
    });
    expect(exhausted.every(row => row.quarantinedAt)).toBe(true);
    const pending = await prisma.notificationProviderFeedback.create({
      data: {
        provider: 'fixture',
        providerEventId: `${prefix}-pending`,
        eventType: 'DELIVERED',
        occurredAt: now,
      },
    });
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60_000);
    await prisma.notificationProviderFeedback.updateMany({
      where: { id: { in: exhausted.map(row => row.id) } },
      data: { quarantinedAt: old },
    });
    const completed = await prisma.notificationProviderFeedback.create({
      data: {
        provider: 'fixture',
        providerEventId: `${prefix}-completed-old`,
        eventType: 'DELIVERED',
        occurredAt: old,
        processedAt: old,
      },
    });
    await cleanNotificationProviderFeedback(now);
    expect(
      await prisma.notificationProviderFeedback.count({
        where: { id: { in: [...exhausted.map(row => row.id), completed.id] } },
      })
    ).toBe(0);
    expect(
      await prisma.notificationProviderFeedback.findUnique({ where: { id: pending.id } })
    ).not.toBeNull();
  });
});
