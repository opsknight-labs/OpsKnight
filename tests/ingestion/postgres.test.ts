import { readIngestionAdmissionSettings } from '@/lib/ingestion/admission-settings';
import { getIngestionAutomationConfigs } from '@/lib/automation/settings';
import { resolveSupportHours } from '@/lib/incidents/support-hours';
import { finalizeEscalationExecution } from '@/lib/escalation/repository';
import { dispatchIncidentEffects } from '@/lib/incident-effect-dispatch';
import { readPublishedIncidentPolicies, readPublishedClassificationPolicies, readPublishedSlaPolicies, readPublishedSupportPolicies } from '@/lib/incident-policies/published';
import { resolveIncidentClassification } from '@/lib/incidents/classification';
import { resolveNewIncidentSlaContract } from '@/lib/incident-sla/contract';
import { prepareReceiptInsert, type ReceiptInsert } from '@/lib/ingestion/receipt-insert';
import { processEventSideEffect } from '@/lib/event-side-effects';
import { reserveIngestionBudget, reserveIngestionBudgets } from '@/lib/ingestion/budget';
import { getMaintenanceClient, disconnectMaintenanceClient } from '@/lib/maintenance/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import prisma from '@/lib/prisma';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { processEvent, processIntegrationEvent, processIntegrationBatch } from '@/lib/events';
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
  encodeEnvelope,
  IngestionConflictError,
  IngestionLeaseLostError,
  IngestionUnavailableError,
} from '@/lib/ingestion/contract';
import {
  consumeIngestionBatch,
  startIngestionWorker,
  stopIngestionWorker,
} from '@/lib/ingestion/worker';
import { hasHealthyDedicatedIngestionWorker } from '@/lib/ingestion/fallback';
import { getIngestionWorkerHealth } from '@/lib/ingestion/worker-health';
import { acquireDurableTextAdvisoryLocks } from '@/lib/db-locks';
import { lockEventDedupKeys } from '@/lib/incidents/event-identity';
import { applyIngestionCommand, ingestionSnapshot } from '@/lib/ingestion/operations';
import { compileAutomation } from '@/lib/automation/compiler';
import { emptySnapshot } from '@/lib/automation/contract';
import { checkIngestionQuota } from '@/lib/ingestion/quota';
import {
  pruneCompletedIngestionPayloads,
  pruneSharedIngestionPayloads,
  pruneExpiredIngestionReceipts,
  pruneExpiredIngestionBatches,
  pruneInactiveIngestionQuotas,
} from '@/lib/ingestion/retention';
import { checksum } from '@/lib/automation/cache';
import { prepareAutomation, type IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { collectIngestionQueueMetrics } from '@/lib/ingestion/metrics';
import { acceptPostgresBatch, decodeReceiptEnvelope } from '@/lib/ingestion/batches';
import { withIngestionDelivery } from '@/lib/ingestion/admission';
import { transformPrometheusToEvent, type PrometheusAlert } from '@/lib/integrations/prometheus';
import { acquireRetentionResourceLock } from '@/lib/retention/resource-lock';
import { getIngestionPolicy } from '@/lib/ingestion/policy';
import { runtimeOperationalMetrics } from '@/lib/metrics/operational/registry';
import {
  claimPendingJobs,
  claimPendingOperationalJobs,
  GENERAL_WORKER_EXCLUDED_JOB_TYPES,
  markJobCompleted,
  processJob,
  processPendingJobsByType,
} from '@/lib/jobs/queue';
import {
  ensureWarRoomDelivery,
  warRoomIdempotencyKey,
  claimWarRoomDelivery,
  claimWarRoomDeliveryById,
  completeWarRoomDelivery,
} from '@/lib/war-room/delivery';

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

async function blockIncidentIdentity(key: string) {
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>(resolve => {
    acquired = resolve;
  });
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  const done = prisma.$transaction(
    async tx => {
      await lockEventDedupKeys(tx, serviceId, [`integration:${key}`, key]);
      acquired();
      await hold;
    },
    { timeout: 15000 }
  );
  await Promise.race([
    ready,
    done.then(() => {
      throw new Error('Lock fixture ended early');
    }),
  ]);
  return { release, done };
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
  await prisma.$executeRaw`TRUNCATE "IngestionOrderingHead", "IngestionReceipt" CASCADE`;
  await prisma.ingestionBatch.deleteMany();
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
  await disconnectMaintenanceClient();
  await prisma.$disconnect();
});

