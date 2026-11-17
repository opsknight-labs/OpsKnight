import { beforeEach, expect, it } from 'vitest';
import {
  createTestEscalationPolicy,
  createTestService,
  createTestTeam,
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
  replayIncidentScope,
  startAutomationReplay,
} from '@/lib/automation/replay-run';
import {
  GET as replayStatusRoute,
  POST as replayRoute,
} from '@/app/api/v2/services/[id]/automation/replay/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';

const DAY = 86_400_000;
const asActor = (
  user: { id: string },
  role: 'ADMIN' | 'USER' = 'ADMIN',
  teamIds: string[] = []
) => ({
  id: user.id,
  role,
  status: 'ACTIVE' as const,
  teamIds,
});
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
  return { actor, policy, service, other, incidents };
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
  const request = {
    serviceId: service.id,
    snapshot: draft(policy.id),
    days: 7,
    actorId: actor.id,
    incidentScope: null,
  };
  const admin = asActor(actor);
  const started = await db.$transaction(tx => startAutomationReplay(tx, { ...request, now }));
  expect(started).toMatchObject({ status: 'PENDING', progress: 0, result: null });
  const again = await db.$transaction(tx => startAutomationReplay(tx, { ...request, now }));
  expect(again.runId).toBe(started.runId);

  const jobs = await db.backgroundJob.findMany({
    where: { type: 'SCHEDULED_TASK', payload: { path: ['task'], equals: 'AUTOMATION_REPLAY' } },
  });
  expect(jobs).toHaveLength(1);
  await processAutomationJob(jobs[0].payload, jobs[0].id);

  const finished = await getAutomationReplay(db, service.id, started.runId, admin);
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
  expect(await getAutomationReplay(db, other.id, started.runId, admin)).toBeNull();

  // A second delivery of the same job does nothing.
  await processAutomationJob(jobs[0].payload, jobs[0].id);
  expect(await getAutomationReplay(db, service.id, started.runId, admin)).toEqual(finished);
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
        incidentScope: null,
        now,
      })
    )
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(await db.backgroundJob.count()).toBe(0);
});

it('is reachable over REST v2: 202 on start, status by run id, and not across services or scopes', async () => {
  const { policy, service, other } = await seed();
  const reader = await createV2Credential(['automation:read', 'incidents:read']);
  const outsider = await createV2Credential(['incidents:read']);
  const noIncidents = await createV2Credential(['automation:read']);
  const path = `/services/${service.id}/automation/replay`;
  const body = { snapshot: draft(policy.id), days: 7 };

  const started = await invokeV2(replayRoute, reader.token, 'POST', path, { id: service.id }, body);
  expect(started.status).toBe(202);
  const { data } = await started.json();
  expect(data).toMatchObject({ status: 'PENDING', days: 7, progress: 0, result: null });

  const status = await invokeV2(
    replayStatusRoute,
    reader.token,
    'GET',
    `${path}?runId=${data.runId}`,
    { id: service.id }
  );
  expect(status.status).toBe(200);
  expect((await status.json()).data.runId).toBe(data.runId);

  const elsewhere = await invokeV2(
    replayStatusRoute,
    reader.token,
    'GET',
    `/services/${other.id}/automation/replay?runId=${data.runId}`,
    { id: other.id }
  );
  expect(elsewhere.status).toBe(404);

  const denied = await invokeV2(
    replayRoute,
    outsider.token,
    'POST',
    path,
    { id: service.id },
    body
  );
  expect(denied.status).toBe(403);
  // Replay results identify incidents, so automation read alone is not enough.
  for (const response of [
    await invokeV2(replayRoute, noIncidents.token, 'POST', path, { id: service.id }, body),
    await invokeV2(replayStatusRoute, noIncidents.token, 'GET', `${path}?runId=${data.runId}`, {
      id: service.id,
    }),
  ])
    expect(response.status).toBe(403);
  expect(await db.backgroundJob.count()).toBe(1);
});

