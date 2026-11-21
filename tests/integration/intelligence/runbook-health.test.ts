import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { generateOpsRollups } from '@/lib/metric-rollup';
import { resetOpsInsightsSchedule, runOpsInsights } from '@/lib/intelligence/ops-insights/handlers';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { listInsightsForScope } from '@/lib/intelligence/ops-insights/view';
import {
  getMissingRunbookSuggestions,
  getRunbookHealthView,
  resolveNoteRefs,
} from '@/lib/intelligence/runbook-health/view';
import {
  readRunbookWeightProposal,
  resetRunbookWeightFitSchedule,
  runRunbookWeightFit,
  scheduleRunbookWeightFit,
} from '@/lib/intelligence/learning/runbook-weights';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

// Each case builds about 40 rows and a month of rollups; slow on a shared machine.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  resetOpsInsightsSchedule();
  resetRunbookWeightFitSchedule();
});

const MIN = 60_000;
const DAY = 1440 * MIN;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);

async function setSwitches(overrides: { runbooks?: boolean; fixWindow?: number } = {}) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const current = await getIntelligenceSettings();
  return updateOpsInsightSwitches(
    {
      opsInsightsEnabled: true,
      opsInsightsAutomationEnabled: false,
      opsInsightsEscalationEnabled: false,
      opsInsightsOnCallEnabled: false,
      opsInsightsPostmortemsEnabled: false,
      opsInsightsRunbooksEnabled: overrides.runbooks ?? true,
      opsInsightsNotificationsEnabled: false,
      ...(overrides.fixWindow ? { runbookFixWindowMinutes: overrides.fixWindow } : {}),
      expectedRevision: current.revision,
    },
    { actorId: admin.id, source: 'UI' }
  );
}

// USER reads only its teams' services and incidents; RESPONDER also reads runbooks, and every incident.
async function actorFor(teamId: string, role: 'USER' | 'RESPONDER' = 'USER') {
  const user = await createTestUser({ role });
  await db.teamMember.create({ data: { userId: user.id, teamId, role: 'MEMBER' } });
  const actor = await resolveUserActor(user.id);
  if (!actor) throw new Error('actor');
  return actor;
}

async function publishedRunbook(name: string, publishedAt: Date, serviceIds: string[]) {
  const runbook = await db.runbook.create({
    data: { name, slug: `${name}-${Math.random().toString(36).slice(2, 8)}` },
  });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      definition: {},
      checksum: 'x',
      publishedAt,
    },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { publishedVersionId: version.id } });
  for (const serviceId of serviceIds)
    await db.serviceAutomationRule.create({ data: { serviceId, runbookId: runbook.id } });
  return { runbook, version };
}

type StepFixture = {
  key: string;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode?: string;
  /** A failed first attempt with this code, then a second attempt. */
  retriedAfter?: string;
};

async function run(
  rb: { runbook: { id: string }; version: { id: string } },
  serviceId: string,
  incidentId: string | null,
  completedAt: Date,
  steps: StepFixture[]
) {
  const failed = steps.some(step => step.status === 'FAILED');
  const startedAt = new Date(completedAt.getTime() - MIN);
  const execution = await db.runbookExecution.create({
    data: {
      runbookId: rb.runbook.id,
      runbookVersionId: rb.version.id,
      serviceId,
      incidentId,
      status: failed ? 'FAILED' : 'SUCCEEDED',
      startedAt,
      completedAt,
      createdAt: startedAt,
      deadlineAt: new Date(NOW + DAY),
      definitionChecksum: 'x',
    },
  });
  for (const [index, step] of steps.entries()) {
    const row = await db.runbookExecutionStep.create({
      data: {
        executionId: execution.id,
        stepKey: step.key,
        sequence: index + 1,
        name: step.key === 'restart' ? 'Restart the api pods' : 'Wait for the queue to drain',
        type: 'MANUAL',
        status: step.status,
        errorCode: step.errorCode ?? null,
        attemptCount: step.retriedAfter ? 2 : 1,
      },
    });
    if (step.retriedAfter)
      await db.runbookStepAttempt.create({
        data: {
          executionStepId: row.id,
          attemptNumber: 1,
          status: 'FAILED',
          errorCode: step.retriedAfter,
        },
      });
  }
  return execution;
}