describe('PostgreSQL ingestion durability', () => {
  it('arms a policy attached while new incident creation waits on its dedup lock', async () => {
    const key = 'policy-attached-during-lock';
    const block = await blockIncidentIdentity(key);
    const pending = processEvent(envelope(key).event, serviceId, 'integration');
    void pending.catch(() => undefined);
    try {
      await expect.poll(async () => {
        const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND wait_event_type = 'Lock' AND wait_event = 'advisory'
        `;
        return row.waiting;
      }).toBeGreaterThan(0);
      const policy = await prisma.escalationPolicy.create({ data: {
        name: `Owned policy race ${randomUUID()}`,
        steps: { create: { stepOrder: 0, delayMinutes: 5, targetType: 'USER', targetUserId: actorId, notificationChannels: [] } },
      } });
      await prisma.service.update({ where: { id: serviceId }, data: { escalationPolicyId: policy.id } });
      block.release();
      await block.done;
      const result = await pending;
      if (!('incident' in result) || !result.incident) throw new Error('Expected incident');
      const incident = await prisma.incident.findUniqueOrThrow({ where: { id: result.incident.id } });
      expect(incident.escalationStatus).toBe('ESCALATING');
      expect(incident.currentEscalationStep).toBe(0);
      expect(incident.nextEscalationAt?.getTime()).toBe(incident.createdAt.getTime() + 5 * 60000);
      const jobs = await prisma.backgroundJob.findMany({ where: {
        type: 'ESCALATION', payload: { path: ['incidentId'], equals: incident.id },
      } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].scheduledAt).toEqual(incident.nextEscalationAt);
    } finally {
      block.release();
      await block.done;
      await pending.catch(() => undefined);
    }
  });

  it('avoids redundant routing reads for a newly created incident without Automation or a policy', async () => {
    const previous = await prisma.systemSettings.findUnique({ where: { id: 'default' }, select: { automationEnabled: true } });
    await prisma.systemSettings.upsert({ where: { id: 'default' }, create: { automationEnabled: false }, update: { automationEnabled: false } });
    let active = true, serviceReads = 0, decisionReads = 0;
    prisma.$on('query', event => {
      if (!active || !event.query.trimStart().startsWith('SELECT')) return;
      if (event.query.includes('"Service"')) serviceReads++;
      if (event.query.includes('"IncidentAutomationDecision"')) decisionReads++;
    });
    try {
      const result = await processEvent(envelope('new-no-policy-routing').event, serviceId, 'integration');
      expect(result.action).toBe('triggered');
      await expect.poll(() => serviceReads).toBe(1);
      expect(decisionReads).toBe(0);
      if (!('incident' in result) || !result.incident) throw new Error('Expected incident');
      const jobs = await prisma.backgroundJob.findMany({ where: { payload: { path: ['incidentId'], equals: result.incident.id } } });
      expect(jobs.some(job => (job.payload as Prisma.JsonObject).effect === 'TRIGGER_ESCALATION_NOTIFICATIONS')).toBe(true);
      expect(jobs.some(job => job.type === 'RUNBOOK')).toBe(true);
      expect(jobs.some(job => job.type === 'ESCALATION')).toBe(false);
    } finally {
      active = false;
      await prisma.systemSettings.update({ where: { id: 'default' }, data: { automationEnabled: previous?.automationEnabled ?? false } });
    }
  });

  it('compacts ordinary defaults while independently retaining critical and Runbook work', async () => {
    const result = await processEvent(envelope('compact-default').event, serviceId, 'integration');
    expect(result.action).toBe('triggered');
    if (!('incident' in result) || !result.incident) throw new Error('Expected a new incident');
    const jobs = await prisma.backgroundJob.findMany({ where: { payload: { path: ['incidentId'], equals: result.incident!.id } } });
    expect(jobs.filter(job => job.type === 'SCHEDULED_TASK')).toHaveLength(2);
    expect(jobs.filter(job => job.type === 'RUNBOOK')).toHaveLength(1);
    const payloads = jobs.map(job => job.payload as Prisma.JsonObject);
    expect(payloads.some(payload => payload.effect === 'TRIGGER_ESCALATION_NOTIFICATIONS')).toBe(true);
    const parent = jobs.find(job => (job.payload as Prisma.JsonObject).effect === 'DISPATCH_ORDINARY')!;
    const token = randomUUID();
    await prisma.backgroundJob.update({ where: { id: parent.id }, data: { status: 'PROCESSING_V2', attempts: 1, claimToken: token } });
    const config = await prisma.chatOpsConfig.findUnique({ where: { id: 'default' } });
    try {
      if (config) await prisma.chatOpsConfig.update({ where: { id: 'default' }, data: { enabled: false } });
      expect(await dispatchIncidentEffects(parent.id, 1, token)).toBe(true);
      expect(await dispatchIncidentEffects(parent.id, 1, token)).toBe(false);
      const final = await prisma.backgroundJob.findMany({ where: { payload: { path: ['incidentId'], equals: result.incident!.id } } });
      expect(final).toHaveLength(3);
      expect(final.find(job => job.id === parent.id)?.status).toBe('COMPLETED');
    } finally {
      if (config) await prisma.chatOpsConfig.update({ where: { id: 'default' }, data: { enabled: config.enabled } });
    }
  });

  it('fences stale dispatch claims and atomically rolls back child intents on completion failure', async () => {
    const incident = await prisma.incident.create({ data: { title: 'Dispatch rollback', serviceId } });
    const at = new Date();
    const token = randomUUID();
    const parent = await prisma.backgroundJob.create({ data: {
      type: 'SCHEDULED_TASK', status: 'PROCESSING_V2', attempts: 2, claimToken: token, scheduledAt: at,
      payload: { task: 'EVENT_SIDE_EFFECT', effect: 'DISPATCH_ORDINARY', lane: 'ORDINARY_DISPATCH',
        incidentId: incident.id, sourceEventId: randomUUID(), eventOrderAt: at.toISOString(),
        dispatch: { version: 1, effects: ['LIFECYCLE_WEBHOOK'] },
      },
    } });
    expect(await dispatchIncidentEffects(parent.id, 1, randomUUID())).toBe(false);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ingestion_test_dispatch_completion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='COMPLETED' AND NEW.payload->>'effect'='DISPATCH_ORDINARY' THEN
        RAISE EXCEPTION 'owned dispatch completion fixture'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ingestion_test_dispatch_completion BEFORE UPDATE ON "BackgroundJob"
      FOR EACH ROW EXECUTE FUNCTION ingestion_test_dispatch_completion()`);
    try {
      await expect(dispatchIncidentEffects(parent.id, 2, token)).rejects.toThrow();
      expect(await prisma.backgroundJob.count({ where: { payload: { path: ['incidentId'], equals: incident.id } } })).toBe(1);
      expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } })).status).toBe('PROCESSING_V2');
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER ingestion_test_dispatch_completion ON "BackgroundJob"');
      await prisma.$executeRawUnsafe('DROP FUNCTION ingestion_test_dispatch_completion()');
    }
    expect(await dispatchIncidentEffects(parent.id, 2, token)).toBe(true);
    const children = await prisma.backgroundJob.findMany({ where: { id: { startsWith: `${parent.id}:` } } });
    expect(children).toHaveLength(1);
    expect(children[0].createdAt).toEqual(parent.createdAt);
    expect(children[0].payload).toMatchObject({ effect: 'LIFECYCLE_WEBHOOK', sourceEventId: (parent.payload as Prisma.JsonObject).sourceEventId, dispatchOrderId: parent.id });
  });

  it('keeps compact generation out of old claims and orders same-instant children before later legacy work', async () => {
    await prisma.backgroundJob.deleteMany();
    const incident = await prisma.incident.create({ data: { title: 'Dispatch ordering', serviceId } });
    const at = new Date('2026-01-01T00:00:00.000Z');
    const context = { task: 'EVENT_SIDE_EFFECT', incidentId: incident.id, sourceEventId: randomUUID(), eventOrderAt: at.toISOString() };
    const prefix = randomUUID();
    const parentId = `${prefix}:a`, legacyId = `${prefix}:b`, criticalId = `${prefix}:c`;
    await prisma.backgroundJob.createMany({ data: [
      { id: parentId, type: 'SCHEDULED_TASK', status: 'PENDING_V2', scheduledAt: at, createdAt: at, payload: {
        ...context, effect: 'DISPATCH_ORDINARY', lane: 'ORDINARY_DISPATCH', dispatch: { version: 1, effects: ['LIFECYCLE_WEBHOOK'] },
      } },
      { id: legacyId, type: 'SCHEDULED_TASK', status: 'PENDING', scheduledAt: at, createdAt: at, payload: {
        ...context, effect: 'RESOLVE_WEBHOOK', lane: 'WEBHOOK',
      } },
      { id: criticalId, type: 'SCHEDULED_TASK', status: 'PENDING', scheduledAt: at, createdAt: at, payload: {
        ...context, effect: 'TRIGGER_ESCALATION_NOTIFICATIONS', lane: 'PERSONAL_NOTIFICATION',
      } },
    ] });
    // Old ordinary candidate eligibility excludes V2 state regardless of task.
    const oldEligible = await prisma.backgroundJob.findMany({ where: { id: parentId, status: { in: ['PENDING', 'PROCESSING'] } } });
    expect(oldEligible).toHaveLength(0);
    try {
      const initial = await claimPendingJobs(10, 'SCHEDULED_TASK');
      expect(initial.map(job => job.id).sort()).toEqual([parentId, criticalId].sort());
      const parent = initial.find(job => job.id === parentId)!;
      expect(parent.status).toBe('PROCESSING_V2');
      expect(Object.keys(parent).sort()).toEqual(['id', 'type', 'status', 'payload', 'attempts', 'maxAttempts', 'claimToken'].sort());
      expect(await dispatchIncidentEffects(parent.id, parent.attempts, parent.claimToken)).toBe(true);
      const next = await claimPendingJobs(10, 'SCHEDULED_TASK');
      expect(next).toHaveLength(1);
      expect(next[0].id.startsWith(`${parentId}:`)).toBe(true);
      await prisma.backgroundJob.update({ where: { id: next[0].id }, data: { status: 'COMPLETED' } });
      expect((await claimPendingJobs(10, 'SCHEDULED_TASK')).map(job => job.id)).toEqual([legacyId]);
    } finally {
      await prisma.backgroundJob.deleteMany({ where: { payload: { path: ['incidentId'], equals: incident.id } } });
    }
  });

  it('observes service configuration enabled while dispatch waits and retains the committed child after disablement', async () => {
    const incident = await prisma.incident.create({ data: { title: 'Dispatch configuration', serviceId } });
    const at = new Date();
    const parent = await prisma.backgroundJob.create({ data: {
      type: 'SCHEDULED_TASK', status: 'PENDING_V2', scheduledAt: at,
      payload: { task: 'EVENT_SIDE_EFFECT', effect: 'DISPATCH_ORDINARY', lane: 'ORDINARY_DISPATCH',
        incidentId: incident.id, sourceEventId: randomUUID(), eventOrderAt: at.toISOString(),
        dispatch: { version: 1, effects: ['TRIGGER_SERVICE_NOTIFICATION'] },
      },
    } });
    const previous = await prisma.service.findUniqueOrThrow({ where: { id: serviceId }, select: { serviceNotificationChannels: true } });
    try {
      await prisma.service.update({ where: { id: serviceId }, data: { serviceNotificationChannels: ['WEBHOOK'] } });
      const token = randomUUID();
      await prisma.backgroundJob.update({ where: { id: parent.id }, data: { status: 'PROCESSING_V2', attempts: 1, claimToken: token } });
      expect(await dispatchIncidentEffects(parent.id, 1, token)).toBe(true);
      await prisma.service.update({ where: { id: serviceId }, data: { serviceNotificationChannels: [] } });
      expect(await dispatchIncidentEffects(parent.id, 1, token)).toBe(false);
      const children = await prisma.backgroundJob.findMany({ where: { id: { startsWith: `${parent.id}:` } } });
      expect(children).toHaveLength(1);
      expect(children[0].payload).toMatchObject({ effect: 'TRIGGER_SERVICE_NOTIFICATION', lane: 'SERVICE_NOTIFICATION', sourceEventId: (parent.payload as Prisma.JsonObject).sourceEventId });
    } finally {
      await prisma.service.update({ where: { id: serviceId }, data: { serviceNotificationChannels: previous.serviceNotificationChannels } });
    }
  });

  it('atomically fences single-row escalation finalization by generation, status and cursor', async () => {
    const incident = await prisma.incident.create({ data: {
      title: 'Single-row escalation finalization', serviceId, status: 'OPEN', escalationGeneration: 7,
      currentEscalationStep: 2, escalationStatus: 'ESCALATING', nextEscalationAt: new Date(),
    } });
    const input = { incidentId: incident.id, expectedGeneration: 7, expectedStep: 2, status: null };
    expect(await finalizeEscalationExecution({ ...input, expectedGeneration: 6 })).toBe(false);
    expect(await finalizeEscalationExecution({ ...input, expectedStep: 1 })).toBe(false);
    expect(await finalizeEscalationExecution(input)).toBe(true);
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
      escalationStatus: null, currentEscalationStep: null, nextEscalationAt: null, escalationGeneration: 7,
    });
    expect(await finalizeEscalationExecution({ ...input, expectedStep: 0 })).toBe(true);
    await prisma.incident.update({ where: { id: incident.id }, data: { status: 'ACKNOWLEDGED' } });
    expect(await finalizeEscalationExecution({ ...input, expectedStep: 0 })).toBe(false);
    expect(await prisma.incidentEvent.count({ where: { incidentId: incident.id } })).toBe(0);
  });

  it('finalizes distinct incidents concurrently and permits only one matching cursor winner', async () => {
    const ids = Array.from({ length: 32 }, () => randomUUID());
    await prisma.incident.createMany({ data: ids.map(id => ({
      id, title: 'Concurrent fenced finalization', serviceId, status: 'OPEN',
      escalationGeneration: 9, currentEscalationStep: 2, escalationStatus: 'ESCALATING',
      nextEscalationAt: new Date(),
    })) });
    const results = await Promise.all(ids.map(incidentId => finalizeEscalationExecution({
      incidentId, expectedGeneration: 9, expectedStep: 2, status: null,
    })));
    expect(results.every(Boolean)).toBe(true);
    await prisma.incident.update({ where: { id: ids[0] }, data: { currentEscalationStep: 2 } });
    const contenders = await Promise.all(Array.from({ length: 8 }, () => finalizeEscalationExecution({
      incidentId: ids[0], expectedGeneration: 9, expectedStep: 2, status: null,
    })));
    expect(contenders.filter(Boolean)).toHaveLength(1);
    expect(await prisma.incident.count({ where: {
      id: { in: ids }, currentEscalationStep: null, escalationStatus: null, nextEscalationAt: null,
    } })).toBe(ids.length);
  });

  it('settles dispatch planning failures into the protected retry generation', async () => {
    const incident = await prisma.incident.create({ data: { title: 'Dispatch retry', serviceId } });
    const at = new Date();
    const parent = await prisma.backgroundJob.create({ data: {
      type: 'SCHEDULED_TASK', status: 'PROCESSING_V2', attempts: 1, maxAttempts: 5, claimToken: randomUUID(), scheduledAt: at,
      payload: { task: 'EVENT_SIDE_EFFECT', effect: 'DISPATCH_ORDINARY', lane: 'ORDINARY_DISPATCH',
        incidentId: incident.id, sourceEventId: randomUUID(), eventOrderAt: at.toISOString(),
        dispatch: { version: 999, effects: ['TRIGGER_WEBHOOK'] },
      },
    } });
    expect(await processJob(parent)).toBe(false);
    const retry = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: parent.id } });
    expect(retry.status).toBe('PENDING_V2');
    expect(retry.claimToken).toBeNull();
    expect(retry.scheduledAt.getTime()).toBeGreaterThan(at.getTime());
    expect(await prisma.backgroundJob.count({ where: { id: { startsWith: `${parent.id}:` } } })).toBe(0);
    await prisma.backgroundJob.delete({ where: { id: parent.id } });
  });

  it('reads admission control and scoped Automation together without caching the emergency switch', async () => {
    const rollback = new Error('Rollback owned admission settings fixture');
    await expect(prisma.$transaction(async tx => {
      await tx.systemSettings.upsert({ where: { id: 'default' },
        create: { automationEnabled: true }, update: { automationEnabled: true },
      });
      await tx.serviceAutomationConfig.upsert({ where: { serviceId },
        create: { serviceId, mode: 'SHADOW' }, update: { mode: 'SHADOW' },
      });
      const other = await tx.service.create({ data: { name: 'Outside admission settings scope' } });
      await tx.serviceAutomationConfig.create({ data: { serviceId: other.id, mode: 'LIVE' } });
      const policy = await getIngestionPolicy(tx);
      const automation = await getIngestionAutomationConfigs(tx, [serviceId]);
      const query = vi.spyOn(tx, '$queryRaw');
      try {
        const shared = await readIngestionAdmissionSettings(tx, [serviceId, serviceId]);
        expect({ paused: shared.paused, revision: shared.revision, policy: shared.policy }).toEqual(policy);
        expect(shared.automation).toEqual(automation);
        expect([...shared.automation.keys()]).toEqual([serviceId]);
        expect(query).toHaveBeenCalledTimes(1);
        await tx.serviceAutomationConfig.update({ where: { serviceId }, data: { mode: 'LIVE' } });
        query.mockClear();
        expect((await readIngestionAdmissionSettings(tx, [serviceId])).automation.get(serviceId)?.mode).toBe('LIVE');
        expect(query).toHaveBeenCalledTimes(1);
        await tx.systemSettings.update({ where: { id: 'default' }, data: { automationEnabled: false } });
        query.mockClear();
        expect((await readIngestionAdmissionSettings(tx, [serviceId])).automation.size).toBe(0);
        expect(query).toHaveBeenCalledTimes(1);
      } finally { query.mockRestore(); }
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it('shares one authoritative published policy snapshot without re-reading during resolution', async () => {
    const support = await prisma.responseSupportHoursPolicy.create({ data: {
      scopeKey: `service:${serviceId}`, version: 1, timezone: 'UTC', mode: 'SCHEDULED',
      windows: { create: { dayOfWeek: 1, startMinute: 540, endMinute: 1020 } },
      exceptions: { create: { localDate: new Date('2026-10-27T00:00:00Z'), available: false } },
    } });
    await prisma.responseSupportHoursPolicy.update({ where: { id: support.id }, data: { sealedAt: new Date() } });
    await prisma.responseSupportHoursPolicy.create({ data: {
      scopeKey: `service:${serviceId}`, version: 2, timezone: 'UTC', mode: 'ALWAYS',
    } });
    await prisma.$transaction(async tx => {
      const keys = ['integration:integration', `service:${serviceId}`, 'workspace'];
      const expectedClassification = await readPublishedClassificationPolicies(tx, keys);
      const expectedSla = await readPublishedSlaPolicies(tx, [`service:${serviceId}`, 'workspace']);
      const expectedSupport = await readPublishedSupportPolicies(tx, [`service:${serviceId}`, 'workspace']);
      const query = vi.spyOn(tx, '$queryRaw');
      try {
        const snapshot = await readPublishedIncidentPolicies(tx, serviceId, 'integration');
        expect(snapshot.classification).toEqual(expectedClassification);
        expect(snapshot.sla).toEqual(expectedSla);
        expect(snapshot.support).toEqual(expectedSupport);
        expect(query).toHaveBeenCalledTimes(1);
        const classification = await resolveIncidentClassification(tx, {
          serviceId, integrationId: 'integration', alertSeverity: 'critical',
        }, snapshot.classification);
        const contract = await resolveNewIncidentSlaContract(tx, {
          serviceId, priority: classification.priority, now: new Date(),
        }, snapshot.sla);
        expect(contract.ackTargetMs).toBeGreaterThan(0);
        expect(snapshot.support[0].version).toBe(1);
        expect(snapshot.support[0].exceptions[0].localDate.toISOString()).toBe('2026-10-27T00:00:00.000Z');
        expect(await resolveSupportHours(tx, { serviceId, at: new Date('2026-10-26T10:00:00Z') }, snapshot.support)).toMatchObject({ state: 'INSIDE', policyVersion: 1 });
        expect(query).toHaveBeenCalledTimes(1);
      } finally { query.mockRestore(); }
    });
  });

  it('atomically inserts only reserved receipt ordinals and preserves prepared JSON', async () => {
    const policy = (await getIngestionPolicy()).policy;
    const stored = encodeEnvelope(envelope('raw-insert'));
    const dangerous = "quote ' ); DROP TABLE nope; -- and \" json";
    stored.event.payload.summary = dangerous;
    const rows: ReceiptInsert[] = [0, 1, 2].map(index => ({
      id: randomUUID(), receivedAt: new Date(stored.receivedAt), serviceId,
      integrationId: 'integration', partitionKey: `insert-${index}`,
      orderingKeys: [`insert:${randomUUID()}`], idempotencyKey: randomUUID(), contentHash: 'fixture-hash',
      payloadBytes: 100, critical: true, envelope: stored,
    }));
    const insert = prepareReceiptInsert(rows);
    stored.event.payload.summary = 'changed after preparation';
    const before = await prisma.ingestionBudget.aggregate({ _sum: { pending: true, bytes: true } });
    await prisma.$transaction(async tx => {
      const shards = await reserveIngestionBudgets(tx, policy, [0, 1].map(() => ({
        payloadBytes: 100, critical: true, preferredShard: 0,
      })));
      expect(shards.every(shard => shard !== undefined)).toBe(true);
      await insert(tx, [shards[0], undefined, shards[1]]);
    });
    const inserted = await prisma.ingestionReceipt.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { sequence: 'asc' } });
    expect(inserted.map(row => row.id)).toEqual([rows[0].id, rows[2].id]);
    expect(inserted.every(row => row.status === 'PENDING' && row.availableAt.getTime() === 0)).toBe(true);
    expect(decodeEnvelope(inserted[0].envelope).event.payload.summary).toBe(dangerous);
    const after = await prisma.ingestionBudget.aggregate({ _sum: { pending: true, bytes: true } });
    expect(after._sum.pending! - before._sum.pending!).toBe(2);
    expect(after._sum.bytes! - before._sum.bytes!).toBe(BigInt(200));
    // An insertion constraint failure must roll back the reservation too.
    const duplicate = prepareReceiptInsert([rows[0]]);
    await expect(prisma.$transaction(async tx => {
      const shards = await reserveIngestionBudgets(tx, policy, [{ payloadBytes: 100, critical: true, preferredShard: 0 }]);
      await duplicate(tx, shards);
    })).rejects.toThrow();
    expect(await prisma.ingestionBudget.aggregate({ _sum: { pending: true, bytes: true } })).toEqual(after);
  });

  it('inserts a single prepared receipt without changing its captured identity or payload', async () => {
    const stored = encodeEnvelope(envelope('single-values'));
    const receivedAt = new Date(stored.receivedAt);
    const orderingKeys = [`single:${randomUUID()}`];
    const id = randomUUID();
    const row: ReceiptInsert = {
      id, receivedAt, serviceId, integrationId: 'integration', partitionKey: 'single-values',
      orderingKeys, idempotencyKey: randomUUID(), contentHash: 'single-hash',
      payloadBytes: 100, critical: true, envelope: stored,
    };
    const expectedAt = receivedAt.getTime();
    const expectedKeys = [...orderingKeys];
    const summary = "quoted ' value with \" JSON";
    stored.event.payload.summary = summary;
    const insert = prepareReceiptInsert([row]);
    stored.event.payload.summary = 'mutated';
    receivedAt.setTime(0);
    orderingKeys.push('mutated');
    row.id = 'mutated';
    await prisma.$transaction(async tx => {
      const shards = await reserveIngestionBudgets(tx, (await getIngestionPolicy(tx)).policy, [{
        payloadBytes: 100, critical: true, preferredShard: 0,
      }]);
      await insert(tx, shards);
    });
    const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id } });
    expect(receipt.receivedAt?.getTime()).toBe(expectedAt);
    expect(receipt.orderingKeys).toEqual(expectedKeys);
    expect(decodeEnvelope(receipt.envelope).event.payload.summary).toBe(summary);
    expect(receipt.availableAt.getTime()).toBe(0);
    expect(receipt.status).toBe('PENDING');
  });

  it('plans collaboration at execution and recovers a committed child intent after disable', async () => {
    const previous = await prisma.chatOpsConfig.findUnique({ where: { id: 'default' } });
    const incident = await prisma.incident.create({ data: {
      title: 'Planner configuration boundary', serviceId, status: 'OPEN',
    } });
    const payload = {
      task: 'EVENT_SIDE_EFFECT' as const, effect: 'TRIGGER_WAR_ROOM' as const,
      lane: 'WAR_ROOM' as const, incidentId: incident.id,
      sourceEventId: randomUUID(), eventOrderAt: new Date().toISOString(),
    };
    try {
      await prisma.chatOpsConfig.upsert({ where: { id: 'default' },
        create: { enabled: false }, update: { enabled: false } });
      await processEventSideEffect(payload, 1);
      expect(await prisma.warRoomProviderEventDelivery.count({ where: { incidentId: incident.id } })).toBe(0);
      // This durable parent was enqueued before enablement but not yet executed.
      const queued = { ...payload, sourceEventId: randomUUID() };
      await prisma.chatOpsConfig.update({ where: { id: 'default' }, data: { enabled: true } });
      await processEventSideEffect(queued, 1);
      expect(await prisma.warRoomProviderEventDelivery.count({ where: { incidentId: incident.id } })).toBe(2);
      await prisma.chatOpsConfig.update({ where: { id: 'default' }, data: { enabled: false } });
      const recovery = { ...payload, sourceEventId: randomUUID() };
      const event = { kind: 'TRIGGER' as const, incidentId: incident.id, incidentEventId: recovery.sourceEventId };
      const delivery = await ensureWarRoomDelivery({ provider: 'SLACK', incidentId: incident.id,
        kind: 'TRIGGER', idempotencyKey: warRoomIdempotencyKey(event), eventPayload: event });
      expect(await prisma.backgroundJob.count({ where: { type: 'WAR_ROOM_PROVIDER_EVENT',
        payload: { path: ['deliveryId'], equals: delivery.id } } })).toBe(0);
      await processEventSideEffect(recovery, 2);
      expect(await prisma.backgroundJob.count({ where: { type: 'WAR_ROOM_PROVIDER_EVENT',
        payload: { path: ['deliveryId'], equals: delivery.id } } })).toBe(1);
      expect(await prisma.warRoomProviderEventDelivery.count({ where: { incidentId: incident.id } })).toBe(4);
      // A reclaimed parent must wait for an older producer's uncommitted
      // unique-key delivery, not conclude that disabled config makes it absent.
      const late = { ...payload, sourceEventId: randomUUID() };
      const lateEvent = { kind: 'TRIGGER' as const, incidentId: incident.id, incidentEventId: late.sourceEventId };
      let releaseWriter!: () => void;
      let inserted!: () => void;
      const held = new Promise<void>(resolve => { releaseWriter = resolve; });
      const ready = new Promise<void>(resolve => { inserted = resolve; });
      const lateId = randomUUID();
      const writer = prisma.$transaction(async tx => {
        await tx.warRoomProviderEventDelivery.create({ data: {
          id: lateId, provider: 'SLACK', incidentId: incident.id, kind: 'TRIGGER',
          idempotencyKey: warRoomIdempotencyKey(lateEvent), eventPayload: lateEvent,
        } });
        inserted();
        await held;
      }, { timeout: 10000 });
      await Promise.race([ready, writer.then(() => { throw new Error('Writer ended before overlap'); })]);
      let retryFinished = false;
      const retry = processEventSideEffect(late, 2).then(() => { retryFinished = true; });
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(retryFinished).toBe(false);
      } finally {
        releaseWriter();
        await writer;
        await retry;
      }
      expect(await prisma.backgroundJob.count({ where: { type: 'WAR_ROOM_PROVIDER_EVENT',
        payload: { path: ['deliveryId'], equals: lateId } } })).toBe(1);
    } finally {
      if (previous) await prisma.chatOpsConfig.update({ where: { id: 'default' }, data: { enabled: previous.enabled } });
      else await prisma.chatOpsConfig.deleteMany({ where: { id: 'default' } });
    }
  });

  it('processes fallback responder planning while an older general backlog remains untouched', async () => {
    await prisma.backgroundJob.deleteMany();
    const noiseIds = Array.from({ length: 1000 }, () => randomUUID());
    try {
      await prisma.backgroundJob.createMany({
        data: noiseIds.map(id => ({
          id,
          type: 'SCHEDULED_TASK' as const,
          scheduledAt: new Date('2000-01-01T00:00:00Z'),
          payload: { task: 'OWNED_GENERAL_BACKLOG' },
        })),
      });
      await processEvent(envelope(randomUUID()).event, serviceId, 'integration');
      const incident = await prisma.incident.findFirstOrThrow({ where: { serviceId } });
      const result = await processPendingJobsByType('SCHEDULED_TASK', 10, 2, {
        criticalEffectsOnly: true,
      });
      expect(result).toEqual({ total: 1, processed: 1, failed: 0 });
      expect(
        await prisma.backgroundJob.count({ where: { id: { in: noiseIds }, status: 'PENDING' } })
      ).toBe(1000);
      expect(
        await prisma.backgroundJob.count({
          where: {
            type: 'SCHEDULED_TASK' as const,
            status: 'COMPLETED',
            AND: [
              { payload: { path: ['incidentId'], equals: incident.id } },
              { payload: { path: ['lane'], equals: 'PERSONAL_NOTIFICATION' } },
            ],
          },
        })
      ).toBe(1);
    } finally {
      await prisma.backgroundJob.deleteMany();
    }
  });

  it('excludes personal effects from general claims while retaining legacy missing-lane jobs', async () => {
    await prisma.backgroundJob.deleteMany();
    const ids = Array.from({ length: 4 }, () => randomUUID());
    const base = {
      task: 'EVENT_SIDE_EFFECT',
      incidentId: serviceId,
      eventOrderAt: new Date().toISOString(),
      sourceEventId: randomUUID(),
      effect: 'TRIGGER_WEBHOOK',
    };
    try {
      await prisma.backgroundJob.createMany({
        data: [
          {
            id: ids[0],
            type: 'SCHEDULED_TASK' as const,
            payload: { ...base, lane: 'PERSONAL_NOTIFICATION' },
          },
          { id: ids[1], type: 'SCHEDULED_TASK' as const, payload: {} },
          { id: ids[2], type: 'SCHEDULED_TASK' as const, payload: { ...base, lane: 'WEBHOOK' } },
          { id: ids[3], type: 'NOTIFICATION' as const, payload: {} },
        ].map(row => ({ ...row, scheduledAt: new Date('2000-01-01T00:00:00Z') })),
      });
      const general = await claimPendingOperationalJobs(4, GENERAL_WORKER_EXCLUDED_JOB_TYPES, {
        excludeCriticalEffects: true,
      });
      expect(general.map(job => job.id).sort()).toEqual(ids.slice(1).sort());
      expect(await prisma.backgroundJob.findUnique({ where: { id: ids[0] } })).toMatchObject({
        status: 'PENDING',
        attempts: 0,
      });
      const critical = await claimPendingJobs(4, 'SCHEDULED_TASK', [], {
        criticalEffectsOnly: true,
      });
      expect(critical.map(job => job.id)).toEqual([ids[0]]);
    } finally {
      await prisma.backgroundJob.deleteMany();
    }
  });

  it('retains personal lifecycle predecessors and stale-token fencing across critical recovery', async () => {
    await prisma.backgroundJob.deleteMany();
    const ids = Array.from({ length: 3 }, () => randomUUID());
    try {
      await prisma.backgroundJob.createMany({
        data: ids.map((id, index) => ({
          id,
          type: 'SCHEDULED_TASK' as const,
          scheduledAt: new Date(Date.UTC(2002 - index, 0, 1)),
          payload: {
            task: 'EVENT_SIDE_EFFECT',
            lane: 'PERSONAL_NOTIFICATION',
            effect:
              index === 0 ? 'TRIGGER_ESCALATION_NOTIFICATIONS' : 'LIFECYCLE_USER_NOTIFICATION',
            incidentId: serviceId,
            sourceEventId: randomUUID(),
            eventOrderAt: new Date(Date.UTC(2000, 0, 1, 0, 0, index)).toISOString(),
          },
        })),
      });
      const claim = () => claimPendingJobs(10, 'SCHEDULED_TASK', [], { criticalEffectsOnly: true });
      const first = await claim();
      expect(first.map(job => job.id)).toEqual([ids[0]]);
      await prisma.$executeRaw`UPDATE "BackgroundJob"
        SET "startedAt" = clock_timestamp() - INTERVAL '21 seconds' WHERE id = ${ids[0]}`;
      const recovered = await claim();
      expect(recovered.map(job => job.id)).toEqual([ids[0]]);
      expect(recovered[0].claimToken).not.toBe(first[0].claimToken);
      await markJobCompleted(first[0].id, first[0].attempts, first[0].claimToken);
      expect(await claim()).toEqual([]);
      expect(await prisma.backgroundJob.findUnique({ where: { id: ids[0] } })).toMatchObject({
        status: 'PROCESSING',
        claimToken: recovered[0].claimToken,
        attempts: 2,
      });
      await markJobCompleted(recovered[0].id, recovered[0].attempts, recovered[0].claimToken);
      const acknowledgment = await claim();
      expect(acknowledgment.map(job => job.id)).toEqual([ids[1]]);
      expect(await claim()).toEqual([]);
      await markJobCompleted(
        acknowledgment[0].id,
        acknowledgment[0].attempts,
        acknowledgment[0].claimToken
      );
      const resolution = await claim();
      expect(resolution.map(job => job.id)).toEqual([ids[2]]);
      await markJobCompleted(resolution[0].id, resolution[0].attempts, resolution[0].claimToken);
      expect(
        await prisma.backgroundJob.count({ where: { id: { in: ids }, status: 'COMPLETED' } })
      ).toBe(3);
    } finally {
      await prisma.backgroundJob.deleteMany();
    }
  });

  async function createDeliveryFixture(
    stageName = 'ingestion-lease-fixture',
    status: 'PENDING' | 'FAILED' = 'PENDING'
  ) {
    const delivery = await prisma.warRoomProviderEventDelivery.create({
      data: {
        provider: 'SLACK',
        idempotencyKey: randomUUID(),
        incidentId: serviceId,
        kind: 'TRIGGER',
        eventPayload: {},
        status,
      },
    });
    const stage = await prisma.warRoomProviderEventStage.create({
      data: { deliveryId: delivery.id, stage: stageName },
    });
    return { delivery, stage };
  }

  it('retains legacy null-expiry completion and never reclaims a failed delivery', async () => {
    const legacy = await createDeliveryFixture();
    const failed = await createDeliveryFixture('failed-delivery-fixture', 'FAILED');
    try {
      await prisma.warRoomProviderEventDelivery.update({
        where: { id: legacy.delivery.id },
        data: { status: 'PROCESSING', leaseToken: 'legacy-owner-token', leaseExpiresAt: null },
      });
      await completeWarRoomDelivery(legacy.delivery.id, 'legacy-owner-token');
      expect(
        await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: legacy.delivery.id } })
      ).toMatchObject({ status: 'COMPLETED', leaseToken: null });
      expect(
        await prisma.warRoomProviderEventStage.findUnique({ where: { id: legacy.stage.id } })
      ).toMatchObject({ status: 'SKIPPED' });
      expect(await claimWarRoomDeliveryById(failed.delivery.id)).toBeNull();
      expect(
        await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: failed.delivery.id } })
      ).toMatchObject({ status: 'FAILED', attempts: 0, leaseToken: null });
    } finally {
      await prisma.warRoomProviderEventDelivery.deleteMany({
        where: { id: { in: [legacy.delivery.id, failed.delivery.id] } },
      });
    }
  });

  it('fences competing war-room claims, expired completion and stale completion after reclaim', async () => {
    const { delivery, stage } = await createDeliveryFixture();
    try {
      await prisma.warRoomProviderEventStage.createMany({
        data: [
          { deliveryId: delivery.id, stage: 'already-done', status: 'COMPLETED' },
          { deliveryId: delivery.id, stage: 'already-attempting', status: 'ATTEMPTING' },
        ],
      });
      const results = await Promise.allSettled([
        claimWarRoomDeliveryById(delivery.id),
        claimWarRoomDeliveryById(delivery.id),
      ]);
      const claims = results.flatMap(row =>
        row.status === 'fulfilled' && row.value ? [row.value] : []
      );
      expect(claims).toHaveLength(1);
      expect(results.filter(row => row.status === 'rejected')).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({
            name: 'WarRoomRetryableError',
            retryBudgetNeutral: true,
          }),
        }),
      ]);
      expect(
        await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: delivery.id } })
      ).toMatchObject({ status: 'PROCESSING', attempts: 1, leaseToken: claims[0].token });
      await prisma.$executeRaw`UPDATE "WarRoomProviderEventDelivery"
        SET "leaseExpiresAt" = clock_timestamp() - INTERVAL '1 second' WHERE id = ${delivery.id}`;
      await completeWarRoomDelivery(delivery.id, claims[0].token);
      expect(
        await prisma.warRoomProviderEventStage.findUnique({ where: { id: stage.id } })
      ).toMatchObject({ status: 'PENDING' });
      expect(
        await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: delivery.id } })
      ).toMatchObject({ status: 'PROCESSING', leaseToken: claims[0].token });
      const reclaimed = await claimWarRoomDelivery({
        provider: delivery.provider,
        idempotencyKey: delivery.idempotencyKey,
      });
      expect(reclaimed).not.toBeNull();
      expect(reclaimed!.token).not.toBe(claims[0].token);
      await completeWarRoomDelivery(delivery.id, claims[0].token);
      expect(
        await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: delivery.id } })
      ).toMatchObject({ status: 'PROCESSING', attempts: 2, leaseToken: reclaimed!.token });
      expect(
        await prisma.warRoomProviderEventStage.findUnique({ where: { id: stage.id } })
      ).toMatchObject({ status: 'PENDING' });
      await completeWarRoomDelivery(delivery.id, reclaimed!.token);
      expect(
        await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: delivery.id } })
      ).toMatchObject({ status: 'COMPLETED', attempts: 2, leaseToken: null });
      expect(
        await prisma.warRoomProviderEventStage.findUnique({ where: { id: stage.id } })
      ).toMatchObject({ status: 'SKIPPED' });
      expect(
        await prisma.warRoomProviderEventStage.findMany({
          where: { deliveryId: delivery.id, stage: { in: ['already-done', 'already-attempting'] } },
          select: { stage: true, status: true },
          orderBy: { stage: 'asc' },
        })
      ).toEqual([
        { stage: 'already-attempting', status: 'ATTEMPTING' },
        { stage: 'already-done', status: 'COMPLETED' },
      ]);
      expect(await claimWarRoomDeliveryById(delivery.id)).toBeNull();
      expect(await claimWarRoomDeliveryById(randomUUID())).toBeNull();
    } finally {
      await prisma.warRoomProviderEventDelivery.delete({ where: { id: delivery.id } });
    }
  });

  it('rolls back war-room completion when atomic pending-stage settlement fails', async () => {
    const { delivery, stage } = await createDeliveryFixture('ingestion-atomic-settlement');
    let constraintInstalled = false;
    try {
      const claim = await claimWarRoomDeliveryById(delivery.id);
      expect(claim).not.toBeNull();
      await prisma.$executeRawUnsafe(`ALTER TABLE "WarRoomProviderEventStage"
        ADD CONSTRAINT ingestion_test_atomic_stage_settlement
        CHECK (stage <> 'ingestion-atomic-settlement' OR status <> 'SKIPPED') NOT VALID`);
      constraintInstalled = true;
      await expect(completeWarRoomDelivery(delivery.id, claim!.token)).rejects.toThrow();
      expect(
        await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: delivery.id } })
      ).toMatchObject({ status: 'PROCESSING', leaseToken: claim!.token });
      expect(
        await prisma.warRoomProviderEventStage.findUnique({ where: { id: stage.id } })
      ).toMatchObject({ status: 'PENDING', lastError: null });
    } finally {
      if (constraintInstalled)
        await prisma.$executeRawUnsafe(`ALTER TABLE "WarRoomProviderEventStage"
          DROP CONSTRAINT ingestion_test_atomic_stage_settlement`);
      await prisma.warRoomProviderEventDelivery.delete({ where: { id: delivery.id } });
    }
  });

  it('refills an independent job slot while another claimed job waits on PostgreSQL', async () => {
    const jobs = await Promise.all(
      [true, false, false].map((slotHold, index) =>
        prisma.backgroundJob.create({
          data: {
            type: 'NOTIFICATION',
            scheduledAt: new Date(Date.UTC(2000, 0, 1, 0, 0, index)),
            payload: { slotHold },
          },
        })
      )
    );
    let release!: () => void;
    let ready!: () => void;
    const acquired = new Promise<void>(resolve => (ready = resolve));
    const held = new Promise<void>(resolve => (release = resolve));
    let holder: Promise<unknown> | undefined;
    let processing: ReturnType<typeof processPendingJobsByType> | undefined;
    try {
      // Disposable database only: block retirement of one fixture job, without
      // blocking the initial SKIP LOCKED claim or other jobs' completion.
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ingestion_test_hold_slot() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.status = 'CANCELLED' AND NEW.payload->>'slotHold' = 'true' THEN
            PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id, 0));
          END IF;
          RETURN NEW;
        END $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ingestion_test_hold_slot
        BEFORE UPDATE ON "BackgroundJob" FOR EACH ROW EXECUTE FUNCTION ingestion_test_hold_slot()`);
      holder = prisma.$transaction(
        async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${jobs[0].id}, 0))`;
          ready();
          await held;
        },
        { timeout: 15000 }
      );
      await Promise.race([
        acquired,
        holder.then(() => {
          throw new Error('Slot lock fixture ended before acquiring its lock');
        }),
      ]);
      processing = processPendingJobsByType('NOTIFICATION', 3, 2);
      const deadline = Date.now() + 5000;
      let statuses: string[] = [];
      do {
        const rows = await prisma.backgroundJob.findMany({
          where: { id: { in: jobs.map(job => job.id) } },
          select: { id: true, status: true },
        });
        statuses = jobs.map(job => rows.find(row => row.id === job.id)!.status);
        if (statuses[1] === 'CANCELLED' && statuses[2] === 'CANCELLED') break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      expect(statuses).toEqual(['PROCESSING', 'CANCELLED', 'CANCELLED']);
      release();
      await holder;
      await expect(processing).resolves.toEqual({ processed: 3, failed: 0, total: 3 });
    } finally {
      release();
      await Promise.allSettled([holder, processing]);
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ingestion_test_hold_slot ON "BackgroundJob"'
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS ingestion_test_hold_slot()');
      await prisma.backgroundJob.deleteMany({ where: { id: { in: jobs.map(job => job.id) } } });
    }
  });

  it('recovers a terminated processing connection without losing its event or duplicating side effects', async () => {
    const previousRole = process.env.OPSKNIGHT_PROCESS_ROLE;
    process.env.OPSKNIGHT_PROCESS_ROLE = 'integrated';
    let block: Awaited<ReturnType<typeof blockIncidentIdentity>> | undefined;
    try {
      const current = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: current.revision,
          policy: { ...current.policy, concurrency: 2, pollMs: 50, leaseMs: 5000 },
        },
        actorId
      );
      const victim = await acceptPostgresEvent(envelope('connection-victim'));
      block = await blockIncidentIdentity('connection-victim');
      startIngestionWorker();
      let pid: number | undefined;
      await expect
        .poll(
          async () => {
            const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT pid FROM pg_stat_activity WHERE datname = current_database()
            AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND wait_event = 'advisory'
            AND query LIKE '%pg_advisory_xact_lock%'`;
            pid = rows.at(0)?.pid;
            return pid;
          },
          { timeout: 5000 }
        )
        .toBeDefined();
      const independent = await acceptPostgresEvent(envelope('connection-independent'));
      await expect
        .poll(
          async () =>
            (
              await prisma.ingestionReceipt.findUniqueOrThrow({
                where: { id: independent.receiptId },
              })
            ).status,
          { timeout: 5000 }
        )
        .toBe('COMPLETED');
      // Only the observed, waiting processing session in this guarded test DB
      // is terminated. The lock holder and monitor remain connected.
      const [result] = await prisma.$queryRaw<Array<{ terminated: boolean }>>`
        SELECT pg_terminate_backend(${pid}::integer) AS terminated`;
      expect(result.terminated).toBe(true);
      block.release();
      await block.done;
      await expect
        .poll(
          async () =>
            (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: victim.receiptId } }))
              .status,
          { timeout: 10000 }
        )
        .toBe('COMPLETED');
      expect(
        (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: victim.receiptId } }))
          .attempts
      ).toBeGreaterThanOrEqual(2);
      expect(await prisma.alert.count({ where: { serviceId } })).toBe(2);
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(2);
      expect(getIngestionWorkerHealth().faulted).toBe(false);
    } finally {
      block?.release();
      await block?.done;
      await stopIngestionWorker();
      if (previousRole === undefined) delete process.env.OPSKNIGHT_PROCESS_ROLE;
      else process.env.OPSKNIGHT_PROCESS_ROLE = previousRole;
    }
  });

  it('does not miss shutdown requested while a heartbeat is waiting for the database', async () => {
    const previousRole = process.env.OPSKNIGHT_PROCESS_ROLE;
    process.env.OPSKNIGHT_PROCESS_ROLE = 'integrated';
    const current = await getIngestionPolicy();
    await applyIngestionCommand(
      {
        action: 'configure',
        expectedRevision: current.revision,
        policy: { ...current.policy, pollMs: 30000 },
      },
      actorId
    );
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => {
      acquired = resolve;
    });
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const locker = prisma.$transaction(
      async tx => {
        await tx.$executeRaw`LOCK TABLE "RuntimeWorkerHeartbeat" IN SHARE MODE`;
        acquired();
        await hold;
      },
      { timeout: 15000 }
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ready,
        locker.then(() => {
          throw new Error('Lock fixture ended early');
        }),
      ]);
      startIngestionWorker();
      await expect
        .poll(
          async () => {
            const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%INSERT INTO "RuntimeWorkerHeartbeat"%') AS waiting`;
            return row.waiting;
          },
          { timeout: 5000 }
        )
        .toBe(true);
      const stop = stopIngestionWorker();
      release();
      await locker;
      const stopped = await Promise.race([
        stop.then(() => true),
        new Promise<boolean>(resolve => {
          deadline = setTimeout(() => resolve(false), 1500);
        }),
      ]);
      expect(stopped).toBe(true);
      expect(getIngestionWorkerHealth().running).toBe(false);
    } finally {
      if (deadline) clearTimeout(deadline);
      release();
      await locker;
      // Also wakes the old implementation after the regression deadline, so
      // a failed assertion cannot leave a 30-second timer in subsequent tests.
      await stopIngestionWorker();
      if (previousRole === undefined) delete process.env.OPSKNIGHT_PROCESS_ROLE;
      else process.env.OPSKNIGHT_PROCESS_ROLE = previousRole;
    }
  });

  it('bounds active work and waits for every owned event on shutdown without claiming queued work', async () => {
    const previousRole = process.env.OPSKNIGHT_PROCESS_ROLE;
    process.env.OPSKNIGHT_PROCESS_ROLE = 'integrated';
    const blocks: Array<Awaited<ReturnType<typeof blockIncidentIdentity>>> = [];
    let stop: Promise<void> | undefined;
    let stopped = false;
    const status = async (id: string) =>
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id } })).status;
    try {
      const current = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: current.revision,
          policy: { ...current.policy, concurrency: 2, pollMs: 50 },
        },
        actorId
      );
      blocks.push(await blockIncidentIdentity('shutdown-first'));
      blocks.push(await blockIncidentIdentity('shutdown-second'));
      const first = await acceptPostgresEvent(envelope('shutdown-first'));
      const second = await acceptPostgresEvent(envelope('shutdown-second'));
      const queued = await acceptPostgresEvent(envelope('shutdown-queued'));
      startIngestionWorker();
      await expect
        .poll(async () => [await status(first.receiptId), await status(second.receiptId)], {
          timeout: 5000,
        })
        .toEqual(['PROCESSING', 'PROCESSING']);
      // More than one idle polling interval: a free-running third task would
      // complete instead of remaining queued behind the configured two slots.
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(await status(queued.receiptId)).toBe('PENDING');
      expect(
        runtimeOperationalMetrics().get('opsknight_ingestion_active_events')?.at(0)?.value
      ).toBe(2);
      stop = stopIngestionWorker().then(() => {
        stopped = true;
      });
      expect(
        runtimeOperationalMetrics().get('opsknight_ingestion_processing_capacity')?.at(0)?.value
      ).toBe(0);
      blocks[0].release();
      await blocks[0].done;
      await expect.poll(() => status(first.receiptId), { timeout: 5000 }).toBe('COMPLETED');
      expect(stopped).toBe(false);
      expect(await status(second.receiptId)).toBe('PROCESSING');
      expect(await status(queued.receiptId)).toBe('PENDING');
      blocks[1].release();
      await blocks[1].done;
      await stop;
      expect(await status(second.receiptId)).toBe('COMPLETED');
      expect(await status(queued.receiptId)).toBe('PENDING');
      expect(getIngestionWorkerHealth().running).toBe(false);
      expect(
        runtimeOperationalMetrics().get('opsknight_ingestion_active_events')?.at(0)?.value
      ).toBe(0);
      await consumeIngestionBatch(1);
      expect(await status(queued.receiptId)).toBe('COMPLETED');
    } finally {
      blocks.forEach(block => block.release());
      await Promise.allSettled(blocks.map(block => block.done));
      await (stop ?? stopIngestionWorker());
      if (previousRole === undefined) delete process.env.OPSKNIGHT_PROCESS_ROLE;
      else process.env.OPSKNIGHT_PROCESS_ROLE = previousRole;
    }
  });

  it('protects both severity lanes during single-slot refills without bypassing same-key predecessors', async () => {
    const ordinary = envelope('oldest-ordinary');
    ordinary.event.payload.severity = 'warning';
    const firstOrdinary = await acceptPostgresEvent(ordinary);
    const critical = await acceptPostgresEvent(envelope('new-critical'));
    expect((await claimPostgresEvents(1, 60000, 'critical'))[0].id).toBe(critical.receiptId);
    expect((await claimPostgresEvents(1, 60000, 'standard'))[0].id).toBe(firstOrdinary.receiptId);
    const successor = await acceptPostgresEvent(envelope('oldest-ordinary'));
    // Its ordinary predecessor is still processing, so critical preference
    // must not turn priority into permission to overtake it.
    expect(await claimPostgresEvents(1, 60000, 'critical')).toHaveLength(0);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: successor.receiptId } }))
        .status
    ).toBe('PENDING');
    // A single-slot consumer with no preference retains the oldest-first contract.
    const oldestInput = envelope('fifo-ordinary');
    oldestInput.event.payload.severity = 'warning';
    const oldest = await acceptPostgresEvent(oldestInput);
    await acceptPostgresEvent(envelope('fifo-critical'));
    expect((await claimPostgresEvents(1))[0].id).toBe(oldest.receiptId);
  });

  it('refills free worker slots while an independent event remains blocked', async () => {
    const previousRole = process.env.OPSKNIGHT_PROCESS_ROLE;
    process.env.OPSKNIGHT_PROCESS_ROLE = 'integrated';
    const current = await getIngestionPolicy();
    await applyIngestionCommand(
      {
        action: 'configure',
        expectedRevision: current.revision,
        policy: { ...current.policy, concurrency: 2 },
      },
      actorId
    );
    const blocked = await acceptPostgresEvent(envelope('blocked-slot'));
    const fast = await acceptPostgresEvent(envelope('fast-slot'));
    let block: Awaited<ReturnType<typeof blockIncidentIdentity>> | undefined;
    const status = async (id: string) =>
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id } })).status;
    try {
      block = await blockIncidentIdentity('blocked-slot');
      startIngestionWorker();
      await expect.poll(() => status(fast.receiptId), { timeout: 5000 }).toBe('COMPLETED');
      expect(await status(blocked.receiptId)).toBe('PROCESSING');
      const next = await acceptPostgresEvent(envelope('refilled-slot'));
      await expect.poll(() => status(next.receiptId), { timeout: 3000 }).toBe('COMPLETED');
      expect(await status(blocked.receiptId)).toBe('PROCESSING');
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(2);
    } finally {
      block?.release();
      await block?.done;
      await stopIngestionWorker();
      if (previousRole === undefined) delete process.env.OPSKNIGHT_PROCESS_ROLE;
      else process.env.OPSKNIGHT_PROCESS_ROLE = previousRole;
    }
    expect(await status(blocked.receiptId)).toBe('COMPLETED');
    expect(await prisma.alert.count({ where: { serviceId } })).toBe(3);
  });

  it('coalesces 64 concurrent hot-key decisions into two database writes without granting extra credit', async () => {
    const current = await getIngestionPolicy();
    await applyIngestionCommand(
      {
        action: 'configure',
        expectedRevision: current.revision,
        policy: {
          ...current.policy,
          quotas: { ...current.policy.quotas, eventsPerMinute: 1, eventsBurst: 23 },
        },
      },
      actorId
    );
    const query = vi.spyOn(prisma, '$queryRaw');
    try {
      const key = `quota-coalesce:${randomUUID()}:events`;
      const results = await Promise.all(
        Array.from({ length: 64 }, () => checkIngestionQuota(key, 120, 60000))
      );
      expect(results.filter(result => result.allowed)).toHaveLength(23);
      const writes = query.mock.calls.filter(
        ([sql]) =>
          Array.isArray(sql) && sql.join('').includes('INSERT INTO "IngestionQuota" AS bucket')
      );
      expect(writes).toHaveLength(2);
      expect(results.every(result => result.remaining >= 0)).toBe(true);
      expect(
        (await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } })).tokens
      ).toBeLessThan(1);
    } finally {
      query.mockRestore();
    }
  });

  it('enforces transaction-local synchronous admission even for an empty lock group', async () => {
    for (const identities of [[], [`durable-lock-${randomUUID()}`]]) {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL synchronous_commit = off`;
        await acquireDurableTextAdvisoryLocks(tx, identities);
        const [row] = await tx.$queryRaw<Array<{ value: string }>>`
          SELECT current_setting('synchronous_commit') AS value`;
        expect(row.value).toBe('on');
      });
    }
  });

  it('holds every batched identity against legacy writers until transaction completion', async () => {
    const identities = ['é', 'z', '😀', 'a', 'z'].map(key => `${randomUUID()}:${key}`);
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => {
      acquired = resolve;
    });
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const transaction = prisma.$transaction(async tx => {
      await acquireDurableTextAdvisoryLocks(tx, identities);
      acquired();
      await hold;
    });
    try {
      await Promise.race([
        ready,
        transaction.then(() => {
          throw new Error('Lock fixture ended early');
        }),
      ]);
      for (const identity of identities) {
        const [row] = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${identity}, 0)) AS acquired`;
        expect(row.acquired).toBe(false);
      }
    } finally {
      release();
      await transaction;
    }
    for (const identity of identities) {
      const [row] = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${identity}, 0)) AS acquired`;
      expect(row.acquired).toBe(true);
    }
  });

  it('automatically drains accepted events on an upgraded web replica without a mode flag', async () => {
    const previousMode = process.env.OPSKNIGHT_INGESTION_MODE;
    const previousRole = process.env.OPSKNIGHT_PROCESS_ROLE;
    delete process.env.OPSKNIGHT_INGESTION_MODE;
    process.env.OPSKNIGHT_PROCESS_ROLE = 'web';
    try {
      const receipts = await Promise.all([
        acceptPostgresEvent(envelope('upgrade-first')),
        acceptPostgresEvent(envelope('upgrade-second')),
      ]);
      startIngestionWorker();
      await expect
        .poll(
          async () =>
            prisma.ingestionReceipt.count({
              where: {
                id: { in: receipts.map(receipt => receipt.receiptId) },
                status: 'COMPLETED',
              },
            }),
          { timeout: 10000 }
        )
        .toBe(2);
      expect(await prisma.alert.count({ where: { serviceId } })).toBe(2);
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(2);
    } finally {
      await stopIngestionWorker();
      if (previousMode === undefined) delete process.env.OPSKNIGHT_INGESTION_MODE;
      else process.env.OPSKNIGHT_INGESTION_MODE = previousMode;
      if (previousRole === undefined) delete process.env.OPSKNIGHT_PROCESS_ROLE;
      else process.env.OPSKNIGHT_PROCESS_ROLE = previousRole;
    }
  });

  it('keeps web consumption on standby for a healthy dedicated worker and resumes after stale evidence', async () => {
    const previousMode = process.env.OPSKNIGHT_INGESTION_MODE;
    const previousRole = process.env.OPSKNIGHT_PROCESS_ROLE;
    delete process.env.OPSKNIGHT_INGESTION_MODE;
    process.env.OPSKNIGHT_PROCESS_ROLE = 'web';
    const instanceId = `fallback-test:${randomUUID()}`;
    try {
      await prisma.runtimeWorkerHeartbeat.create({
        data: {
          instanceId,
          lane: 'ingestion',
          role: 'ingestion-worker',
          running: true,
          lastSuccessAt: new Date(),
        },
      });
      expect(await hasHealthyDedicatedIngestionWorker()).toBe(true);
      const receipt = await acceptPostgresEvent(envelope('dedicated-handoff'));
      startIngestionWorker();
      await expect
        .poll(() => getIngestionWorkerHealth().lastSuccessAt, { timeout: 5000 })
        .not.toBeNull();
      expect(
        (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } }))
          .status
      ).toBe('PENDING');
      await stopIngestionWorker();
      await prisma.$executeRaw`UPDATE "RuntimeWorkerHeartbeat" SET "lastSeenAt" = clock_timestamp() - INTERVAL '31 seconds' WHERE "instanceId" = ${instanceId}`;
      expect(await hasHealthyDedicatedIngestionWorker()).toBe(false);
      startIngestionWorker();
      await expect
        .poll(
          async () =>
            (
              await prisma.ingestionReceipt.findUniqueOrThrow({
                where: { id: receipt.receiptId },
              })
            ).status,
          { timeout: 10000 }
        )
        .toBe('COMPLETED');
      expect(await prisma.alert.count({ where: { serviceId } })).toBe(1);
    } finally {
      await stopIngestionWorker();
      await prisma.runtimeWorkerHeartbeat.deleteMany({ where: { instanceId } });
      if (previousMode === undefined) delete process.env.OPSKNIGHT_INGESTION_MODE;
      else process.env.OPSKNIGHT_INGESTION_MODE = previousMode;
      if (previousRole === undefined) delete process.env.OPSKNIGHT_PROCESS_ROLE;
      else process.env.OPSKNIGHT_PROCESS_ROLE = previousRole;
    }
  });

  it('returns committed receipts after lost responses under exhausted quota without admitting unknown retries', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    try {
      const { POST } = await import('@/app/api/events/route');
      const current = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: 0,
          policy: {
            ...current.policy,
            quotas: { ...current.policy.quotas, eventsPerMinute: 1, eventsBurst: 1 },
          },
        },
        actorId
      );
      const integration = await prisma.integration.create({
        data: { serviceId, name: 'Replay fixture', type: 'EVENTS_API_V2', key: randomUUID() },
      });
      const delivery = randomUUID();
      const body = {
        event_action: 'trigger',
        dedup_key: 'lost-response',
        payload: {
          summary: 'Committed despite lost response',
          source: 'quota-replay',
          severity: 'warning',
        },
      };
      const request = (id: string | null = delivery, content = body, key = integration.key) =>
        POST(
          new NextRequest('http://localhost/api/events', {
            method: 'POST',
            headers: {
              Authorization: `Token token=${key}`,
              'Content-Type': 'application/json',
              ...(id ? { 'Idempotency-Key': id } : {}),
            },
            body: JSON.stringify(content),
          })
        );
      const original = await request();
      expect(original.status).toBe(202);
      const receiptId = (await original.json()).data.result.receiptId;
      const retryResponses = await Promise.all(Array.from({ length: 20 }, () => request()));
      for (const response of retryResponses) {
        expect(response.status).toBe(202);
        expect((await response.json()).data.result.receiptId).toBe(receiptId);
      }
      expect((await request(randomUUID())).status).toBe(429);
      expect((await request(null)).status).toBe(429);
      expect((await request(delivery, body, 'invalid-key')).status).toBeGreaterThanOrEqual(400);
      const prefix = `ingestion-replay:integration:${integration.id}:events:`;
      const before = await prisma.rateLimit.aggregate({
        where: { key: { startsWith: prefix } },
        _sum: { count: true },
      });
      expect(
        (
          await request(delivery, {
            ...body,
            payload: { ...body.payload, summary: 'Changed content' },
          })
        ).status
      ).toBe(409);
      const after = await prisma.rateLimit.aggregate({
        where: { key: { startsWith: prefix } },
        _sum: { count: true },
      });
      expect(after._sum.count! - before._sum.count!).toBe(1);
      await consumeIngestionBatch(4);
      await prisma.ingestionReceipt.update({
        where: { id: receiptId },
        data: { completedAt: new Date(0) },
      });
      await pruneCompletedIngestionPayloads(getMaintenanceClient());
      await applyIngestionCommand({ action: 'pause' }, actorId);
      const replay = await request();
      expect(replay.status).toBe(202);
      expect((await replay.json()).data.result.receiptId).toBe(receiptId);
      expect(await prisma.ingestionReceipt.count()).toBe(1);
      expect(await prisma.alert.count({ where: { serviceId } })).toBe(1);
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(1);
      expect(
        (
          await prisma.ingestionQuota.findUniqueOrThrow({
            where: { key: `integration:${integration.id}:events` },
          })
        ).tokens
      ).toBeLessThan(1);
      const window = Math.floor(Date.now() / 60000);
      await prisma.rateLimit.upsert({
        where: { key: `${prefix}${window}` },
        create: { key: `${prefix}${window}`, count: 600, expiresAt: new Date(Date.now() + 60000) },
        update: { count: 600 },
      });
      expect((await request()).status).toBe(429);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });

  it('replays an exhausted shared batch atomically and never appends a missing child', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    try {
      const { POST } = await import('@/app/api/integrations/prometheus/route');
      const current = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: 0,
          policy: {
            ...current.policy,
            quotas: { ...current.policy.quotas, integrationPerMinute: 1, integrationBurst: 1 },
          },
        },
        actorId
      );
      const integration = await prisma.integration.create({
        data: { serviceId, name: 'Replay batch', type: 'PROMETHEUS', key: randomUUID() },
      });
      const payload: PrometheusAlert = {
        version: '4',
        groupKey: 'batch-replay',
        status: 'firing',
        receiver: 'opsknight',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        externalURL: '',
        alerts: [0, 1].map(index => ({
          status: 'firing',
          labels: { alertname: `replay-${index}` },
          annotations: { summary: `Replay ${index}` },
          generatorURL: '',
          startsAt: '2026-10-23T00:00:00Z',
          fingerprint: `replay-${index}`,
        })),
      };
      const delivery = randomUUID();
      const request = (data = payload) =>
        POST(
          new NextRequest(
            `http://localhost/api/integrations/prometheus?integrationId=${integration.id}`,
            {
              method: 'POST',
              headers: {
                'x-integration-key': integration.key,
                'Content-Type': 'application/json',
                'Idempotency-Key': delivery,
              },
              body: JSON.stringify(data),
            }
          )
        );
      expect((await request()).status).toBe(202);
      const before = await prisma.ingestionReceipt.findMany({
        select: { id: true, idempotencyKey: true },
      });
      const batches = await prisma.ingestionBatch.count();
      for (const response of await Promise.all(Array.from({ length: 8 }, () => request())))
        expect(response.status).toBe(202);
      expect(await prisma.ingestionBatch.count()).toBe(batches);
      expect(await prisma.ingestionReceipt.count()).toBe(2);
      await prisma.ingestionReceipt.delete({ where: { id: before[1].id } });
      const missing = await request();
      expect(missing.status).toBe(429);
      expect(await prisma.ingestionReceipt.count()).toBe(1);
      expect(await prisma.ingestionBatch.count()).toBe(batches);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });

  it('supports exhausted-quota receipt recovery on the independent PagerDuty endpoint', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    try {
      const { POST } = await import('@/app/api/integrations/pagerduty/route');
      const current = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: 0,
          policy: {
            ...current.policy,
            quotas: { ...current.policy.quotas, integrationPerMinute: 1, integrationBurst: 1 },
          },
        },
        actorId
      );
      const integration = await prisma.integration.create({
        data: { serviceId, name: 'PagerDuty replay', type: 'PAGERDUTY', key: randomUUID() },
      });
      const delivery = randomUUID();
      const body = {
        event_action: 'trigger',
        dedup_key: 'pagerduty-replay',
        payload: {
          summary: 'PagerDuty durable retry',
          source: 'quota-replay',
          severity: 'warning',
        },
      };
      const request = (id = delivery) =>
        POST(
          new NextRequest(
            `http://localhost/api/integrations/pagerduty?integrationId=${integration.id}`,
            {
              method: 'POST',
              headers: {
                'x-routing-key': integration.key,
                'Content-Type': 'application/json',
                'Idempotency-Key': id,
              },
              body: JSON.stringify(body),
            }
          )
        );
      const original = await request();
      expect(original.status).toBe(202);
      const receipt = (await original.json()).receiptId;
      const replay = await request();
      expect(replay.status).toBe(202);
      expect((await replay.json()).receiptId).toBe(receipt);
      const missing = await request(randomUUID());
      expect(missing.status).toBe(429);
      expect(await missing.json()).toMatchObject({
        status: 'error',
        message: 'Rate limit exceeded',
      });
      expect(await prisma.ingestionReceipt.count()).toBe(1);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });

  it('releases admission locks before retrying a skipped budget reservation', async () => {
    let unlock!: () => void;
    let ready!: () => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observedContention = false;
    let releasedAdmissionLock = false;
    let probe: Promise<void> | undefined;
    const probeKey = `admission-retry-${randomUUID()}`;
    const held = new Promise<void>(resolve => {
      unlock = resolve;
    });
    const locked = new Promise<void>(resolve => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT "shard" FROM "IngestionBudget" ORDER BY "shard" FOR UPDATE`;
        ready();
        await held;
      },
      { timeout: 5000 }
    );
    const rollback = new Error('Rollback isolated reservation fixture');
    try {
      await locked;
      const { policy } = await getIngestionPolicy();
      const reservation = runReadCommittedTransaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${probeKey}, 0))`;
        const observed = new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== '$queryRaw') return Reflect.get(target, property, receiver);
            return async (...args: Parameters<Prisma.TransactionClient['$queryRaw']>) => {
              const result = await tx.$queryRaw(...args);
              if (Array.isArray(result) && result.length === 0 && !observedContention) {
                observedContention = true;
                // Release only after a real candidate query skipped every locked shard.
                timer = setTimeout(() => {
                  probe = prisma.$queryRaw<Array<{ available: boolean }>>`
                    SELECT pg_try_advisory_xact_lock(hashtextextended(${probeKey}, 0)) AS available
                  `
                    .then(rows => {
                      releasedAdmissionLock = rows[0].available;
                    })
                    .finally(unlock);
                }, 5);
              }
              return result;
            };
          },
        });
        const shard = await reserveIngestionBudget(observed, {
          policy,
          payloadBytes: 1000,
          critical: true,
          preferredShard: 0,
        });
        expect(observedContention).toBe(true);
        expect(shard).toBeTypeOf('number');
        throw rollback;
      });
      await expect(reservation).rejects.toBe(rollback);
      await probe;
      expect(releasedAdmissionLock).toBe(true);
    } finally {
      if (timer) clearTimeout(timer);
      unlock();
      await holder;
    }
    expect((await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending).toBe(
      0
    );
  });

  it('protects a warning promoted to P1 by pinned live Automation before evaluating its decision', async () => {
    const settings = await getIngestionPolicy();
    await applyIngestionCommand(
      {
        action: 'configure',
        expectedRevision: 0,
        policy: { ...settings.policy, maxPending: 64, criticalReservePercent: 25 },
      },
      actorId
    );
    for (let index = 0; index < 48; index++) {
      const ordinary = envelope(`ordinary-priority-${index}`);
      ordinary.event.payload.severity = 'warning';
      await acceptPostgresEvent(ordinary);
    }
    const promoted = envelope('automation-priority');
    promoted.event.payload.severity = 'warning';
    await expect(acceptPostgresEvent(promoted)).rejects.toBeInstanceOf(IngestionUnavailableError);
    const snapshot = {
      ...emptySnapshot,
      rules: [
        {
          id: 'promote',
          name: 'P1',
          enabled: true,
          phase: 'ENRICH' as const,
          conditions: [],
          actions: [{ type: 'SET_PRIORITY' as const, value: 'P1' as const }],
        },
      ],
    };
    const { compiled, issues } = compileAutomation(snapshot);
    expect(issues.filter(issue => issue.level === 'ERROR')).toHaveLength(0);
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
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: true },
    });
    const accepted = await acceptPostgresEvent(promoted);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: accepted.receiptId } }))
        .critical
    ).toBe(true);
    const claims = await claimPostgresEvents(4);
    const claim = claims.find(row => row.id === accepted.receiptId)!;
    expect(claim).toBeDefined();
    const decoded = decodeEnvelope(claim.envelope);
    await processEvent(decoded.event, decoded.serviceId, decoded.integrationId, decoded, {
      id: claim.id,
      token: claim.leaseToken!,
    });
    expect((await prisma.incident.findFirstOrThrow({ where: { serviceId } })).priority).toBe('P1');
  });

  it('naturally recovers a five-second abandoned lease and fences the previous worker', async () => {
    await acceptPostgresEvent(envelope('short-natural-lease'));
    await expect(claimPostgresEvents(1, 4999)).rejects.toThrow('Invalid ingestion lease duration');
    const [first] = await claimPostgresEvents(1, 5000);
    expect(await claimPostgresEvents(1, 5000)).toHaveLength(0);
    await new Promise(resolve => setTimeout(resolve, 5100));
    const [second] = await claimPostgresEvents(1, 5000);
    expect(second.id).toBe(first.id);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(
      runReadCommittedTransaction(tx =>
        completeProcessingReceipt(
          tx,
          { id: first.id, token: first.leaseToken },
          { action: 'created' }
        )
      )
    ).rejects.toBeInstanceOf(IngestionLeaseLostError);
    const decoded = decodeEnvelope(second.envelope);
    await processEvent(decoded.event, decoded.serviceId, decoded.integrationId, decoded, {
      id: second.id,
      token: second.leaseToken,
    });
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(1);
  });

  it('expires inactive quota keys only after all credit has replenished', async () => {
    const prefix = randomUUID();
    const old = new Date(Date.now() - 8 * 86400000);
    const data = {
      tokens: 0,
      rate: 1,
      burst: 10000000,
      updatedAt: old,
      lastAllowed: false,
      policyRevision: 0,
    };
    await prisma.ingestionQuota.createMany({
      data: [
        { ...data, key: `${prefix}-debt:events` },
        { ...data, key: `${prefix}-full:events`, burst: 120 },
        { ...data, key: `${prefix}-recent:events`, burst: 120, updatedAt: new Date() },
      ],
    });
    await pruneInactiveIngestionQuotas(getMaintenanceClient());
    expect(
      await prisma.ingestionQuota.findUnique({ where: { key: `${prefix}-full:events` } })
    ).toBeNull();
    expect(await prisma.ingestionQuota.count({ where: { key: { startsWith: prefix } } })).toBe(2);
  });

  it('reports global throughput independently of its top 100 integration rows', async () => {
    const accepted = await acceptPostgresEvent(envelope('metrics-many-integrations'));
    const base = await prisma.ingestionReceipt.findUniqueOrThrow({
      where: { id: accepted.receiptId },
    });
    await prisma.ingestionReceipt.createMany({
      data: Array.from({ length: 104 }, (_, index) => {
        const { sequence: _sequence, ...copy } = base;
        void _sequence;
        return {
          ...copy,
          envelope: base.envelope as Prisma.InputJsonValue,
          result: base.result === null ? Prisma.DbNull : (base.result as Prisma.InputJsonValue),
          id: randomUUID(),
          integrationId: `metrics-${index}`,
          idempotencyKey: randomUUID(),
          status: 'COMPLETED',
          completedAt: new Date(),
        };
      }),
    });
    const snapshot = await ingestionSnapshot();
    expect(snapshot.throughput.integrations).toHaveLength(100);
    expect(snapshot.throughput.limitedToTopIntegrations).toBe(true);
    expect(snapshot.throughput.acceptedPerSecond).toBe(105 / 60);
    expect(snapshot.throughput.completedPerSecond).toBe(104 / 60);
  });

  it('removes credential variants before receipts, shared context and incident processing persist them', async () => {
    const input = envelope('credential-variants');
    const secrets = {
      secret_key: 'sensitive-field-one',
      ssh_private_key: 'sensitive-field-two',
      authorization_header: 'sensitive-field-three',
      auth_header: 'sensitive-field-four',
    };
    input.providerPayload = { nested: [secrets], owner: 'oncall@example.test' };
    input.event.payload.custom_details = {
      ...secrets,
      owner: 'oncall@example.test',
      groupKey: 'business-group',
    };
    await acceptPostgresBatch(input, [input.event], ['credential-variants']);
    const receipts = await prisma.ingestionReceipt.findMany({ where: { serviceId } });
    const batches = await prisma.ingestionBatch.findMany({ where: { serviceId } });
    expect(
      JSON.stringify({ receipts, batches }, (_key, value) =>
        typeof value === 'bigint' ? String(value) : value
      )
    ).not.toContain('sensitive-field-');
    await consumeIngestionBatch();
    const alerts = await prisma.alert.findMany({ where: { serviceId } });
    const incidents = await prisma.incident.findMany({ where: { serviceId } });
    expect(alerts).toHaveLength(1);
    expect(incidents).toHaveLength(1);
    const persisted = JSON.stringify({ alerts, incidents }, (_key, value) =>
      typeof value === 'bigint' ? String(value) : value
    );
    expect(persisted).not.toContain('sensitive-field-');
    expect(persisted).toContain('oncall@example.test');
    expect(persisted).toContain('business-group');
  });

  it('keeps accepted disabled Automation independent of later settings changes', async () => {
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: true },
    });
    await runReadCommittedTransaction(async tx => {
      const guarded = new Proxy(tx, {
        get(target, property, receiver) {
          if (property === 'systemSettings')
            throw new Error('Disabled acceptance must not read settings');
          return Reflect.get(target, property, receiver);
        },
      });
      for (const automationSnapshot of [
        null,
        { mode: 'DISABLED' as const, activeVersionId: null, candidateVersionId: null },
      ]) {
        expect(
          await prepareAutomation(
            guarded,
            { ...envelope(), automationSnapshot },
            { priority: null, urgency: 'HIGH' }
          )
        ).toBeNull();
      }
    });
  });

  it('rolls back completion and incident creation if the reserved budget is unavailable', async () => {
    await acceptPostgresEvent(envelope());
    const [claim] = await claimPostgresEvents(1);
    const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: claim.id } });
    const lease = { id: claim.id, token: claim.leaseToken };
    await expect(
      runReadCommittedTransaction(async tx => {
        await lockProcessingReceipt(tx, lease);
        await tx.ingestionBudget.delete({ where: { shard: receipt.budgetShard } });
        await tx.incident.create({ data: { title: 'must roll back', serviceId } });
        await completeProcessingReceipt(tx, lease, { action: 'created' });
      })
    ).rejects.toBeInstanceOf(IngestionUnavailableError);
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(0);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: claim.id } })).status
    ).toBe('PROCESSING');
    expect(
      (await prisma.ingestionBudget.findUniqueOrThrow({ where: { shard: receipt.budgetShard } }))
        .pending
    ).toBe(1);
  });

  it('never replaces an unexpired lease when severity-lane consumers race', async () => {
    for (let round = 0; round < 10; round++) {
      const input = envelope(`lease-race-${round}`);
      if (round % 2) input.event.payload.severity = 'warning';
      const accepted = await acceptPostgresEvent(input);
      const results = await Promise.all(Array.from({ length: 16 }, () => claimPostgresEvents(4)));
      const claimed = results.flat().filter(claim => claim.id === accepted.receiptId);
      expect(claimed).toHaveLength(1);
      const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({
        where: { id: accepted.receiptId },
      });
      expect(receipt.leaseToken).toBe(claimed[0].leaseToken);
      expect(receipt.attempts).toBe(1);
      expect(receipt.status).toBe('PROCESSING');
    }
  });

  it('preserves critical backlog reservation while ordinary traffic fills its capacity', async () => {
    const initial = await getIngestionPolicy();
    await applyIngestionCommand(
      {
        action: 'configure',
        expectedRevision: 0,
        policy: { ...initial.policy, maxPending: 64, criticalReservePercent: 25 },
      },
      actorId
    );
    for (let index = 0; index < 48; index++) {
      const input = envelope(`ordinary-${index}`);
      input.event.payload.severity = 'warning';
      await acceptPostgresEvent(input, `ordinary-${index}`);
    }
    const overflow = envelope('ordinary-overflow');
    overflow.event.payload.severity = 'warning';
    await expect(acceptPostgresEvent(overflow)).rejects.toBeInstanceOf(IngestionUnavailableError);
    for (let index = 0; index < 16; index++)
      await acceptPostgresEvent(envelope(`critical-${index}`), `critical-${index}`);
    expect(await prisma.ingestionReceipt.count()).toBe(64);
    await expect(acceptPostgresEvent(envelope('critical-overflow'))).rejects.toBeInstanceOf(
      IngestionUnavailableError
    );
  });

  it('reserves claim slots for both severity lanes without violating same-key order', async () => {
    for (let index = 0; index < 8; index++) {
      const input = envelope(`standard-${index}`);
      input.event.payload.severity = 'warning';
      await acceptPostgresEvent(input);
    }
    const critical = await acceptPostgresEvent(envelope('critical-late'));
    const claims = await claimPostgresEvents(4);
    expect(claims).toHaveLength(4);
    expect(claims.map(claim => claim.id)).toContain(critical.receiptId);
    expect(
      (
        await prisma.ingestionReceipt.findMany({
          where: { id: { in: claims.map(claim => claim.id) }, critical: false },
        })
      ).length
    ).toBeGreaterThanOrEqual(1);
    const earlier = envelope('ordered-severity');
    earlier.event.payload.severity = 'warning';
    const first = await acceptPostgresEvent(earlier);
    const second = await acceptPostgresEvent(envelope('ordered-severity'));
    const next = await claimPostgresEvents(32);
    expect(next.map(claim => claim.id)).toContain(first.receiptId);
    expect(next.map(claim => claim.id)).not.toContain(second.receiptId);
  });

  it('cannot expire a minimized receipt while a concurrent hold is being created', async () => {
    const accepted = await acceptPostgresEvent(envelope('terminal-hold-race'));
    await consumeIngestionBatch(1);
    const incident = await prisma.incident.findFirstOrThrow({ where: { serviceId } });
    await prisma.ingestionReceipt.update({
      where: { id: accepted.receiptId },
      data: { completedAt: new Date(Date.now() - 91 * 86400000) },
    });
    await pruneCompletedIngestionPayloads(getMaintenanceClient());
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>(resolve => {
      acquired = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    const holding = prisma.$transaction(async tx => {
      await acquireRetentionResourceLock(tx, 'INCIDENT', incident.id);
      acquired();
      await released;
      await tx.dataRetentionHold.create({
        data: {
          scopeType: 'INCIDENT',
          scopeId: incident.id,
          reason: 'Concurrent terminal evidence hold',
          createdById: actorId,
        },
      });
    });
    await locked;
    try {
      expect(await pruneExpiredIngestionReceipts(getMaintenanceClient())).toBe(0);
    } finally {
      release();
    }
    await holding;
    expect(await pruneExpiredIngestionReceipts(getMaintenanceClient())).toBe(0);
    expect(
      await prisma.ingestionReceipt.findUnique({ where: { id: accepted.receiptId } })
    ).not.toBeNull();
  });

  it('expires only minimized terminal receipts and preserves held, recent and unfinished work', async () => {
    const expired = await acceptPostgresEvent(envelope('expired-terminal'), 'expired-terminal');
    const held = await acceptPostgresEvent(envelope('held-terminal'), 'held-terminal');
    const recent = await acceptPostgresEvent(envelope('recent-terminal'), 'recent-terminal');
    await consumeIngestionBatch(4);
    const unfinished = await acceptPostgresEvent(
      envelope('unfinished-terminal'),
      'unfinished-terminal'
    );
    const old = new Date(Date.now() - 91 * 86400000);
    await prisma.ingestionReceipt.updateMany({
      where: { id: { in: [expired.receiptId, held.receiptId, unfinished.receiptId] } },
      data: { acceptedAt: old, completedAt: old },
    });
    // Payloads must be minimized through the hold-aware lifecycle first.
    expect(await pruneExpiredIngestionReceipts(getMaintenanceClient())).toBe(0);
    expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(2);
    const result = (
      await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: held.receiptId } })
    ).result as { incidentId: string };
    const hold = await prisma.dataRetentionHold.create({
      data: {
        scopeType: 'INCIDENT',
        scopeId: result.incidentId,
        reason: 'Keep terminal ingestion evidence',
        createdById: actorId,
      },
    });
    expect(await pruneExpiredIngestionReceipts(getMaintenanceClient())).toBe(1);
    expect(
      await prisma.ingestionReceipt.findUnique({ where: { id: expired.receiptId } })
    ).toBeNull();
    for (const receiptId of [held.receiptId, recent.receiptId, unfinished.receiptId])
      expect(await prisma.ingestionReceipt.findUnique({ where: { id: receiptId } })).not.toBeNull();
    const retried = await acceptPostgresEvent(envelope('expired-terminal'), 'expired-terminal');
    expect(retried.receiptId).not.toBe(expired.receiptId);
    await prisma.dataRetentionHold.update({
      where: { id: hold.id },
      data: { releasedAt: new Date() },
    });
    expect(await pruneExpiredIngestionReceipts(getMaintenanceClient())).toBe(1);
  });

  it('expires shared batch metadata only after every minimized child has expired', async () => {
    const { event, ...input } = envelope('expired-batch');
    await acceptPostgresBatch(input, [event], ['expired-batch']);
    await consumeIngestionBatch(1);
    const old = new Date(Date.now() - 91 * 86400000);
    await prisma.ingestionReceipt.updateMany({ data: { completedAt: old } });
    await prisma.ingestionBatch.updateMany({ data: { createdAt: old } });
    await pruneCompletedIngestionPayloads(getMaintenanceClient());
    expect(await pruneExpiredIngestionReceipts(getMaintenanceClient())).toBe(0);
    expect(await pruneExpiredIngestionBatches(getMaintenanceClient())).toBe(0);
    expect(await pruneSharedIngestionPayloads(getMaintenanceClient())).toBe(1);
    expect(await pruneExpiredIngestionBatches(getMaintenanceClient())).toBe(0);
    expect(await pruneExpiredIngestionReceipts(getMaintenanceClient())).toBe(1);
    expect(await pruneExpiredIngestionBatches(getMaintenanceClient())).toBe(1);
    expect(await prisma.ingestionBatch.count()).toBe(0);
  });

  it('applies live capacity settings, preserves accepted work and fences stale admin writes', async () => {
    const initial = await getIngestionPolicy();
    const policy = { ...initial.policy, maxPending: 64, payloadRetentionHours: 1 };
    const writes = await Promise.allSettled([
      applyIngestionCommand({ action: 'configure', expectedRevision: 0, policy }, actorId),
      applyIngestionCommand({ action: 'configure', expectedRevision: 0, policy }, actorId),
    ]);
    expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getIngestionPolicy()).revision).toBe(1);
    for (let index = 0; index < 64; index++)
      await acceptPostgresEvent(envelope(`online-${index}`), `online-${index}`);
    await expect(acceptPostgresEvent(envelope('online-overflow'))).rejects.toBeInstanceOf(
      IngestionUnavailableError
    );
    await applyIngestionCommand({ action: 'pause' }, actorId);
    expect(await getIngestionPolicy()).toEqual({ paused: true, revision: 2, policy });
    await applyIngestionCommand({ action: 'resume' }, actorId);
    expect(await getIngestionPolicy()).toEqual({ paused: false, revision: 3, policy });
    await expect(
      applyIngestionCommand(
        { action: 'configure', expectedRevision: 1, policy: initial.policy },
        actorId
      )
    ).rejects.toThrow('settings changed');
    expect(await prisma.ingestionReceipt.count()).toBe(64);
    await consumeIngestionBatch(1);
    await prisma.ingestionReceipt.updateMany({
      where: { status: 'COMPLETED' },
      data: { completedAt: new Date(Date.now() - 2 * 3600000) },
    });
    expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(1);
    await applyIngestionCommand(
      { action: 'configure', expectedRevision: 3, policy: { ...policy, maxPending: 128 } },
      actorId
    );
    await acceptPostgresEvent(envelope('online-new-capacity'));
    expect(await prisma.ingestionReceipt.count()).toBe(65);
  });

  it('fails closed on malformed persisted operational policy', async () => {
    await prisma.systemConfig.create({
      data: { key: 'ingestion_control', value: { paused: false, policy: { concurrency: 999 } } },
    });
    await expect(acceptPostgresEvent(envelope('bad-policy'))).rejects.toThrow();
    expect(await prisma.ingestionReceipt.count()).toBe(0);
    expect((await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending).toBe(
      0
    );
  });

  it('exposes delayed arrival and processing separately while SLA clocks start at operational activation', async () => {
    const input = envelope('delayed-clock');
    input.receivedAt = new Date(Date.now() - 2 * 3600000);
    const accepted = await acceptPostgresEvent(input, 'delayed-clock');
    await prisma.ingestionReceipt.update({
      where: { id: accepted.receiptId },
      data: { acceptedAt: input.receivedAt },
    });
    const started = Date.now();
    await consumeIngestionBatch();
    const incident = await prisma.incident.findFirstOrThrow({ where: { serviceId } });
    const alert = await prisma.alert.findFirstOrThrow({ where: { serviceId } });
    const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({
      where: { id: accepted.receiptId },
    });
    expect(receipt.receivedAt).toEqual(input.receivedAt);
    expect(alert.createdAt).toEqual(input.receivedAt);
    expect(receipt.processingStartedAt!.getTime()).toBeGreaterThanOrEqual(started - 1000);
    expect(incident.createdAt.getTime()).toBeGreaterThanOrEqual(started);
    expect(incident.slaTargetCapturedAt!.getTime()).toBeGreaterThanOrEqual(started);
    expect(receipt.completedAt!.getTime()).toBeGreaterThanOrEqual(incident.createdAt.getTime());
    expect(receipt.result).toMatchObject({
      operationalActivatedAt: incident.createdAt.toISOString(),
    });
  });

  it('stores large webhook context once and restores each child for Automation and processing', async () => {
    const payload: PrometheusAlert = {
      version: '4',
      groupKey: 'batch',
      status: 'firing',
      receiver: 'opsknight',
      groupLabels: {},
      commonLabels: {},
      commonAnnotations: {},
      externalURL: '',
      alerts: Array.from({ length: 40 }, (_, index) => ({
        status: 'firing',
        labels: { alertname: `batch-${index}` },
        annotations: { summary: `Batch child ${index}`, context: 'x'.repeat(8000) },
        generatorURL: '',
        startsAt: '2026-10-23T00:00:00Z',
        fingerprint: `batch-${index}`,
      })),
    };
    const events = transformPrometheusToEvent(payload);
    const input = {
      serviceId,
      integrationId: 'integration',
      integrationType: 'PROMETHEUS',
      providerPayload: payload,
      receivedAt: new Date(),
    };
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    try {
      const results = await withIngestionDelivery('large-batch', () =>
        processIntegrationBatch(input, events)
      );
      expect(results).toHaveLength(40);
      const receipts = await prisma.ingestionReceipt.findMany({ orderBy: { sequence: 'asc' } });
      expect(new Set(receipts.map(receipt => receipt.batchId)).size).toBe(1);
      const batch = await prisma.ingestionBatch.findUniqueOrThrow({
        where: { id: receipts[0].batchId! },
      });
      const storedBytes =
        Buffer.byteLength(JSON.stringify(batch.payload)) +
        receipts.reduce(
          (total, receipt) => total + Buffer.byteLength(JSON.stringify(receipt.envelope)),
          0
        );
      expect(storedBytes).toBeLessThan(1024 * 1024);
      const restored = await decodeReceiptEnvelope(receipts[0].envelope);
      expect(restored.providerPayload).toEqual(payload);
      expect(restored.event.payload.custom_details).toEqual(events[0].payload.custom_details);
      const repeated = await withIngestionDelivery('large-batch', () =>
        processIntegrationBatch(input, events)
      );
      expect(repeated).toEqual(results);
      expect(await prisma.ingestionReceipt.count()).toBe(40);
      expect(await prisma.ingestionBatch.count({ where: { serviceId } })).toBe(1);
      while (await consumeIngestionBatch(8)) {
        /* drain independently keyed children */
      }
      expect(await prisma.incident.count({ where: { serviceId } })).toBe(40);
      await prisma.ingestionReceipt.updateMany({ data: { completedAt: new Date(0) } });
      const incident = await prisma.incident.findFirstOrThrow({ where: { serviceId } });
      const hold = await prisma.dataRetentionHold.create({
        data: {
          scopeType: 'INCIDENT',
          scopeId: incident.id,
          reason: 'Preserve shared provider evidence',
          createdById: actorId,
        },
      });
      expect(await pruneSharedIngestionPayloads(getMaintenanceClient())).toBe(0);
      expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(39);
      expect(await pruneSharedIngestionPayloads(getMaintenanceClient())).toBe(0);
      await prisma.dataRetentionHold.update({
        where: { id: hold.id },
        data: { releasedAt: new Date() },
      });
      expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(1);
      expect(await pruneSharedIngestionPayloads(getMaintenanceClient())).toBeGreaterThanOrEqual(1);
      expect(
        (await prisma.ingestionBatch.findUniqueOrThrow({ where: { id: batch.id } })).payload
      ).toBeNull();
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });

  it('preserves shared evidence when a hold is created after child pruning, including concurrent creation', async () => {
    const input = envelope('shared-hold-race');
    const [accepted] = await acceptPostgresBatch(input, [input.event], ['shared-hold-race']);
    await consumeIngestionBatch();
    const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({
      where: { id: accepted.receiptId },
    });
    const incident = await prisma.incident.findFirstOrThrow({ where: { serviceId } });
    await prisma.ingestionReceipt.update({
      where: { id: receipt.id },
      data: { completedAt: new Date(0) },
    });
    expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(1);
    let locked!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>(resolve => {
      locked = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    const creatingHold = prisma.$transaction(async tx => {
      await acquireRetentionResourceLock(tx, 'INCIDENT', incident.id);
      locked();
      await released;
      return tx.dataRetentionHold.create({
        data: {
          scopeType: 'INCIDENT',
          scopeId: incident.id,
          reason: 'Protect shared context after child retention',
          createdById: actorId,
        },
      });
    });
    await acquired;
    try {
      expect(await pruneSharedIngestionPayloads(getMaintenanceClient())).toBe(0);
    } finally {
      release();
    }
    const hold = await creatingHold;
    expect(await pruneSharedIngestionPayloads(getMaintenanceClient())).toBe(0);
    expect(
      (await prisma.ingestionBatch.findUniqueOrThrow({ where: { id: receipt.batchId! } })).payload
    ).not.toBeNull();
    await prisma.dataRetentionHold.update({
      where: { id: hold.id },
      data: { releasedAt: new Date() },
    });
    expect(await pruneSharedIngestionPayloads(getMaintenanceClient())).toBeGreaterThanOrEqual(1);
  });

  it('reuses per-event receipts accepted by the older unshared batch path', async () => {
    const input = envelope('older-batch');
    const old = await acceptPostgresEvent(input, 'old-request:0');
    const results = await acceptPostgresBatch(
      input,
      [input.event, envelope('new-child').event],
      ['old-request:0', 'old-request:1']
    );
    expect(results[0]).toEqual(old);
    expect(await prisma.ingestionReceipt.count()).toBe(2);
    expect(await consumeIngestionBatch(8)).toBe(2);
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(2);
  });

  it('quarantines corrupted shared context without materializing an incident', async () => {
    const input = envelope('corrupted-batch');
    const [accepted] = await acceptPostgresBatch(input, [input.event], ['corrupted:0']);
    const receipt = await prisma.ingestionReceipt.findUniqueOrThrow({
      where: { id: accepted.receiptId },
    });
    await prisma.ingestionBatch.update({
      where: { id: receipt.batchId! },
      data: { payload: { value: { modified: true } } },
    });
    expect(await consumeIngestionBatch()).toBe(1);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).status
    ).toBe('DEAD');
    expect(await prisma.incident.count({ where: { serviceId } })).toBe(0);
    expect(await prisma.alert.count({ where: { serviceId } })).toBe(0);
  });

  it('rolls back an entire multi-event admission if capacity runs out after its first child', async () => {
    process.env.OPSKNIGHT_INGESTION_MAX_PENDING = '64';
    try {
      for (let index = 0; index < 63; index++)
        await acceptPostgresEvent(envelope(`existing-${index}`), `existing-${index}`);
      const input = envelope('batch-a');
      const events = [input.event, envelope('batch-b').event];
      await expect(
        acceptPostgresBatch(input, events, ['batch:0', 'batch:1'])
      ).rejects.toBeInstanceOf(IngestionUnavailableError);
      expect(await prisma.ingestionReceipt.count()).toBe(63);
      expect(await prisma.ingestionBatch.count({ where: { serviceId } })).toBe(0);
      expect(
        (await prisma.ingestionBudget.findMany()).reduce((sum, row) => sum + row.pending, 0)
      ).toBe(63);
      await consumeIngestionBatch(8);
      const results = await acceptPostgresBatch(input, events, ['batch:0', 'batch:1']);
      expect(results).toHaveLength(2);
      const again = await acceptPostgresBatch(input, events, ['batch:0', 'batch:1']);
      expect(again).toEqual(results);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MAX_PENDING;
    }
  });

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
      expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(0);
    } finally {
      release();
      await creation;
    }
    expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(0);
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
    expect(await collectIngestionQueueMetrics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'DEAD', count: 1 }),
        expect.objectContaining({ status: 'PENDING', count: 1 }),
      ])
    );
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
    expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(0);
    expect(
      (await prisma.ingestionReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } }))
        .envelope
    ).not.toBeNull();
    await prisma.dataRetentionHold.update({
      where: { id: hold.id },
      data: { releasedAt: new Date() },
    });
    expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(1);
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
  it('preserves explicit synchronous rollback and legacy payload sizes', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'sync';
    try {
      const input = envelope('legacy');
      input.event.payload.custom_details = { blob: 'x'.repeat(300000) };
      const result = await processIntegrationEvent(input);
      expect(result.action).toBe('triggered');
      expect(result.incident?.serviceId).toBe(serviceId);
      expect('receiptId' in result).toBe(false);
      expect(await prisma.ingestionReceipt.count()).toBe(0);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });

  it('also supports explicit durable mode', async () => {
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
    expect(await pruneCompletedIngestionPayloads(getMaintenanceClient())).toBe(1);
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
  it('shares burst credit under concurrent requests and refills without a window reset', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    try {
      const current = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: current.revision,
          policy: {
            ...current.policy,
            quotas: { ...current.policy.quotas, eventsPerMinute: 1, eventsBurst: 23 },
          },
        },
        actorId
      );
      const key = `quota-${randomUUID()}:events`;
      const results = await Promise.all(
        Array.from({ length: 40 }, () => checkIngestionQuota(key, 120, 60000))
      );
      expect(results.filter(result => result.allowed)).toHaveLength(23);
      const stored = await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } });
      expect(stored.tokens).toBeGreaterThanOrEqual(0);
      expect(stored.tokens).toBeLessThan(1);
      // Database-clock advance via fixture row only; production never modifies time.
      await prisma.ingestionQuota.update({
        where: { key },
        data: { updatedAt: new Date(Date.now() - 61000) },
      });
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(true);
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(false);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });

  it('keeps exhausted quota debt across live policy changes and isolates integration keys', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    try {
      const current = await getIngestionPolicy();
      const quotas = {
        eventsPerMinute: 1,
        eventsBurst: 2,
        integrationPerMinute: 1,
        integrationBurst: 1,
      };
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: current.revision,
          policy: { ...current.policy, quotas },
        },
        actorId
      );
      const key = `quota-live-${randomUUID()}:events`;
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(true);
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(true);
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(false);
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: current.revision + 1,
          policy: { ...current.policy, quotas: { ...quotas, eventsBurst: 10 } },
        },
        actorId
      );
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(false);
      const provider = `integration:${randomUUID()}`;
      expect((await checkIngestionQuota(provider, 100, 60000)).allowed).toBe(true);
      expect((await checkIngestionQuota(provider, 100, 60000)).allowed).toBe(false);
      expect((await checkIngestionQuota(`integration:${randomUUID()}`, 100, 60000)).allowed).toBe(
        true
      );
      const latest = await getIngestionPolicy();
      const { quotas: omitted, ...olderFormPolicy } = latest.policy;
      expect(omitted.eventsBurst).toBe(10);
      await applyIngestionCommand(
        { action: 'configure', expectedRevision: latest.revision, policy: olderFormPolicy },
        actorId
      );
      expect((await getIngestionPolicy()).policy.quotas.eventsBurst).toBe(10);
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(false);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MODE;
    }
  });
  it('coalesces mixed quota keys without transferring credit or exceeding per-key bursts', async () => {
    const current = await getIngestionPolicy();
    await applyIngestionCommand({ action: 'configure', expectedRevision: current.revision,
      policy: { ...current.policy, quotas: {
        eventsPerMinute: 1, eventsBurst: 1, integrationPerMinute: 1, integrationBurst: 2,
      } },
    }, actorId);
    const keys = Array.from({ length: 32 }, (_, index) =>
      `mixed-quota-${randomUUID()}${index % 2 ? ':events' : ':integration'}`);
    const requests = keys.flatMap(key => Array.from({ length: 3 }, () => key));
    const decisions = await Promise.all(requests.map(key => checkIngestionQuota(key, 120, 60000)));
    for (const key of keys) {
      const allowed = decisions.filter((decision, index) => requests.at(index) === key && decision.allowed);
      expect(allowed).toHaveLength(key.endsWith(':events') ? 1 : 2);
      const row = await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } });
      expect(row.tokens).toBeGreaterThanOrEqual(0);
      expect(row.tokens).toBeLessThan(1);
    }
  });

  it('fences stale quota policy readers and never refills a reduced quota at the previous rate', async () => {
    process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
    let release = () => {};
    let stale: Promise<unknown> | undefined;
    try {
      const initial = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: initial.revision,
          policy: {
            ...initial.policy,
            quotas: { ...initial.policy.quotas, eventsPerMinute: 10000000, eventsBurst: 100 },
          },
        },
        actorId
      );
      const key = `quota-stale-${randomUUID()}:events`;
      await checkIngestionQuota(key, 120, 60000);
      await prisma.ingestionQuota.update({
        where: { key },
        data: { tokens: 0, updatedAt: new Date(Date.now() - 2000) },
      });
      let started = () => {};
      const blocked = new Promise<void>(resolve => {
        started = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const delayed = new Proxy(prisma, {
        get(target, property, receiver) {
          if (property === '$queryRaw')
            return new Proxy(target.$queryRaw, {
              async apply(query, _receiver, args) {
                started();
                await gate;
                return Reflect.apply(query, target, args);
              },
            });
          return Reflect.get(target, property, receiver);
        },
      });
      stale = checkIngestionQuota(key, 120, 60000, delayed);
      await blocked;
      const latest = await getIngestionPolicy();
      await applyIngestionCommand(
        {
          action: 'configure',
          expectedRevision: latest.revision,
          policy: { ...latest.policy, quotas: { ...latest.policy.quotas, eventsPerMinute: 1 } },
        },
        actorId
      );
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(false);
      release();
      expect(await stale).toMatchObject({ allowed: false });
      expect(await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } })).toMatchObject({
        rate: 1,
        policyRevision: BigInt(latest.revision + 1),
      });
      await prisma.ingestionQuota.update({
        where: { key },
        data: { updatedAt: new Date(Date.now() - 2000) },
      });
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(false);
      const future = new Date(Date.now() + 60000);
      await prisma.ingestionQuota.update({
        where: { key },
        data: { tokens: 0, updatedAt: future },
      });
      expect((await checkIngestionQuota(key, 120, 60000)).allowed).toBe(false);
      expect((await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } })).updatedAt).toEqual(
        future
      );
    } finally {
      release();
      await stale?.catch(() => undefined);
      delete process.env.OPSKNIGHT_INGESTION_MODE;
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

  it('spreads a commit group across its reserved budget shards instead of concentrating completion locks', async () => {
    const { policy } = await getIngestionPolicy();
    const shards = await prisma.$transaction(tx =>
      reserveIngestionBudgets(
        tx,
        policy,
        Array.from({ length: 32 }, () => ({ payloadBytes: 100, critical: true, preferredShard: 0 }))
      )
    );
    const counts = new Map<number, number>();
    for (const shard of shards) {
      expect(shard).toBeDefined();
      counts.set(shard!, (counts.get(shard!) ?? 0) + 1);
    }
    expect(counts.size).toBe(8);
    expect([...counts.values()]).toEqual(Array(8).fill(4));
    const rows = await prisma.ingestionBudget.findMany({ where: { pending: { gt: 0 } } });
    expect(rows).toHaveLength(8);
    expect(rows.every(row => row.pending === 4 && row.bytes === BigInt(400))).toBe(true);
  });

  it('rolls back a partially locked group before retrying without leaking reservations', async () => {
    let ready!: () => void;
    let unlock!: () => void;
    const locked = new Promise<void>(resolve => {
      ready = resolve;
    });
    const release = new Promise<void>(resolve => {
      unlock = resolve;
    });
    const holder = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT "shard" FROM "IngestionBudget" WHERE "shard" <> 0 ORDER BY "shard" FOR UPDATE`;
        ready();
        await release;
      },
      { timeout: 5000 }
    );
    let probe: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let skipped = false;
    let freedPrefix = false;
    let attempts = 0;
    try {
      await locked;
      const { policy } = await getIngestionPolicy();
      const assignments = await runReadCommittedTransaction(async tx => {
        attempts++;
        const observed = new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== '$queryRaw') return Reflect.get(target, property, receiver);
            return async (...args: Parameters<Prisma.TransactionClient['$queryRaw']>) => {
              const result = await tx.$queryRaw(...args);
              if (Array.isArray(result) && result.length === 0 && !skipped) {
                skipped = true;
                timer = setTimeout(() => {
                  probe = prisma.$queryRaw<Array<{ shard: number }>>`
                    SELECT "shard" FROM "IngestionBudget" WHERE "shard"=0 FOR UPDATE SKIP LOCKED
                  `
                    .then(rows => {
                      freedPrefix = rows.length === 1;
                    })
                    .finally(unlock);
                }, 5);
              }
              return result;
            };
          },
        });
        return reserveIngestionBudgets(
          observed,
          { ...policy, maxPending: 64 },
          Array.from({ length: 4 }, () => ({
            payloadBytes: 100,
            critical: true,
            preferredShard: 0,
          }))
        );
      });
      await probe;
      expect(freedPrefix).toBe(true);
      expect(attempts).toBeGreaterThan(1);
      expect(assignments.every(shard => shard !== undefined)).toBe(true);
      const totals = await prisma.ingestionBudget.aggregate({
        _sum: { pending: true, bytes: true },
      });
      expect(totals._sum).toEqual({ pending: 4, bytes: BigInt(400) });
    } finally {
      if (timer) clearTimeout(timer);
      unlock();
      await holder;
      await probe;
    }
  });

  it('retries an entire provider batch with stable child identities and no accepted prefix', async () => {
    const settings = await getIngestionPolicy();
    await applyIngestionCommand(
      {
        action: 'configure',
        expectedRevision: settings.revision,
        policy: { ...settings.policy, maxPending: 64, criticalReservePercent: 0 },
      },
      actorId
    );
    let ready!: () => void;
    let unlock!: () => void;
    const locked = new Promise<void>(resolve => {
      ready = resolve;
    });
    const release = new Promise<void>(resolve => {
      unlock = resolve;
    });
    const holder = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT "shard" FROM "IngestionBudget" WHERE "shard" <> 0 ORDER BY "shard" FOR UPDATE`;
        ready();
        await release;
      },
      { timeout: 5000 }
    );
    const insertedKeys: string[] = [];
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    prisma.$on('query', event => {
      if (!active) return;
      if (/INSERT INTO ("public"\.)?"IngestionReceipt"/.test(event.query)) {
        const columns = event.query
          .slice(event.query.indexOf('(') + 1, event.query.indexOf(')'))
          .split(',')
          .map(column => column.trim().replaceAll('"', ''));
        const values: unknown[] = JSON.parse(event.params);
        const key = values.at(columns.indexOf('idempotencyKey'));
        if (typeof key === 'string') insertedKeys.push(key);
      }
      if (!timer && event.query.includes('EXISTS') && event.query.includes('"IngestionBudget"'))
        timer = setTimeout(unlock, 5);
    });
    try {
      await locked;
      const input = envelope('batch-retry-first');
      const receipts = await acceptPostgresBatch(
        input,
        [input.event, envelope('batch-retry-second').event],
        [undefined, undefined]
      );
      expect(timer).toBeDefined();
      expect(insertedKeys.length).toBeGreaterThan(2);
      const persisted = await prisma.ingestionReceipt.findMany({
        select: { id: true, idempotencyKey: true },
      });
      expect(persisted).toHaveLength(2);
      expect(persisted.map(row => row.idempotencyKey)).toContain(insertedKeys[0]);
      expect(new Set(persisted.map(row => row.id))).toEqual(
        new Set(receipts.map(row => row.receiptId))
      );
      expect(await prisma.ingestionBatch.count()).toBe(1);
      expect(
        (await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending
      ).toBe(2);
    } finally {
      active = false;
      if (timer) clearTimeout(timer);
      unlock();
      await holder;
    }
  });

  it('recovers a provider batch when its commit succeeds but the commit reply is lost', async () => {
    const transaction = prisma.$transaction.bind(prisma);
    let committedIds: string[] = [];
    const intercept = vi.spyOn(prisma, '$transaction').mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: {
        isolationLevel?: Prisma.TransactionIsolationLevel;
        timeout?: number;
        maxWait?: number;
      }
    ) => {
      await transaction(callback, options);
      committedIds = (await prisma.ingestionReceipt.findMany({ select: { id: true } })).map(
        row => row.id
      );
      throw new Prisma.PrismaClientKnownRequestError('Owned commit-response-loss fixture', {
        code: 'P2028',
        clientVersion: '5.22.0',
      });
    }) as never);
    try {
      const input = envelope('committed-batch-first');
      const recovered = await acceptPostgresBatch(
        input,
        [input.event, envelope('committed-batch-second').event],
        [undefined, undefined]
      );
      expect(new Set(recovered.map(row => row.receiptId))).toEqual(new Set(committedIds));
      expect(await prisma.ingestionReceipt.count()).toBe(2);
      expect(await prisma.ingestionBatch.count()).toBe(1);
      expect(
        (await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending
      ).toBe(2);
    } finally {
      intercept.mockRestore();
    }
  });

  it('group commits independent requests and isolates conflicting delivery errors', async () => {
    const existing = await acceptPostgresEvent(envelope('existing'), 'existing-delivery');
    const input = envelope('group-original');
    const requests = [
      acceptPostgresEvent(input, 'group-delivery'),
      acceptPostgresEvent(input, 'group-delivery'),
      acceptPostgresEvent(envelope('conflicting-key'), 'group-delivery'),
      ...Array.from({ length: 29 }, (_, index) =>
        acceptPostgresEvent(envelope(`group-independent-${index}`), `group-independent-${index}`)
      ),
    ];
    const outcomes = await Promise.allSettled(requests);
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(31);
    expect(outcomes[2].status).toBe('rejected');
    if (outcomes[2].status === 'rejected')
      expect(outcomes[2].reason).toBeInstanceOf(IngestionConflictError);
    if (outcomes[0].status === 'fulfilled' && outcomes[1].status === 'fulfilled')
      expect(outcomes[0].value.receiptId).toBe(outcomes[1].value.receiptId);
    expect(await prisma.ingestionReceipt.count()).toBe(31);
    expect((await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending).toBe(
      31
    );
    expect(await acceptPostgresEvent(envelope('existing'), 'existing-delivery')).toEqual(existing);
    expect(await consumeIngestionBatch(32)).toBe(31);
    expect(await prisma.alert.count({ where: { serviceId } })).toBe(31);
  });

  it('returns no group acknowledgements and rolls back all reservations when receipt insertion fails', async () => {
    await prisma.$executeRaw`ALTER TABLE "IngestionReceipt" ADD CONSTRAINT ingestion_group_test_failure
      CHECK ("payloadBytes" < 0) NOT VALID`;
    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          acceptPostgresEvent(envelope(`failed-group-${index}`), `failed-group-${index}`)
        )
      );
      expect(outcomes.every(outcome => outcome.status === 'rejected')).toBe(true);
      expect(await prisma.ingestionReceipt.count()).toBe(0);
      expect(
        (await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending
      ).toBe(0);
      expect((await prisma.ingestionBudget.aggregate({ _sum: { bytes: true } }))._sum.bytes).toBe(
        BigInt(0)
      );
    } finally {
      await prisma.$executeRaw`ALTER TABLE "IngestionReceipt" DROP CONSTRAINT ingestion_group_test_failure`;
    }
    const accepted = await acceptPostgresEvent(envelope('recovered-group'), 'failed-group-0');
    expect(accepted.receiptId).toBeTruthy();
    expect(await prisma.ingestionReceipt.count()).toBe(1);
  });

  it('partially admits independent group callers within exact remaining capacity', async () => {
    process.env.OPSKNIGHT_INGESTION_MAX_PENDING = '64';
    process.env.OPSKNIGHT_INGESTION_CRITICAL_RESERVE_PERCENT = '0';
    try {
      await Promise.all(
        Array.from({ length: 60 }, (_, index) =>
          acceptPostgresEvent(envelope(`capacity-prefix-${index}`))
        )
      );
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) =>
          acceptPostgresEvent(envelope(`capacity-tail-${index}`))
        )
      );
      expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(4);
      for (const outcome of outcomes)
        if (outcome.status === 'rejected')
          expect(outcome.reason).toBeInstanceOf(IngestionUnavailableError);
      expect(await prisma.ingestionReceipt.count()).toBe(64);
      expect(
        (await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending
      ).toBe(64);
    } finally {
      delete process.env.OPSKNIGHT_INGESTION_MAX_PENDING;
      delete process.env.OPSKNIGHT_INGESTION_CRITICAL_RESERVE_PERCENT;
    }
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
    await expect(
      runReadCommittedTransaction(tx =>
        completeProcessingReceipt(
          tx,
          { id: first.id, token: first.leaseToken },
          { action: 'created' }
        )
      )
    ).rejects.toBeInstanceOf(IngestionLeaseLostError);
    expect((await prisma.ingestionBudget.aggregate({ _sum: { pending: true } }))._sum.pending).toBe(
      1
    );
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
          conditions: [{ fieldKey: 'source', operator: 'EQ' as const, value: 'database' }],
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
