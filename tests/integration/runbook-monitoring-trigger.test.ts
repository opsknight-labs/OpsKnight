import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { executeIncidentCreation } from '@/lib/incidents/creation';

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
});
