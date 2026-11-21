import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
import { disconnectNoiseLookupClient } from '@/lib/intelligence/noise-controls/lookup-client';
import { describeNoiseDecisions } from '@/lib/automation/presentation/pipeline-trace';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/**
 * One pipeline, one trace (J1.5) through live ingestion: the same orchestration rule and automation
 * version under pipeline order OFF, SHADOW and ON.
 */

type Order = 'OFF' | 'SHADOW' | 'ON';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
  setPrePagingDeadlineMs(50);
  await resetDatabase();
});
afterAll(async () => {
  setPrePagingDeadlineMs(null);
  await disconnectNoiseLookupClient();
});

async function setup(order: Order) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const ownPolicy = await db.escalationPolicy.create({ data: { name: 'Checkout on-call' } });
  const dbaPolicy = await db.escalationPolicy.create({ data: { name: 'DBA on-call' } });
  const service = await db.service.create({
    data: { name: `Checkout ${crypto.randomUUID()}`, escalationPolicyId: ownPolicy.id },
  });
  const target = await db.service.create({
    data: { name: `Database ${crypto.randomUUID()}`, escalationPolicyId: dbaPolicy.id },
  });

  // Automation (LIVE): info severity is P5. No route rule, so the service default routes.
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: admin.id,
    snapshot: {
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'info-p5',
          name: 'Info is P5',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'info' }],
          actions: [{ type: 'SET_PRIORITY', value: 'P5' }],
        },
      ],
    },
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: admin.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await changeMode({
    serviceId: service.id,
    actorId: admin.id,
    mode: 'LIVE',
    acknowledgeNoShadow: true,
    expectedActiveVersionId: version.id,
  });

  // Noise controls (ON) with orchestration: pgwatch alerts are info, go to the DBA service and get a
  // runbook; debug alerts are dropped.
  const definition = {
    schemaVersion: 1,
    orchestration: {
      rules: [
        {
          id: 'drop-debug',
          name: 'Drop debug',
          conditions: [{ field: 'summary', op: 'prefix', value: 'debug' }],
          actions: [{ type: 'DROP' }],
        },
        {
          id: 'pgwatch',
          name: 'Database alerts',
          conditions: [{ field: 'source', op: 'equals', value: 'pgwatch' }],
          actions: [
            { type: 'SET_SEVERITY', value: 'info' },
            { type: 'REROUTE_SERVICE', serviceId: target.id },
            { type: 'ATTACH_RUNBOOK', runbookId: 'rb-1' },
          ],
        },
      ],
    },
  } as Prisma.InputJsonObject;
  await db.noiseControlPolicy.create({
    data: {
      scopeKey: `service:${service.id}`,
      serviceId: service.id,
      mode: 'ON',
      pipelineOrder: order === 'OFF' ? null : order,
      definition,
    },
  });
  await primePrePagingSnapshot();
  return { service, target, ownPolicy, dbaPolicy };
}

async function ingest(serviceId: string, payload: Partial<EventPayload['payload']>) {
  const event: EventPayload = {
    event_action: 'trigger',
    dedup_key: crypto.randomUUID(),
    payload: { summary: 'Replication lag', source: 'pgwatch', severity: 'error', ...payload },
  };
  return processIntegrationEvent({
    serviceId,
    integrationId: 'pipeline-it',
    integrationType: 'EVENTS_API',
    event: structuredClone(event),
    providerPayload: event,
    receivedAt: new Date(),
  });
}

async function created(serviceId: string) {
  const result = await ingest(serviceId, {});
  const incident = result.incident!;
  const [automation, noise, runbookJob] = await Promise.all([
    db.incidentAutomationDecision.findUniqueOrThrow({ where: { incidentId: incident.id } }),
    db.prePagingDecision.findFirstOrThrow({ where: { incidentId: incident.id } }),
    db.backgroundJob.findFirstOrThrow({
      where: {
        type: 'RUNBOOK',
        payload: { path: ['incidentId'], equals: incident.id },
      },
    }),
  ]);
  const stored = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
  return {
    incident: stored,
    automation,
    noise,
    pipeline: (noise.evidence as Record<string, unknown>).pipeline as
      Record<string, unknown> | undefined,
    runbookPayload: runbookJob.payload as Record<string, unknown>,
  };
}