const runScope = async (type: 'RUNBOOK' | 'SERVICE', id: string) =>
  runOpsInsights(
    { subjectKey: `${type}:${id}`, generation: 1, force: false },
    await getIntelligenceSettings()
  );

/**
 * Known answers. Runbook "restart": 6 finished runs on service A incidents, 3 to 8 days ago. Step "wait"
 * succeeds in every run but always on a second attempt (E_NOT_READY first). Step "restart" fails in 4 of
 * the 6 runs with E_TIMEOUT. Of the two successful runs, one incident resolved 30 minutes after the run
 * and one 300 minutes after: fixed 1 with a 120-minute window, 2 with 600.
 * Runbook "cdn": 3 successful runs, each followed within the hour by a note to flush the CDN cache.
 * Service A: 3 incidents of one problem resolved by hand with the same fix and no runbook run.
 */
async function world() {
  const teamA = await createTestTeam('Team A');
  const teamB = await createTestTeam('Team B');
  const serviceA = await createTestService('A', teamA.id);
  const serviceB = await createTestService('B', teamB.id);
  const restart = await publishedRunbook('restart', ago(200 * DAY), [serviceA.id]);
  const cdn = await publishedRunbook('cdn', ago(200 * DAY), [serviceA.id, serviceB.id]);
  const idle = await publishedRunbook('idle', ago(120 * DAY), [serviceA.id]);

  for (let index = 0; index < 6; index += 1) {
    const completedAt = ago((3 + index) * DAY);
    const succeeded = index >= 4;
    const fixAfter = index === 4 ? 30 : 300;
    const incident = await createTestIncident(`restart-${index}`, serviceA.id, {
      createdAt: new Date(completedAt.getTime() - 10 * MIN),
      ...(succeeded
        ? { status: 'RESOLVED', resolvedAt: new Date(completedAt.getTime() + fixAfter * MIN) }
        : {}),
    });
    await run(restart, serviceA.id, incident.id, completedAt, [
      { key: 'wait', status: 'SUCCEEDED', retriedAfter: 'E_NOT_READY' },
      succeeded
        ? { key: 'restart', status: 'SUCCEEDED' }
        : { key: 'restart', status: 'FAILED', errorCode: 'E_TIMEOUT' },
    ]);
  }

  for (let index = 0; index < 3; index += 1) {
    const completedAt = ago((3 + index) * DAY);
    const incident = await createTestIncident(`cdn-${index}`, serviceA.id, {
      createdAt: new Date(completedAt.getTime() - 10 * MIN),
    });
    await run(cdn, serviceA.id, incident.id, completedAt, [
      { key: 'restart', status: 'SUCCEEDED' },
    ]);
    await db.incidentNote.create({
      data: {
        incidentId: incident.id,
        content: [
          'Flushed the CDN cache for the api domain',
          'flush CDN cache for api domain',
          'Flushed CDN cache on the api domain',
        ].at(index)!,
        createdAt: new Date(completedAt.getTime() + 20 * MIN),
      },
    });
  }

  const fixes = [
    'Restarted the api pods and cleared the redis cache',
    'Restart api pods, clear redis cache',
    'Restarting api pods then clearing redis cache',
  ];
  for (const [index, fix] of fixes.entries()) {
    const createdAt = ago((10 + index) * DAY);
    const incident = await createTestIncident(`queue-${index}`, serviceA.id, {
      createdAt,
      status: 'RESOLVED',
      resolvedAt: new Date(createdAt.getTime() + 30 * MIN),
    });
    await db.incidentFingerprint.create({
      data: {
        incidentId: incident.id,
        serviceId: serviceA.id,
        template: 'Queue depth high on <host>',
        templateHash: 'queue-hash',
        tokens: [],
        labels: {},
        engineVersion: 'test',
        incidentCreatedAt: createdAt,
        resolvedAt: new Date(createdAt.getTime() + 30 * MIN),
      },
    });
    await db.incidentEvent.create({
      data: { incidentId: incident.id, type: 'MANUAL_RESOLVED', message: `Resolved: ${fix}` },
    });
  }

  await generateOpsRollups(new Date(NOW), { force: true, lookbackDays: 30, maxDaysPerRun: 60 });
  return { teamA, teamB, serviceA, serviceB, restart, cdn, idle };
}

