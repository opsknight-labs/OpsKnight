import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import prisma from '@/lib/prisma';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { processEvent, processIntegrationEvent } from '@/lib/events';
import {
  acceptPostgresEvent,
  claimPostgresEvents,
  completeProcessingReceipt,
  failPostgresEvent,
  lockProcessingReceipt,
  backfillIngestionOrdering,
} from '@/lib/ingestion/postgres';
import {
  decodeEnvelope,
  IngestionConflictError,
  IngestionLeaseLostError,
  IngestionUnavailableError,
} from '@/lib/ingestion/contract';
import { consumeIngestionBatch, stopIngestionWorker } from '@/lib/ingestion/worker';
import { applyIngestionCommand } from '@/lib/ingestion/operations';
import { compileAutomation } from '@/lib/automation/compiler';
import { emptySnapshot } from '@/lib/automation/contract';
import { checkIngestionQuota } from '@/lib/ingestion/quota';
import { pruneCompletedIngestionPayloads } from '@/lib/ingestion/retention';
import { checksum } from '@/lib/automation/cache';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { acquireRetentionResourceLock } from '@/lib/retention/resource-lock';

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
  it('lets a concentrated partition use all bounded backlog shards', async () => {
    process.env.OPSKNIGHT_INGESTION_MAX_PENDING = '64';
    try {
      for (let index = 0; index < 64; index++)
        await acceptPostgresEvent(envelope('concentrated-storm'), `storm-${index}`);
      const receipts = await prisma.ingestionReceipt.findMany();
      expect(receipts).toHaveLength(64);
      expect(new Set(receipts.map(receipt => receipt.budgetShard)).size).toBe(64);
      await expect(
        acceptPostgresEvent(envelope('concentrated-storm'), 'overflow')
      ).rejects.toBeInstanceOf(IngestionUnavailableError);
      expect(await consumeIngestionBatch()).toBe(1);
      await acceptPostgresEvent(envelope('concentrated-storm'), 'released-slot');
      const budgets = await prisma.ingestionBudget.findMany();
      expect(budgets.reduce((total, budget) => total + budget.pending, 0)).toBe(64);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MAX_PENDING;
    }
  });

  it('cannot prune evidence while hold creation owns the shared retention lock', async () => {
    const receipt = await acceptPostgresEvent(envelope('hold-race'), 'hold-race');
    await consumeIngestionBatch();
    const incident = await prisma.incident.findFirstOrThrow({ where: { serviceId } });
    await prisma.ingestionReceipt.update({
      where: { id: receipt.receiptId },
      data: { completedAt: new Date(0) },
    });
    let locked!: () => void;
    let release!: () => void;
    const lockAcquired = new Promise<void>(resolve => {
      locked = resolve;
    });
    const releaseLock = new Promise<void>(resolve => {
      release = resolve;
    });
    const creation = prisma.$transaction(async tx => {
      await acquireRetentionResourceLock(tx, 'INCIDENT', incident.id);
      locked();
      await releaseLock;
      await tx.dataRetentionHold.create({
        data: {
          scopeType: 'INCIDENT',
          scopeId: incident.id,
          reason: 'Concurrent preservation hold',
          createdById: actorId,
        },
      });
    });
    await lockAcquired;
    try {
      expect(await pruneCompletedIngestionPayloads()).toBe(0);
    } finally {
      release();
      await creation;
    }
    expect(await pruneCompletedIngestionPayloads()).toBe(0);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } }))
        .envelope
    ).not.toBeNull();
  });
  it('upgrades malformed dead letters without blocking unrelated services or decoding archived payloads', async () => {
    const old = await acceptPostgresEvent(envelope('old-invalid'), 'old-invalid');
    const archived = await acceptPostgresEvent(envelope('old-archived'), 'old-archived');
    await prisma.ingestionReceipt.updateMany({
      where: { id: { in: [old.receiptId, archived.receiptId] } },
      data: { orderingKeys: [], status: 'DEAD', envelope: { version: 2 } },
    });
    await applyIngestionCommand(
      {
        action: 'archive',
        receiptId: archived.receiptId,
        reason: 'Archive before ordering upgrade fixture',
        confirmDiscardAcceptedEvent: true,
      },
      actorId
    );
    await expect(backfillIngestionOrdering()).resolves.toBeUndefined();
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: old.receiptId } }))
        .orderingKeys
    ).toEqual([`unidentified:${serviceId}`]);
    await acceptPostgresEvent(envelope('blocked-same-service'), 'blocked');
    const otherService = await prisma.service.create({
      data: { name: `Unrelated ${randomUUID()}` },
    });
    const other = await acceptPostgresEvent(
      { ...envelope('unrelated'), serviceId: otherService.id },
      'unrelated'
    );
    const claims = await claimPostgresEvents(10);
    expect(claims.map(row => row.id)).toEqual([other.receiptId]);
  });
  it('orders unkeyed and explicit fallback aliases as the same logical incident', async () => {
    const trigger = envelope('');
    const data = trigger.event.payload;
    const alias = `unkeyed-${createHash('sha256')
      .update(
        JSON.stringify({
          source: data.source,
          summary: data.summary,
          details: data.custom_details ?? null,
        })
      )
      .digest('hex')}`;
    const resolve = envelope(alias, 'resolve');
    resolve.receivedAt = new Date(trigger.receivedAt.getTime() + 1000);
    await acceptPostgresEvent(trigger, 'alias-trigger');
    await acceptPostgresEvent(resolve, 'alias-resolve');
    expect(await consumeIngestionBatch(2)).toBe(1);
    expect(await consumeIngestionBatch(2)).toBe(1);
    expect((await prisma.incident.findFirstOrThrow({ where: { serviceId } })).status).toBe(
      'RESOLVED'
    );
  });

  it('dead-letters after ten abandoned claims and retains FIFO blocking until disposition', async () => {
    const first = await acceptPostgresEvent(envelope('crashing'), 'crashing');
    await acceptPostgresEvent(envelope('crashing', 'resolve'), 'next');
    for (let attempt = 1; attempt <= 10; attempt++) {
      const claims = await claimPostgresEvents(4);
      expect(claims).toHaveLength(1);
      expect(claims[0].attempts).toBe(attempt);
      await prisma.ingestionReceipt.update({
        where: { id: first.receiptId },
        data: { leaseExpiresAt: new Date(0) },
      });
    }
    expect(await claimPostgresEvents(4)).toHaveLength(0);
    expect(
      await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: first.receiptId } })
    ).toMatchObject({
      status: 'DEAD',
      attempts: 10,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: 'RETRIES_EXHAUSTED',
    });
    expect(await claimPostgresEvents(4)).toHaveLength(0);
    await applyIngestionCommand(
      {
        action: 'archive',
        receiptId: first.receiptId,
        reason: 'Explicit test disposition of poison event',
        confirmDiscardAcceptedEvent: true,
      },
      actorId
    );
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: first.receiptId } })).envelope
    ).toBeNull();
    expect(await consumeIngestionBatch()).toBe(1);
  });

  it('preserves held incident evidence until its retention hold is released', async () => {
    const receipt = await acceptPostgresEvent(envelope('held'), 'held');
    await consumeIngestionBatch();
    const incident = await prisma.incident.findFirstOrThrow({ where: { serviceId } });
    await prisma.ingestionReceipt.update({
      where: { id: receipt.receiptId },
      data: { completedAt: new Date(0) },
    });
    const hold = await prisma.dataRetentionHold.create({
      data: {
        scopeType: 'INCIDENT',
        scopeId: incident.id,
        reason: 'Evidence preservation',
        createdById: actorId,
      },
    });
    expect(await pruneCompletedIngestionPayloads()).toBe(0);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } }))
        .envelope
    ).not.toBeNull();
    await prisma.dataRetentionHold.update({
      where: { id: hold.id },
      data: { releasedAt: new Date() },
    });
    expect(await pruneCompletedIngestionPayloads()).toBe(1);
  });

  it('archives orphaned dead-letter data only through explicit audited disposition', async () => {
    const receipt = await acceptPostgresEvent(envelope('orphan'), 'orphan');
    await prisma.service.delete({ where: { id: serviceId } });
    const [claim] = await claimPostgresEvents(1);
    await failPostgresEvent({ id: claim.id, token: claim.leaseToken }, 10, false);
    await expect(
      applyIngestionCommand(
        {
          action: 'archive',
          receiptId: receipt.receiptId,
          reason: 'Orphaned deleted service payload minimization',
          confirmDiscardAcceptedEvent: true,
        },
        actorId
      )
    ).resolves.toMatchObject({ action: 'archive' });
    expect(
      await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } })
    ).toMatchObject({ status: 'ARCHIVED', envelope: null });
    expect((await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending).toBe(
      0
    );
    expect(await prisma.auditLog.count({ where: { action: 'ingestion.archive' } })).toBeGreaterThan(
      0
    );
  });
  it('keeps an image-only upgrade synchronous and accepts legacy payload sizes', async () => {
    const input = envelope('legacy');
    input.event.payload.custom_details = { blob: 'x'.repeat(300000) };
    const result = await processIntegrationEvent(input);
    expect(result.action).toBe('triggered');
    expect(result.incident?.serviceId).toBe(serviceId);
    expect('receiptId' in result).toBe(false);
    expect(await prisma.ingestionReceipt.count()).toBe(0);
  });

  it('changes to durable acceptance only after explicit activation', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    try {
      const result = await processIntegrationEvent(envelope('opt-in'));
      expect(result.action).toBe('accepted');
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(0);
      await consumeIngestionBatch();
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(1);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });

  it('does not publish an ingestion-worker heartbeat when the worker was never started', async () => {
    const before = await prisma.runtimeWorkerHeartbeat.count({ where: { lane: 'ingestion' } });
    await stopIngestionWorker();
    expect(await prisma.runtimeWorkerHeartbeat.count({ where: { lane: 'ingestion' } })).toBe(
      before
    );
  });
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
      const allowedByWindow = new Map<number, number>();
      for (const result of results.filter(result => result.allowed))
        allowedByWindow.set(result.resetAt, (allowedByWindow.get(result.resetAt) ?? 0) + 1);
      expect(results.some(result => result.allowed)).toBe(true);
      for (const count of allowedByWindow.values()) expect(count).toBeLessThanOrEqual(23);
      const counters = await prisma.rateLimit.findMany({
        where: { key: { startsWith: `ingestion-quota:${key}:` } },
      });
      // The concurrent run may straddle a real database minute boundary.
      expect(counters.length).toBeGreaterThanOrEqual(1);
      for (const counter of counters) expect(counter.count).toBeLessThanOrEqual(23);
      if (counters.length === 1) expect(counters[0].count).toBe(23);
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
