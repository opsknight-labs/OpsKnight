import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import {
  applyEvidenceToDraft,
  type DraftTimelineEvent,
} from '@/lib/intelligence/postmortems/evidence-draft';
import { runOpsInsights } from '@/lib/intelligence/ops-insights/handlers';
import {
  REPEAT_CAUSE_KIND,
  repeatCauseOverdueSql,
  repeatCauseProblemsSql,
} from '@/lib/intelligence/ops-insights/producers/postmortem-repeat-cause';
import {
  evidenceForStoredDraft,
  getPostmortemAssistForActor,
  getPostmortemRecurrenceForActor,
} from '@/lib/intelligence/postmortems/loaders';
import { getIntelligenceSettings, publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { Prisma } from '@prisma/client';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const DAY = 86_400_000;
const MIN = 60_000;
const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const enable = (on = true) =>
  db.intelligenceSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      opsInsightsEnabled: true,
      opsInsightsPostmortemsEnabled: on,
    },
    update: { opsInsightsEnabled: true, opsInsightsPostmortemsEnabled: on },
  });

async function indexed(title: string, serviceId: string, daysAgo: number, resolved = true) {
  const createdAt = new Date(Date.now() - daysAgo * DAY);
  const incident = await createTestIncident(title, serviceId, {
    createdAt,
    ...(resolved
      ? { status: 'RESOLVED', resolvedAt: new Date(createdAt.getTime() + 60 * MIN) }
      : {}),
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

async function postmortemWithItems(
  incidentId: string,
  title: string,
  items: Array<{
    title: string;
    status?: 'OPEN' | 'COMPLETED';
    dueInDays?: number;
    priority?: 'HIGH' | 'LOW';
  }>
) {
  const postmortem = await db.postmortem.create({ data: { incidentId, title } });
  for (const item of items)
    await db.actionItem.create({
      data: {
        postmortemId: postmortem.id,
        incidentId,
        title: item.title,
        status: item.status ?? 'OPEN',
        priority: item.priority ?? 'MEDIUM',
        dueDate: item.dueInDays === undefined ? null : new Date(Date.now() + item.dueInDays * DAY),
      },
    });
  return postmortem;
}

describe('postmortem recurrence', () => {
  it('links earlier occurrences to their last postmortem and open action items, only while switched on', async () => {
    const admin = await actorOf((await createTestUser({ role: 'ADMIN' })).id);
    const service = await createTestService('API');
    const other = await createTestService('Other');
    const oldest = await indexed('Disk full on host-1', service.id, 40);
    const earlier = await indexed('Disk full on host-2', service.id, 10);
    const current = await indexed('Disk full on host-3', service.id, 1);
    await indexed('Disk full on host-4', service.id, 120); // outside the window
    await indexed('Disk full on host-5', other.id, 5); // another service
    const single = await indexed('One-off error', service.id, 2);
    await postmortemWithItems(oldest.id, 'Disk full, first time', [
      { title: 'Add log rotation', dueInDays: -7, priority: 'HIGH' },
      { title: 'Page earlier on disk usage', dueInDays: 14 },
      { title: 'Clean up tmp', status: 'COMPLETED', dueInDays: -20 },
    ]);
    await postmortemWithItems(earlier.id, 'Disk full again', []);

    // Off by default: nothing is read and nothing is shown.
    expect(await getPostmortemRecurrenceForActor(current.id, admin)).toBeNull();
    expect(await getPostmortemAssistForActor(current.id, admin)).toBeNull();

    await enable();
    const recurrence = await getPostmortemRecurrenceForActor(current.id, admin);
    expect(recurrence).toMatchObject({
      template: 'disk full on host-<num>',
      windowDays: 90,
      occurrences: 3,
      capped: false,
      lastPostmortem: { incidentId: earlier.id, title: 'Disk full again' },
      openActionItemCount: 2,
      overdueActionItemCount: 1,
    });
    expect(recurrence!.previous.map(item => item.incidentId)).toEqual([earlier.id, oldest.id]);
    expect(recurrence!.openActionItems.map(item => [item.title, item.overdue])).toEqual([
      ['Add log rotation', true],
      ['Page earlier on disk usage', false],
    ]);

    // Quiet on a first occurrence, and for people without intelligence access.
    expect(await getPostmortemRecurrenceForActor(single.id, admin)).toBeNull();
    const user = await actorOf((await createTestUser({ role: 'USER' })).id);
    expect(await getPostmortemRecurrenceForActor(current.id, user)).toBeNull();
  });
});

describe('postmortem assist', () => {
  it('builds an evidence-filled draft and suggestions that respect open action items', async () => {
    const adminUser = await createTestUser({ role: 'ADMIN' });
    const admin = await actorOf(adminUser.id);
    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: adminUser.id, source: 'UI' }
    );
    await enable();
    const service = await createTestService('API');
    const earlier = await indexed('Checkout errors on pod-1', service.id, 8);
    const current = await indexed('Checkout errors on pod-2', service.id, 1);
    await postmortemWithItems(earlier.id, 'Checkout errors', [
      { title: 'Add canary and pre-release check for the API', dueInDays: 3 },
    ]);

    const confirmed = await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'Deploy api v42',
        occurredAt: new Date(current.createdAt.getTime() - 10 * MIN),
      },
    });
    const unconfirmed = await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'ci',
        kind: 'CONFIG',
        summary: 'Raise pool size',
        occurredAt: new Date(current.createdAt.getTime() - 5 * MIN),
      },
    });
    const finding = (subjectRef: string, rank: number) =>
      db.intelligenceFinding.create({
        data: {
          incidentId: current.id,
          kind: 'CHANGE_CORRELATION',
          subjectRef,
          rank,
          confidence: 0.8,
          evidence: { leadMinutes: 10, relation: 'SAME_SERVICE' },
          generation: 1,
          engineVersion: 'test',
        },
      });
    const accepted = await finding(confirmed.id, 0);
    await finding(unconfirmed.id, 1);
    await db.intelligenceFeedback.create({
      data: {
        subjectType: 'FINDING',
        subjectId: accepted.id,
        verdict: 'HELPFUL',
        serviceId: service.id,
        actorId: adminUser.id,
      },
    });

    const runbook = await db.runbook.create({
      data: { name: 'Restart workers', slug: 'restart-workers' },
    });
    const version = await db.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'PUBLISHED',
        definition: {},
        checksum: 'x',
      },
    });
    await db.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        incidentId: current.id,
        status: 'FAILED',
        deadlineAt: new Date(Date.now() + MIN),
        definitionChecksum: 'x',
        startedAt: new Date(current.createdAt.getTime() + 5 * MIN),
        completedAt: new Date(current.createdAt.getTime() + 6 * MIN),
      },
    });

    const assist = await getPostmortemAssistForActor(current.id, admin);
    expect(assist!.window).toEqual({ start: current.createdAt, end: current.resolvedAt });
    expect(assist!.evidence.changes.map(change => [change.summary, change.accepted])).toEqual(
      expect.arrayContaining([
        ['Deploy api v42', true],
        ['Raise pool size', false],
      ])
    );
    expect(assist!.evidence.runbookRuns).toMatchObject([
      { name: 'Restart workers', status: 'FAILED' },
    ]);
    expect(assist!.recurrence).toMatchObject({ occurrences: 2, openActionItemCount: 1 });

    const byTitle = new Map(assist!.suggestions.map(item => [item.title, item]));
    expect(byTitle.get(`Add a pre-release check or canary for ${service.name}`)).toMatchObject({
      source: 'ACCEPTED_CAUSE',
      duplicateOf: {
        title: 'Add canary and pre-release check for the API',
        incidentId: earlier.id,
      },
    });
    expect(byTitle.get('Fix runbook "Restart workers"')).toMatchObject({ duplicateOf: null });
    expect([...byTitle.keys()].some(title => /configuration/i.test(title))).toBe(false);

    const base = {
      timeline: [] as DraftTimelineEvent[],
      rootCause: 'template',
      resolution: 'template',
      lessons: 'template',
    };
    const draft = applyEvidenceToDraft(base, assist!.evidence);
    expect(draft.rootCause).toContain('Confirmed by responders');
    expect(draft.rootCause).toContain(`Deploy "Deploy api v42" on ${service.name}`);
    expect(draft.rootCause).not.toContain('Raise pool size');
    expect(draft.resolution).toContain('Runbook "Restart workers" was tried');
    expect(draft.lessons).toContain('seen 2 times in 90 days');
    expect(draft.timeline.some(event => event.title === 'Runbook: Restart workers')).toBe(true);
  });
});