describe('runbook health producer', () => {
  it('finds the failing step, the retried step and a runbook that fails often, from the rollups', async () => {
    await setSwitches();
    const { restart, idle } = await world();
    expect(await runScope('RUNBOOK', restart.runbook.id)).toBe('computed');
    const rows = await db.opsInsight.findMany({
      where: { scopeType: 'RUNBOOK', scopeId: restart.runbook.id },
      orderBy: { key: 'asc' },
    });
    expect(rows.map(row => [row.key, row.severity])).toEqual([
      ['fails-often', 'WARNING'],
      ['step-failing:restart', 'WARNING'],
      ['step-retried:wait', 'WARNING'],
    ]);
    const failing = rows.find(row => row.key === 'step-failing:restart');
    expect(failing?.summary).toBe('It failed 4 of 6 times, most often with E_TIMEOUT.');
    const retried = rows.find(row => row.key === 'step-retried:wait');
    expect(JSON.stringify(retried?.evidence)).toContain('E_NOT_READY');

    await runScope('RUNBOOK', idle.runbook.id);
    expect(
      (await db.opsInsight.findMany({ where: { scopeId: idle.runbook.id } })).map(row => row.key)
    ).toEqual(['unused']);
  });

  it('suggests the missing step by note id, and resolves its text only for readers of those incidents', async () => {
    await setSwitches();
    const { teamA, teamB, cdn } = await world();
    await runScope('RUNBOOK', cdn.runbook.id);
    const [row] = await db.opsInsight.findMany({ where: { scopeId: cdn.runbook.id } });
    expect(row.key).toMatch(/^missing-step:/);
    expect(JSON.stringify(row)).not.toMatch(/CDN|flush/i);

    const responder = await actorFor(teamA.id, 'RESPONDER');
    const view = await getRunbookHealthView(cdn.runbook.id, responder);
    expect(view?.insights.map(insight => insight.key)).toEqual([row.key]);
    expect(Object.values(view?.suggestedSteps ?? {})).toEqual([
      expect.stringMatching(/^Flush the CDN cache/i),
    ]);
    // The stored note ids resolve to text only under the viewer's incident scope.
    const refs = await db.incidentNote.findMany({ select: { id: true, incidentId: true } });
    const asRefs = refs.map(ref => ({ kind: 'note' as const, ...ref }));
    expect((await resolveNoteRefs(await actorFor(teamA.id), asRefs)).size).toBe(3);
    expect((await resolveNoteRefs(await actorFor(teamB.id), asRefs)).size).toBe(0);
  });

  it('reports effectiveness from the rollups, with the fix window as a setting', async () => {
    await setSwitches();
    const { teamA, restart } = await world();
    const actor = await actorFor(teamA.id, 'RESPONDER');
    const view = await getRunbookHealthView(restart.runbook.id, actor);
    expect(view?.effectiveness).toMatchObject({
      eligible: 6,
      succeeded: 2,
      incidentRuns: 6,
      fixed: 1,
      fixWindowMinutes: 120,
      mostFailingStep: { stepKey: 'restart', failed: 4, runs: 6, topErrorCode: 'E_TIMEOUT' },
    });
    expect(view?.effectiveness.successLowerBound).toBeLessThan(2 / 6);
    expect(view?.effectiveness.lastRunAt?.getTime()).toBe(ago(3 * DAY + MIN).getTime());

    await setSwitches({ fixWindow: 600 });
    expect((await getRunbookHealthView(restart.runbook.id, actor))?.effectiveness).toMatchObject({
      fixed: 2,
      fixWindowMinutes: 600,
    });
  });
});

