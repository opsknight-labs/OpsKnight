import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import prisma from '@/lib/prisma';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { processEvent } from '@/lib/events';
import {
  acceptPostgresEvent,
  claimPostgresEvents,
  completeProcessingReceipt,
  failPostgresEvent,
  lockProcessingReceipt,
} from '@/lib/ingestion/postgres';
import {
  decodeEnvelope,
  IngestionConflictError,
  IngestionLeaseLostError,
  IngestionUnavailableError,
} from '@/lib/ingestion/contract';
import { consumeIngestionBatch } from '@/lib/ingestion/worker';
import { applyIngestionCommand } from '@/lib/ingestion/operations';
import { compileAutomation } from '@/lib/automation/compiler';
import { emptySnapshot } from '@/lib/automation/contract';
import { checkIngestionQuota } from '@/lib/ingestion/quota';
import { pruneCompletedIngestionPayloads } from '@/lib/ingestion/retention';
import { checksum } from '@/lib/automation/cache';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';

// Fail closed rather than skipping certification or truncating a shared database.
const database = new URL(process.env.DATABASE_URL ?? 'http://missing');
if (
  !['127.0.0.1', 'localhost'].includes(database.hostname) ||
  !database.pathname.startsWith('/ingestion_test')
) {
  throw new Error('Ingestion certification requires an isolated localhost ingestion_test database');
}