describe('repeat cause with an overdue action item (lane producer)', () => {
  const run = async (serviceId: string) =>
    runOpsInsights(
      { subjectKey: `SERVICE:${serviceId}`, generation: 1, force: false },
      await getIntelligenceSettings()
    );

  it('stores one insight for the recurring problem whose follow-up is overdue, with no free text', async () => {
    await enable();
    const service = await createTestService('API');
    const first = await indexed('Disk full on host-1', service.id, 30);
    await indexed('Disk full on host-2', service.id, 12);
    const latest = await indexed('Disk full on host-3', service.id, 2);
    const fine = await indexed('Queue stuck on worker-1', service.id, 9);
    await indexed('Queue stuck on worker-2', service.id, 3);
    await postmortemWithItems(first.id, 'Disk full', [
      { title: 'Add log rotation', dueInDays: -45, priority: 'HIGH' },
      { title: 'Done already', status: 'COMPLETED', dueInDays: -50 },
    ]);
    await postmortemWithItems(fine.id, 'Queue stuck', [{ title: 'Tune consumers', dueInDays: 10 }]);

    expect(await run(service.id)).toBe('computed');
    const rows = await db.opsInsight.findMany({ where: { kind: REPEAT_CAUSE_KIND } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scopeType: 'SERVICE',
      scopeId: service.id,
      area: 'postmortems',
      severity: 'CRITICAL', // high priority, seen three times
      status: 'OPEN',
      title: 'Repeat problem, seen 3 times, has 1 overdue action item',
      draftHref: `/postmortems/${first.id}`,
    });
    expect(rows[0].evidence).toMatchObject({
      facts: expect.arrayContaining([{ label: 'Longest overdue', value: '45 days' }]),
      examples: [
        {
          label: expect.stringMatching(/^High-priority action item due \d{4}-\d{2}-\d{2}$/),
          href: `/postmortems/${first.id}`,
        },
        { label: 'Latest occurrence', href: `/incidents/${latest.id}` },
      ],
    });
    // Evidence holds ids, counts and days only: no incident, template or action-item text.
    expect(JSON.stringify(rows[0])).not.toMatch(/disk|rotation|host-/i);

    // Unchanged input: skipped. Completing the follow-up resolves the insight.
    expect(await run(service.id)).toBe('unchanged');
    await db.actionItem.updateMany({
      where: { incidentId: first.id },
      data: { status: 'COMPLETED' },
    });
    await run(service.id);
    expect(await db.opsInsight.findFirstOrThrow({ where: { id: rows[0].id } })).toMatchObject({
      status: 'RESOLVED',
    });
  });

  it('computes nothing while the postmortems area is off', async () => {
    const service = await createTestService('API');
    const first = await indexed('Disk full on host-1', service.id, 30);
    await indexed('Disk full on host-2', service.id, 12);
    await postmortemWithItems(first.id, 'Disk full', [
      { title: 'Add log rotation', dueInDays: -5 },
    ]);
    await enable(false);
    await run(service.id);
    expect(await db.opsInsight.count({ where: { kind: REPEAT_CAUSE_KIND } })).toBe(0);
  });

  it('reads through the fingerprint and action-item indexes, never a sequential scan', async () => {
    const service = await createTestService('API');
    const now = new Date();
    for (const sql of [
      repeatCauseProblemsSql(service.id, now),
      repeatCauseOverdueSql(service.id, ['disk full on host-<num>'], now),
    ]) {
      const plan = await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
        return tx.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
          Prisma.sql`EXPLAIN (FORMAT JSON) ${sql}`
        );
      });
      const text = JSON.stringify(plan);
      expect(text).toMatch(/idx_incident_fingerprint_(service_recent|problem)/);
      expect(text).not.toMatch(/"Node Type":\s*"Seq Scan"/);
    }
  });
});

