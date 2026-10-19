import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  testPrisma as db,
  resetDatabase,
  createTestUser,
  createTestService,
} from '../helpers/test-db';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { executeIncidentCreation } from '@/lib/incidents/creation';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { createServiceBinding } from '@/lib/runbooks/bindings';
import { processRunbookJob } from '@/lib/runbooks/orchestrator';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const INTEGRATION_ID = 'monitoring-trigger';

function alert(dedupKey: string, action: EventPayload['event_action'] = 'trigger'): EventPayload {
  return {
    event_action: action,
    dedup_key: dedupKey,
    payload: { summary: 'CPU saturation', source: 'prometheus', severity: 'critical' },
  };
}

function ingest(serviceId: string, event: EventPayload) {
  return processIntegrationEvent({
    serviceId,
    integrationId: INTEGRATION_ID,
    integrationType: 'EVENTS_API',
    event: structuredClone(event),
    providerPayload: event,
    receivedAt: new Date(),
  });
}

async function evaluationJobs(incidentId: string) {
  const jobs = await db.backgroundJob.findMany({
    where: {
      type: 'RUNBOOK',
      AND: [
        { payload: { path: ['kind'], equals: 'EVALUATE_TRIGGER' } },
        { payload: { path: ['incidentId'], equals: incidentId } },
      ],
    },
  });
  return jobs.map(job => ({
    ...job,
    payload: job.payload as {
      kind: string;
      incidentId: string;
      sourceEventId: string;
      source: string;
    },
  }));
}

async function newService() {
  return db.service.create({ data: { name: `Monitoring ${crypto.randomUUID()}` } });
}

/** SUGGESTED binding that matches every incident but has NOT opted into monitoring incidents. */
async function suggestedBindingWithoutMonitoringOptIn() {
  const definition = parseRunbookDefinition(
    {
      steps: [
        {
          key: 'check',
          name: 'Check api',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    } as unknown as Prisma.InputJsonValue,
    []
  );
  const runbook = await db.runbook.create({
    data: { name: `Provenance ${crypto.randomUUID()}`, slug: `prov-${crypto.randomUUID()}` },
  });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      publishedAt: new Date(),
      definition: definition as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(definition),
    },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { publishedVersionId: version.id } });
  const [service, admin, agent] = await Promise.all([
    createTestService('Provenance'),
    createTestUser({ role: 'ADMIN' }),
    db.runbookAgent.create({
      data: {
        name: `agent-${crypto.randomUUID()}`,
        status: 'ONLINE',
        capabilities: ['RUNBOOK_SYSTEMD'],
        lastHeartbeatAt: new Date(),
      },
    }),
  ]);
  const pool = await db.runbookAgentPool.create({
    data: { name: `pool-${crypto.randomUUID()}`, members: { create: { agentId: agent.id } } },
  });
  const binding = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      enabled: true,
      mode: 'SUGGESTED',
      versionStrategy: 'PINNED',
      defaultAgentPoolId: pool.id,
      inputValues: {},
    },
    admin.id
  );
  expect(binding.runOnMonitoringIncidents).toBe(false);
  await db.runbookTrigger.create({ data: { bindingId: binding.id, event: 'INCIDENT_CREATED' } });
  return { service, binding };
}

function evaluate(incidentId: string, source: unknown, omitSource = false) {
  return processRunbookJob({
    kind: 'EVALUATE_TRIGGER',
    incidentId,
    sourceEventId: crypto.randomUUID(),
    ...(omitSource ? {} : { source }),
  });
}