describe('pipeline order', () => {
  it('OFF keeps automation first: automation sees the raw severity, nothing extra is recorded', async () => {
    const { service, ownPolicy } = await setup('OFF');
    const { incident, automation, noise, pipeline, runbookPayload } = await created(service.id);
    expect(incident.priority).not.toBe('P5');
    expect(automation).toMatchObject({
      routeType: 'SERVICE_DEFAULT',
      escalationPolicyId: ownPolicy.id,
    });
    expect(noise).toMatchObject({ action: 'TRANSFORM', applied: true });
    expect(pipeline).toBeUndefined();
    expect(runbookPayload.attachRunbookIds).toBeUndefined();
  });

  it('SHADOW changes nothing and records what noise-first would have decided', async () => {
    const { service, target, ownPolicy } = await setup('SHADOW');
    const { incident, automation, noise, pipeline, runbookPayload } = await created(service.id);
    expect(incident.priority).not.toBe('P5');
    expect(automation).toMatchObject({
      routeType: 'SERVICE_DEFAULT',
      escalationPolicyId: ownPolicy.id,
    });
    expect(runbookPayload.attachRunbookIds).toBeUndefined();
    expect(pipeline).toMatchObject({
      order: 'SHADOW',
      automation: {
        actual: { route: 'SERVICE_DEFAULT', policyId: ownPolicy.id },
        noiseFirst: { priority: 'P5', route: 'SERVICE_DEFAULT' },
        different: true,
      },
      reroute: { serviceId: target.id, wouldApply: true },
      attachRunbookIds: ['rb-1'],
    });
    const trace = describeNoiseDecisions([noise]).map(step => step.text);
    expect(trace[0]).toMatch(/^Noise controls: /);
    expect(trace.join(' ')).toMatch(/would have chosen the service default, priority P5/);

    const dropped = await ingest(service.id, { summary: 'debug heartbeat' });
    expect(dropped).toMatchObject({ action: 'dropped' });
    const drop = await db.prePagingDecision.findFirstOrThrow({ where: { action: 'DROP' } });
    expect((drop.evidence as Record<string, unknown>).pipeline).toEqual({
      order: 'SHADOW',
      automation: 'SKIPPED',
    });
  });

  it('ON runs automation on the transformed alert, reroutes through the automation route and attaches runbooks', async () => {
    const { service, target, dbaPolicy } = await setup('ON');
    const { incident, automation, pipeline, runbookPayload } = await created(service.id);
    expect(incident.priority).toBe('P5');
    expect(automation).toMatchObject({
      mode: 'LIVE',
      routeType: 'ESCALATION_POLICY',
      escalationPolicyId: dbaPolicy.id,
    });
    expect(automation.summary).toMatchObject({
      responderPolicy: { id: dbaPolicy.id },
      orchestration: { reroute: { serviceId: target.id, policyId: dbaPolicy.id } },
    });
    expect(runbookPayload.attachRunbookIds).toEqual(['rb-1']);
    expect(pipeline).toMatchObject({
      order: 'ON',
      automation: { priority: 'P5', route: 'ESCALATION_POLICY', policyId: dbaPolicy.id },
      reroute: { serviceId: target.id, applied: true, reason: 'APPLIED' },
      attachRunbookIds: ['rb-1'],
    });

    // A dropped alert gets no automation work at all.
    const before = await db.incidentAutomationDecision.count();
    const dropped = await ingest(service.id, { summary: 'debug heartbeat' });
    expect(dropped).toMatchObject({ action: 'dropped' });
    expect(await db.incidentAutomationDecision.count()).toBe(before);
    const drop = await db.prePagingDecision.findFirstOrThrow({ where: { action: 'DROP' } });
    expect((drop.evidence as Record<string, unknown>).pipeline).toEqual({
      order: 'ON',
      automation: 'SKIPPED',
    });
  });
});