describe('evidence for a stored draft', () => {
  it('cites only incidents that are public and share a team with the drafted incident', async () => {
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const serviceA = await createTestService('A svc', teamA.id);
    const serviceB = await createTestService('B svc', teamB.id);
    const target = await createTestIncident('Target', serviceA.id);
    const shared = await createTestIncident('Shared public', serviceA.id);
    const secret = await createTestIncident('Private on A', serviceA.id, { visibility: 'PRIVATE' });
    const elsewhere = await createTestIncident('Public on B', serviceB.id);
    const at = new Date();
    const upstream = (incidentId: string, title: string) => ({
      incidentId,
      title,
      serviceName: 'x',
      leadMinutes: 5,
      accepted: true,
    });
    const filtered = await evidenceForStoredDraft(target.id, {
      axis: [
        { kind: 'ALERT', at, title: 'Alert', detail: null, incidentId: null },
        {
          kind: 'UPSTREAM_INCIDENT',
          at,
          title: 'Shared public',
          detail: null,
          incidentId: shared.id,
        },
        {
          kind: 'UPSTREAM_INCIDENT',
          at,
          title: 'Public on B',
          detail: null,
          incidentId: elsewhere.id,
        },
      ],
      changes: [],
      upstreamIncidents: [
        upstream(shared.id, 'Shared public'),
        upstream(elsewhere.id, 'Public on B'),
      ],
      runbookRuns: [],
      similarFixes: [
        { incidentId: secret.id, title: 'Private on A', fix: 'secret fix' },
        { incidentId: shared.id, title: 'Shared public', fix: 'restart' },
      ],
      recurrence: {
        lastPostmortem: {
          incidentId: secret.id,
          title: 'Secret postmortem',
          status: 'PUBLISHED',
          createdAt: at,
        },
      } as never,
    });
    expect(filtered.axis.map(entry => entry.title)).toEqual(['Alert', 'Shared public']);
    expect(filtered.upstreamIncidents.map(item => item.incidentId)).toEqual([shared.id]);
    expect(filtered.similarFixes.map(item => item.incidentId)).toEqual([shared.id]);
    expect(filtered.recurrence?.lastPostmortem).toMatchObject({ incidentId: secret.id, title: '' });
  });
});