describe('missing runbook producer', () => {
  it('suggests a runbook from 3 manual resolutions and drafts steps only from notes the viewer may read', async () => {
    await setSwitches();
    const { teamA, teamB, serviceA } = await world();
    await runScope('SERVICE', serviceA.id);
    const rows = await db.opsInsight.findMany({
      where: { scopeType: 'SERVICE', scopeId: serviceA.id, kind: 'runbook.missing' },
    });
    expect(rows.map(row => row.key)).toEqual(['queue-hash']);
    expect(JSON.stringify(rows[0])).not.toMatch(/redis|Queue depth/i);
    expect(rows[0].draftHref).toBe(`/services/${serviceA.id}?tab=runbooks#missing-runbooks`);

    const [suggestion] = await getMissingRunbookSuggestions(serviceA.id, await actorFor(teamA.id));
    expect(suggestion.template).toBe('Queue depth high on <host>');
    expect(suggestion.notes).toHaveLength(3);
    expect(suggestion.steps.map(step => step.name)).toEqual([
      'Restart the api pods',
      'Clear the redis cache',
    ]);
    expect(await getMissingRunbookSuggestions(serviceA.id, await actorFor(teamB.id))).toEqual([]);
  });

  it('stays quiet once a runbook ran on one of those incidents', async () => {
    await setSwitches();
    const { serviceA, restart } = await world();
    const event = await db.incidentEvent.findFirstOrThrow({ where: { type: 'MANUAL_RESOLVED' } });
    await run(restart, serviceA.id, event.incidentId, ago(DAY), [
      { key: 'restart', status: 'SUCCEEDED' },
    ]);
    await runScope('SERVICE', serviceA.id);
    expect(await db.opsInsight.count({ where: { kind: 'runbook.missing' } })).toBe(0);
  });
});

describe('the runbooks switch', () => {
  it('computes and shows nothing while runbook insights are off', async () => {
    await setSwitches({ runbooks: false });
    const { teamA, serviceA, restart } = await world();
    await runScope('RUNBOOK', restart.runbook.id);
    await runScope('SERVICE', serviceA.id);
    expect(await db.opsInsight.count({ where: { area: 'runbooks' } })).toBe(0);
    const actor = await actorFor(teamA.id, 'RESPONDER');
    expect(await getRunbookHealthView(restart.runbook.id, actor)).toBeNull();
    expect(await getMissingRunbookSuggestions(serviceA.id, actor)).toEqual([]);
    expect(await listInsightsForScope(actor, { type: 'RUNBOOK', id: restart.runbook.id })).toEqual(
      []
    );
  });
});

describe('runbook weight fit in the lane', () => {
  const fitItems = () =>
    db.intelligenceWorkItem.findMany({
      where: { kind: 'FIT_RUNBOOK_WEIGHTS' },
      select: { subjectKey: true, generation: true },
    });

  it('enqueues one fit, whose handler stores the result, and does not refit within the day', async () => {
    expect(await readRunbookWeightProposal()).toBeNull();
    expect(await scheduleRunbookWeightFit(NOW)).toBe(true);
    const [item] = await fitItems();
    expect(item).toMatchObject({ subjectKey: 'global' });
    // The fit runs in the handler, not in the schedule check.
    expect(await readRunbookWeightProposal()).toBeNull();
    expect(await runRunbookWeightFit({ generation: item.generation, force: false })).toBe('fitted');
    // Too few labels: the stored result is "no proposal", read back without fitting.
    expect(await readRunbookWeightProposal()).toMatchObject({ proposal: null });
    expect(await scheduleRunbookWeightFit(NOW + 1)).toBe(false);
    resetRunbookWeightFitSchedule();
    expect(await scheduleRunbookWeightFit(NOW + 20 * MIN)).toBe(false);
  });

  it('skips the fit when the examples are unchanged and never lets an older generation overwrite', async () => {
    expect(await runRunbookWeightFit({ generation: 10, force: false })).toBe('fitted');
    const first = await readRunbookWeightProposal();
    expect(await runRunbookWeightFit({ generation: 11, force: false })).toBe('unchanged');
    const touched = await readRunbookWeightProposal();
    expect(touched!.computedAt.getTime()).toBeGreaterThanOrEqual(first!.computedAt.getTime());
    // A forced refit from an older generation (a slow, superseded item) is fenced out.
    expect(await runRunbookWeightFit({ generation: 9, force: true })).toBe('stale');
    expect(await runRunbookWeightFit({ generation: 12, force: true })).toBe('fitted');
  });
});