describeIfRealDB('runbook evaluation for monitoring incidents (real PostgreSQL)', () => {
  beforeAll(async () => {
    await resetDatabase();
  }, 600_000);
  afterAll(async () => db.$disconnect(), 60_000);

  it('queues exactly one MONITORING evaluation with the incident, and none on retrigger', async () => {
    const service = await newService();
    const key = crypto.randomUUID();
    const first = await ingest(service.id, alert(key));
    expect(first.action).toBe('triggered');
    const incidentId = first.incident!.id;
    const jobs = await evaluationJobs(incidentId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'PENDING', maxAttempts: 8 });
    expect(jobs[0].payload).toEqual({
      kind: 'EVALUATE_TRIGGER',
      incidentId,
      sourceEventId: expect.any(String),
      source: 'MONITORING',
    });

    await ingest(service.id, alert(key));
    await ingest(service.id, alert(key, 'acknowledge'));
    expect(await evaluationJobs(incidentId)).toHaveLength(1);
  });

  it('queues one evaluation for 50 concurrent duplicate alerts', async () => {
    const service = await newService();
    const key = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => ingest(service.id, alert(key)))
    );
    const incidentIds = new Set(results.map(result => result.incident!.id));
    expect(incidentIds.size).toBe(1);
    const [incidentId] = [...incidentIds];
    expect(await evaluationJobs(incidentId)).toHaveLength(1);
  }, 120_000);

  it('queues nothing for an incident created RESOLVED by an out-of-order resolve', async () => {
    const service = await newService();
    const key = crypto.randomUUID();
    expect((await ingest(service.id, alert(key, 'resolve'))).action).toBe('ignored');
    const result = await ingest(service.id, alert(key));
    expect(result.action).toBe('resolved');
    expect(result.incident!.status).toBe('RESOLVED');
    expect(await evaluationJobs(result.incident!.id)).toHaveLength(0);
  });

  it('queues nothing for a flapping incident created SUPPRESSED', async () => {
    const service = await newService();
    const key = crypto.randomUUID();
    const scoped = `${INTEGRATION_ID}:${key}`;
    const now = Date.now();
    // Linked to an earlier incident so the buffered out-of-order resolve path does not apply.
    const earlier = await db.incident.create({
      data: { title: 'Earlier', serviceId: service.id, status: 'RESOLVED', resolvedAt: new Date() },
    });
    for (let i = 0; i < 6; i++)
      await db.alert.create({
        data: {
          dedupKey: scoped,
          serviceId: service.id,
          incidentId: earlier.id,
          status: i % 2 === 0 ? 'TRIGGERED' : 'RESOLVED',
          payload: {},
          createdAt: new Date(now - (6 - i) * 1000),
        },
      });
    const result = await ingest(service.id, alert(key));
    expect(result.action).toBe('suppressed');
    expect(result.incident!.status).toBe('SUPPRESSED');
    expect(await evaluationJobs(result.incident!.id)).toHaveLength(0);
  });

  it('keeps queuing one MANUAL evaluation for manual/REST creation', async () => {
    const service = await newService();
    const actor = await createTestUser();
    const input = {
      title: 'Manual report',
      description: null,
      serviceId: service.id,
      urgency: 'HIGH' as const,
      dedupKey: `manual-${crypto.randomUUID()}`,
      source: 'REST_API' as const,
      actor: { id: actor.id, name: actor.name ?? undefined },
    };
    const created = await executeIncidentCreation({ ...input, now: new Date() });
    expect(created.outcome).toBe('CREATED');
    const jobs = await evaluationJobs(created.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.source).toBe('MANUAL');

    const merged = await executeIncidentCreation({ ...input, now: new Date() });
    expect(merged).toMatchObject({ id: created.id, outcome: 'MERGED' });
    expect(await evaluationJobs(created.id)).toHaveLength(1);
  });

  describe('evaluation source provenance cannot bypass the monitoring opt-in', () => {
    const legacyOrForged = ['manual', 'MANUAL ', 'Manual', 'OTHER', 'EVENT', '', 'MANUAL'];

    it.each(legacyOrForged)('ignores source %j for an alert-linked incident', async source => {
      const { service, binding } = await suggestedBindingWithoutMonitoringOptIn();
      const incidentId = (await ingest(service.id, alert(crypto.randomUUID()))).incident!.id;
      await evaluate(incidentId, source);
      expect(await db.runbookSuggestion.count({ where: { bindingId: binding.id } })).toBe(0);
    });

    it('ignores a missing source for an alert-linked incident', async () => {
      const { service, binding } = await suggestedBindingWithoutMonitoringOptIn();
      const incidentId = (await ingest(service.id, alert(crypto.randomUUID()))).incident!.id;
      await evaluate(incidentId, undefined, true);
      expect(await db.runbookSuggestion.count({ where: { bindingId: binding.id } })).toBe(0);
    });

    it('rejects a non-string source in the job payload without side effects', async () => {
      const { service, binding } = await suggestedBindingWithoutMonitoringOptIn();
      const incidentId = (await ingest(service.id, alert(crypto.randomUUID()))).incident!.id;
      for (const source of [0, 1, null, { value: 'MANUAL' }])
        await expect(evaluate(incidentId, source)).rejects.toThrow();
      expect(await db.runbookSuggestion.count({ where: { bindingId: binding.id } })).toBe(0);
    });

    it('fails closed for unexpected sources on an incident without alerts', async () => {
      const { service, binding } = await suggestedBindingWithoutMonitoringOptIn();
      for (const source of ['manual', 'MANUAL ', 'OTHER', '']) {
        const incident = await db.incident.create({
          data: { title: 'Manual', serviceId: service.id, urgency: 'HIGH', status: 'OPEN' },
        });
        await evaluate(incident.id, source);
      }
      expect(await db.runbookSuggestion.count({ where: { bindingId: binding.id } })).toBe(0);
    });

    it('still treats exact MANUAL on an incident without alerts as manual', async () => {
      const { service, binding } = await suggestedBindingWithoutMonitoringOptIn();
      const incident = await db.incident.create({
        data: { title: 'Manual', serviceId: service.id, urgency: 'HIGH', status: 'OPEN' },
      });
      await evaluate(incident.id, 'MANUAL');
      expect(
        await db.runbookSuggestion.count({
          where: { bindingId: binding.id, incidentId: incident.id },
        })
      ).toBe(1);
    });
  });
});