it('reports what people changed afterwards on each replayed incident', async () => {
  const { policy, service, incidents } = await seed();
  const minutes = (incident: { createdAt: Date }, count: number) =>
    new Date(incident.createdAt.getTime() + count * 60_000);
  await db.incident.update({ where: { id: incidents[0].id }, data: { priority: 'P1' } });
  await db.incidentEvent.createMany({
    data: [
      // A priority change inside the override window.
      {
        incidentId: incidents[0].id,
        type: 'STATUS_CHANGE',
        message: 'Priority updated to P1',
        createdAt: minutes(incidents[0], 5),
      },
      // A team change an hour later: not "soon", and not a priority change.
      {
        incidentId: incidents[1].id,
        type: 'ASSIGNMENT',
        message: 'Incident assigned to team: Core',
        createdAt: minutes(incidents[1], 60),
      },
      // A team change inside the window: an override, still not a priority change.
      {
        incidentId: incidents[2].id,
        type: 'ASSIGNMENT',
        message: 'Incident assigned to team: Core',
        createdAt: minutes(incidents[2], 3),
      },
      {
        incidentId: incidents[3].id,
        type: 'COMMENT',
        message: 'Priority looks right',
        createdAt: minutes(incidents[3], 1),
      },
    ],
  });
  const { compiled } = compileAutomation(draft(policy.id));
  const environment = await db.$transaction(tx => loadReplayEnvironment(tx, service.id, null));
  const later = new Map<string, unknown>();
  await replayStoredEvents({
    compiled,
    serviceId: service.id,
    environment,
    windowStart: new Date(now.getTime() - 7 * DAY),
    windowEnd: now,
    run: work => db.$transaction(work),
    onEvent: event => void later.set(event.incidentId, event.later),
  });
  expect(later.get(incidents[0].id)).toEqual({
    priority: 'P1',
    priorityChanged: true,
    overriddenSoon: true,
  });
  expect(later.get(incidents[1].id)).toEqual({
    priority: null,
    priorityChanged: false,
    overriddenSoon: false,
  });
  expect(later.get(incidents[2].id)).toEqual({
    priority: null,
    priorityChanged: false,
    overriddenSoon: true,
  });
  // A comment is not a change, even when its text starts like one.
  expect(later.get(incidents[3].id)).toMatchObject({ overriddenSoon: false });
  expect(later.size).toBe(6);
});

it('replays only the incidents the requester can read and re-checks examples when read', async () => {
  const { policy } = await seed();
  const team = await createTestTeam('Replay team');
  const user = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: user.id, teamId: team.id } });
  const service = await createTestService('Scoped', team.id);
  const opened = async (index: number, visibility: 'PUBLIC' | 'PRIVATE') => {
    const createdAt = new Date(now.getTime() - 3 * DAY + index * 1000);
    const incident = await db.incident.create({
      data: {
        title: `s-${index}`,
        serviceId: service.id,
        status: 'OPEN',
        urgency: 'HIGH',
        visibility,
        createdAt,
      },
    });
    await db.alert.create({
      data: {
        serviceId: service.id,
        incidentId: incident.id,
        dedupKey: `s-${index}`,
        createdAt,
        payload: { summary: 'x', source: 'prom', severity: 'critical' },
      },
    });
    return incident;
  };
  const visible = await opened(1, 'PUBLIC');
  const hidden = await opened(2, 'PRIVATE');
  const watched = await opened(3, 'PRIVATE');
  await db.incidentWatcher.create({ data: { incidentId: watched.id, userId: user.id } });

  const reader = asActor(user, 'USER', [team.id]);
  const incidentScope = replayIncidentScope(reader);
  expect(incidentScope).toEqual({ actorId: user.id, teamIds: [team.id] });
  const started = await db.$transaction(tx =>
    startAutomationReplay(tx, {
      serviceId: service.id,
      snapshot: draft(policy.id),
      days: 7,
      actorId: user.id,
      incidentScope,
      now,
    })
  );
  const [job] = await db.backgroundJob.findMany({ where: { type: 'SCHEDULED_TASK' } });
  await processAutomationJob(job.payload, job.id);
  const finished = await getAutomationReplay(db, service.id, started.runId, reader);
  expect(finished?.result).toMatchObject({ eventsEvaluated: 2 });
  expect(finished?.result?.examples.map(example => example.incidentId).sort()).toEqual(
    [visible.id, watched.id].sort()
  );
  expect(finished?.result?.examples.map(example => example.incidentId)).not.toContain(hidden.id);

  // Losing access afterwards hides the example; another user cannot read the run at all.
  await db.incidentWatcher.deleteMany({ where: { incidentId: watched.id } });
  const later = await getAutomationReplay(db, service.id, started.runId, reader);
  expect(later?.result?.examples.map(example => example.incidentId)).toEqual([visible.id]);
  const someoneElse = await createTestUser({ role: 'ADMIN' });
  expect(await getAutomationReplay(db, service.id, started.runId, asActor(someoneElse))).toBeNull();
});