let serviceId: string;
let actorId: string;
function envelope(
  key = 'outage',
  action: 'trigger' | 'resolve' = 'trigger'
): IntegrationEventEnvelope {
  return {
    serviceId,
    integrationId: 'integration',
    integrationType: 'WEBHOOK',
    receivedAt: new Date(),
    providerPayload: { environment: 'prod' },
    event: {
      event_action: action,
      dedup_key: key,
      payload: { summary: 'Database unavailable', source: 'database', severity: 'critical' },
    },
  };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Ingestion certifier',
      email: `ingestion-${randomUUID()}@example.test`,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  actorId = user.id;
});
beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE "IngestionReceipt"`;
  await prisma.ingestionBudget.updateMany({ data: { pending: 0, bytes: 0 } });
  await prisma.systemConfig.deleteMany({ where: { key: 'ingestion_control' } });
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: false },
    update: { automationEnabled: false },
  });
  serviceId = (await prisma.service.create({ data: { name: `Ingestion ${randomUUID()}` } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('PostgreSQL ingestion durability', () => {
  it('expires only completed raw payloads and preserves receipt idempotency and pending data', async () => {
    const input = envelope('retention');
    const completed = await acceptPostgresEvent(input, 'retained-id');
    await consumeIngestionBatch();
    const pending = await acceptPostgresEvent(envelope('pending'), 'pending');
    await prisma.ingestionReceipt.update({
      where: { id: completed.receiptId },
      data: { completedAt: new Date(0) },
    });
    expect(await pruneCompletedIngestionPayloads()).toBe(1);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: completed.receiptId } }))
        .envelope
    ).toBeNull();
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: pending.receiptId } }))
        .envelope
    ).not.toBeNull();
    expect(await acceptPostgresEvent(input, 'retained-id')).toEqual(completed);
    expect(
      await prisma.auditLog.count({ where: { action: 'ingestion.payload_retention' } })
    ).toBeGreaterThan(0);
  });
  it('reserves shared quota blocks and never overshoots under concurrent requests', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    process.env.OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE = '23';
    try {
      const key = `quota-${randomUUID()}:events`;
      const results = await Promise.all(
        Array.from({ length: 40 }, () => checkIngestionQuota(key, 120, 60000))
      );
      expect(results.filter(result => result.allowed)).toHaveLength(23);
      const counters = await prisma.rateLimit.findMany({
        where: { key: { startsWith: `ingestion-quota:${key}:` } },
      });
      expect(counters).toHaveLength(1);
      expect(counters[0].count).toBe(23);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
      delete process.env.OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE;
    }
  });
  it('survives SIGKILL after staging the actual incident, receipt and outbox transaction', async () => {
    await acceptPostgresEvent(envelope(), 'kill');
    const jobsBefore = await prisma.backgroundJob.count();
    const child = fork('scripts/ingestion/crash-worker.cjs', [], {
      silent: true,
      env: process.env,
    });
    try {
      const staged = await new Promise<{ receiptId: string }>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Crash worker did not stage transaction')),
          20000
        );
        child.once('message', message => {
          clearTimeout(timeout);
          resolve(message as { receiptId: string });
        });
        child.once('exit', code => {
          clearTimeout(timeout);
          reject(new Error(`Crash worker exited ${code}`));
        });
      });
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(0);
      expect(await prisma.backgroundJob.count()).toBe(jobsBefore);
      expect(
        (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: staged.receiptId } }))
          .status
      ).toBe('PROCESSING');
      await prisma.ingestionReceipt.update({
        where: { id: staged.receiptId },
        data: { leaseExpiresAt: new Date(0) },
      });
      await consumeIngestionBatch();
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(1);
      expect(await prisma.alert.count({ where: { serviceId } })).toBe(1);
      expect(
        (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: staged.receiptId } }))
          .status
      ).toBe('COMPLETED');
    } finally {
      if (!child.killed) child.kill('SIGKILL');
    }
  });

  it('drains a hot-key storm with concurrent consumers without duplicate logical incidents', async () => {
    const submissions = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        acceptPostgresEvent(envelope('storm'), `storm-${index}`)
      )
    );
    for (let i = 0; i < 40; i += 1) {
      await Promise.all([
        consumeIngestionBatch(4),
        consumeIngestionBatch(4),
        consumeIngestionBatch(4),
      ]);
      if ((await prisma.ingestionReceipt.count({ where: { status: { not: 'COMPLETED' } } })) === 0)
        break;
    }
    expect(await prisma.ingestionReceipt.count({ where: { status: 'COMPLETED' } })).toBe(
      submissions.length
    );
    expect(await prisma.alert.count({ where: { serviceId } })).toBe(submissions.length);
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(1);
    expect(
      (await prisma.ingestionBudget.aggregate({ _sum: { pending: true, bytes: true } }))._sum
    ).toEqual({ pending: 0, bytes: BigInt(0) });
  });

  it('dead-letters an unknown envelope version without skipping later same-key events', async () => {
    const first = await acceptPostgresEvent(envelope('invalid'));
    await acceptPostgresEvent(envelope('invalid', 'resolve'));
    await prisma.ingestionReceipt.update({
      where: { id: first.receiptId },
      data: { envelope: { version: 2 } },
    });
    await consumeIngestionBatch();
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: first.receiptId } })).status
    ).toBe('DEAD');
    expect(await consumeIngestionBatch()).toBe(0);
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(0);
  });
  it('durably accepts without creating an incident and detects conflicting deliveries', async () => {
    const input = envelope();
    const first = await acceptPostgresEvent(input, 'delivery');
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(0);
    expect(await acceptPostgresEvent({ ...input, receivedAt: new Date() }, 'delivery')).toEqual(
      first
    );
    await expect(acceptPostgresEvent(envelope('different'), 'delivery')).rejects.toBeInstanceOf(
      IngestionConflictError
    );
    expect(await prisma.ingestionReceipt.count()).toBe(1);
  });

  it('serializes concurrent duplicate submissions into one receipt and reservation', async () => {
    const input = envelope();
    const receipts = await Promise.all(
      Array.from({ length: 12 }, () => acceptPostgresEvent(input, 'same-delivery'))
    );
    expect(new Set(receipts.map(row => row.receiptId)).size).toBe(1);
    expect((await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending).toBe(
      1
    );
  });

  it('claims independent keys concurrently while preserving order across retries and dead letters', async () => {
    const first = await acceptPostgresEvent(envelope('hot'), 'first');
    await acceptPostgresEvent(envelope('hot', 'resolve'), 'second');
    await acceptPostgresEvent(envelope('cold'), 'third');
    const claims = await claimPostgresEvents(16);
    expect(claims).toHaveLength(2);
    const hot = claims.find(row => row.id === first.receiptId)!;
    await failPostgresEvent({ id: hot.id, token: hot.leaseToken }, 10, false);
    expect(await claimPostgresEvents(16)).toHaveLength(0);
    await applyIngestionCommand({ action: 'replay', receiptId: hot.id }, actorId);
    const [replayed] = await claimPostgresEvents(16);
    expect(replayed.id).toBe(hot.id);
    expect(await prisma.auditLog.count({ where: { action: 'ingestion.replay' } })).toBeGreaterThan(
      0
    );
  });

  it('recovers expired leases and fences the previous owner', async () => {
    await acceptPostgresEvent(envelope());
    const [first] = await claimPostgresEvents(1);
    await prisma.ingestionReceipt.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const [second] = await claimPostgresEvents(1);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(
      runReadCommittedTransaction(tx =>
        lockProcessingReceipt(tx, { id: first.id, token: first.leaseToken })
      )
    ).rejects.toBeInstanceOf(IngestionLeaseLostError);
    const decoded = decodeEnvelope(second.envelope);
    await processEvent(decoded.event, decoded.serviceId, decoded.integrationId, decoded, {
      id: second.id,
      token: second.leaseToken,
    });
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: second.id } })).status
    ).toBe('COMPLETED');
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(1);
  });

  it('rolls back the incident, outbox, receipt and budget together on an interrupted transaction', async () => {
    await acceptPostgresEvent(envelope());
    const [claim] = await claimPostgresEvents(1);
    const lease = { id: claim.id, token: claim.leaseToken };
    await expect(
      runReadCommittedTransaction(async tx => {
        await lockProcessingReceipt(tx, lease);
        await tx.incident.create({ data: { title: 'must roll back', serviceId } });
        await completeProcessingReceipt(tx, lease, { action: 'created' });
        throw new Error('worker interrupted');
      })
    ).rejects.toThrow('worker interrupted');
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(0);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: claim.id } })).status
    ).toBe('PROCESSING');
    expect((await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending).toBe(
      1
    );
  });

  it('retains the resolve-before-trigger rule across a long processing delay', async () => {
    const resolve = envelope('ordered', 'resolve');
    resolve.receivedAt = new Date(Date.now() - 3600000);
    const trigger = envelope('ordered');
    trigger.receivedAt = new Date(resolve.receivedAt.getTime() + 60000);
    await acceptPostgresEvent(resolve, 'resolve');
    await acceptPostgresEvent(trigger, 'trigger');
    await consumeIngestionBatch();
    await consumeIngestionBatch();
    const incidents = await prisma.incident.findMany({ where: { serviceId } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe('RESOLVED');
    expect(await prisma.ingestionReceipt.count({ where: { status: 'COMPLETED' } })).toBe(2);
  });

  it('does not apply an old buffered resolve beyond the five minute acceptance window', async () => {
    const resolve = envelope('stale', 'resolve');
    resolve.receivedAt = new Date(Date.now() - 3600000);
    const trigger = envelope('stale');
    trigger.receivedAt = new Date(resolve.receivedAt.getTime() + 6 * 60000);
    await acceptPostgresEvent(resolve);
    await acceptPostgresEvent(trigger);
    await consumeIngestionBatch();
    await consumeIngestionBatch();
    expect((await prisma.incident.findFirstOrThrow({ where: { serviceId } })).status).toBe('OPEN');
  });

  it('keeps Service Automation evaluation and its immutable decision in the processing transaction', async () => {
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: true },
    });
    const snapshot = {
      ...emptySnapshot,
      rules: [
        {
          id: 'route',
          name: 'Do not escalate',
          enabled: true,
          phase: 'ROUTE' as const,
          conditions: [],
          actions: [{ type: 'NO_ESCALATION' as const }],
        },
      ],
    };
    const { compiled } = compileAutomation(snapshot);
    const version = await prisma.automationVersion.create({
      data: {
        serviceId,
        versionNumber: 1,
        snapshot,
        compiledSnapshot: compiled,
        checksum: checksum(compiled),
        publishedBy: actorId,
        lintReport: [],
      },
    });
    await prisma.serviceAutomationConfig.create({
      data: { serviceId, mode: 'LIVE', activeVersionId: version.id },
    });
    const receipt = await acceptPostgresEvent(envelope(), 'automation');
    const newerVersion = await prisma.automationVersion.create({
      data: {
        serviceId,
        versionNumber: 2,
        snapshot,
        compiledSnapshot: compiled,
        checksum: checksum(compiled),
        publishedBy: actorId,
        lintReport: [],
      },
    });
    await prisma.serviceAutomationConfig.update({
      where: { serviceId },
      data: { activeVersionId: newerVersion.id },
    });
    await consumeIngestionBatch();
    const decision = await prisma.incidentAutomationDecision.findFirstOrThrow({
      where: { serviceId },
    });
    expect(decision.versionId).toBe(version.id);
    expect(decision.routeType).toBe('NO_ESCALATION');
    const incident = await prisma.incident.findUniqueOrThrow({
      where: { id: decision.incidentId },
    });
    expect(incident.automationSourceRestricted).toBe(true);
    const alerts = await prisma.alert.count({ where: { serviceId } });
    const jobs = await prisma.backgroundJob.count();
    expect(await acceptPostgresEvent(envelope(), 'automation')).toEqual(receipt);
    expect(await consumeIngestionBatch()).toBe(0);
    expect(await prisma.incidentAutomationDecision.count({ where: { serviceId } })).toBe(1);
    expect(await prisma.alert.count({ where: { serviceId } })).toBe(alerts);
    expect(await prisma.backgroundJob.count()).toBe(jobs);
    await acceptPostgresEvent(envelope('emergency'), 'emergency');
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: false },
    });
    await consumeIngestionBatch();
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(2);
    expect(await prisma.incidentAutomationDecision.count({ where: { serviceId } })).toBe(1);
  });

  it('enforces bounded capacity without deleting accepted events and releases reservations on completion', async () => {
    process.env.OPSKNIGHT_INGESTION_MAX_PENDING = '64';
    try {
      await acceptPostgresEvent(envelope('bounded'), 'first');
      await expect(acceptPostgresEvent(envelope('bounded'), 'second')).rejects.toBeInstanceOf(
        IngestionUnavailableError
      );
      expect(await prisma.ingestionReceipt.count()).toBe(1);
      await consumeIngestionBatch();
      await expect(acceptPostgresEvent(envelope('bounded'), 'second')).resolves.toMatchObject({
        action: 'accepted',
      });
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MAX_PENDING;
    }
  });

  it('pauses new admission while allowing retries of durable receipts and processing to drain', async () => {
    const input = envelope();
    const accepted = await acceptPostgresEvent(input, 'existing');
    await applyIngestionCommand({ action: 'pause' }, actorId);
    await expect(acceptPostgresEvent(input, 'new')).rejects.toBeInstanceOf(
      IngestionUnavailableError
    );
    expect(await acceptPostgresEvent(input, 'existing')).toEqual(accepted);
    await consumeIngestionBatch();
    await applyIngestionCommand({ action: 'resume' }, actorId);
    await expect(acceptPostgresEvent(input, 'new')).resolves.toMatchObject({ action: 'accepted' });
  });
});
