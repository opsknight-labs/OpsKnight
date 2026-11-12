import { beforeEach, expect, it } from 'vitest';
import {
  createTestEscalationPolicy,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { compileAutomation } from '@/lib/automation/compiler';
import type { Snapshot } from '@/lib/automation/contract';
import { processAutomationJob } from '@/lib/automation/jobs';
import { replayStoredEvents, type ReplayEnvironment } from '@/lib/automation/replay';
import {
  getAutomationReplay,
  loadReplayEnvironment,
  startAutomationReplay,
} from '@/lib/automation/replay-run';

const DAY = 86_400_000;
const now = new Date('2026-11-10T12:00:00.000Z');

const draft = (policyId: string): Snapshot => ({
  schemaVersion: 1,
  fields: [],
  rules: [
    {
      id: 'page-critical',
      name: 'Page critical',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
      actions: [{ type: 'USE_ESCALATION_POLICY', policyId }],
    },
    {
      id: 'also-critical',
      name: 'Also critical',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
      actions: [{ type: 'NO_ESCALATION' }],
    },
    {
      id: 'never',
      name: 'Never',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'nobody-sends-this' }],
      actions: [{ type: 'NO_ESCALATION' }],
    },
  ],
});

async function seed() {
  const actor = await createTestUser({ role: 'ADMIN' });
  const policy = await createTestEscalationPolicy('Urgent', []);
  const service = await createTestService('Replay');
  const other = await createTestService('Other');
  // Six incident-opening alerts in the window (3 critical, 3 warning), one follow-up alert on the
  // first incident, one incident older than the window and one on another service.
  const opened = async (serviceId: string, daysAgo: number, severity: string, index: number) => {
    const createdAt = new Date(now.getTime() - daysAgo * DAY + index * 1000);
    const incident = await db.incident.create({
      data: { title: `i-${index}`, serviceId, status: 'OPEN', urgency: 'HIGH', createdAt },
    });
    await db.alert.create({
      data: {
        serviceId,
        incidentId: incident.id,
        dedupKey: `k-${index}`,
        createdAt,
        payload: { summary: 'x', source: 'prom', severity },
      },
    });
    return incident;
  };
  const incidents = [];
  for (let index = 0; index < 6; index++)
    incidents.push(await opened(service.id, 3, index % 2 ? 'warning' : 'critical', index));
  await db.alert.create({
    data: {
      serviceId: service.id,
      incidentId: incidents[0].id,
      dedupKey: 'k-0',
      createdAt: new Date(now.getTime() - 2 * DAY),
      payload: { summary: 'again', source: 'prom', severity: 'critical' },
    },
  });
  await opened(service.id, 12, 'critical', 90);
  await opened(other.id, 3, 'critical', 91);
  return { actor, policy, service, other };
}

beforeEach(resetDatabase);

it('pages through stored incident-opening alerts with a keyset and reports what would change', async () => {
  const { policy, service } = await seed();
  const { compiled } = compileAutomation(draft(policy.id));
  const environment: ReplayEnvironment = await db.$transaction(tx =>
    loadReplayEnvironment(tx, service.id, null)
  );
  const replay = (batchSize: number, maxEvents?: number, progress: number[] = []) =>
    replayStoredEvents({
      compiled,
      serviceId: service.id,
      environment,
      windowStart: new Date(now.getTime() - 7 * DAY),
      windowEnd: now,
      run: work => db.$transaction(work),
      onProgress: async p => void progress.push(p.fraction),
      batchSize,
      maxEvents,
    });
  const progress: number[] = [];
  const paged = await replay(2, undefined, progress);
  expect(paged).toMatchObject({
    alertsScanned: 6,
    eventsEvaluated: 6,
    truncated: false,
    routeChanged: 3,
    same: 3,
    defaultRouted: 3,
    fallbacks: 0,
  });
  expect(paged.transitions).toEqual([
    {
      from: { type: 'SERVICE_DEFAULT', policyId: null },
      to: { type: 'ESCALATION_POLICY', policyId: policy.id },
      count: 3,
    },
  ]);
  expect(paged.rules).toEqual([
    expect.objectContaining({ ruleId: 'page-critical', matched: 3, shadowed: 0 }),
    expect.objectContaining({ ruleId: 'also-critical', matched: 0, shadowed: 3 }),
    expect.objectContaining({ ruleId: 'never', matched: 0, shadowed: 0 }),
  ]);
  expect(progress.length).toBeGreaterThan(0);
  expect(progress.every(fraction => fraction > 0 && fraction <= 1)).toBe(true);

  // Page size never changes the answer; timings are the only thing that may differ.
  const whole = await replay(500);
  expect({ ...whole, evaluationMs: null }).toEqual({ ...paged, evaluationMs: null });

  expect(await replay(2, 4)).toMatchObject({ alertsScanned: 4, truncated: true });
});

it('runs as a background job, reuses an identical request and stays inside its service', async () => {
  const { actor, policy, service, other } = await seed();
  const request = { serviceId: service.id, snapshot: draft(policy.id), days: 7, actorId: actor.id };
  const started = await db.$transaction(tx => startAutomationReplay(tx, { ...request, now }));
  expect(started).toMatchObject({ status: 'PENDING', progress: 0, result: null });
  const again = await db.$transaction(tx => startAutomationReplay(tx, { ...request, now }));
  expect(again.runId).toBe(started.runId);

  const jobs = await db.backgroundJob.findMany({
    where: { type: 'SCHEDULED_TASK', payload: { path: ['task'], equals: 'AUTOMATION_REPLAY' } },
  });
  expect(jobs).toHaveLength(1);
  await processAutomationJob(jobs[0].payload, jobs[0].id);

  const finished = await getAutomationReplay(db, service.id, started.runId);
  expect(finished).toMatchObject({
    status: 'COMPLETED',
    progress: 1,
    result: { eventsEvaluated: 6, routeChanged: 3, truncated: false },
  });
  // The stored run keeps counts, not the rule definitions that were replayed.
  const row = await db.intelligenceEvaluationRun.findUniqueOrThrow({
    where: { id: started.runId },
  });
  expect(row.metrics).not.toHaveProperty('snapshot');
  expect(await getAutomationReplay(db, other.id, started.runId)).toBeNull();

  // A second delivery of the same job does nothing.
  await processAutomationJob(jobs[0].payload, jobs[0].id);
  expect(await getAutomationReplay(db, service.id, started.runId)).toEqual(finished);
});

it('refuses a draft that does not validate and never queues a job for it', async () => {
  const { actor, service } = await seed();
  await expect(
    db.$transaction(tx =>
      startAutomationReplay(tx, {
        serviceId: service.id,
        snapshot: draft('missing-policy'),
        days: 7,
        actorId: actor.id,
        now,
      })
    )
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(await db.backgroundJob.count()).toBe(0);
});
