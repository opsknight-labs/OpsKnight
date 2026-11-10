import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
  type CorrelationRule,
} from '@/lib/intelligence/contract';
import { correlateIncident } from '@/lib/intelligence/correlation/handler';
import { declareDependency } from '@/lib/intelligence/dependencies/service';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { analyzeResponse } from '@/lib/intelligence/response/handler';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  RCA_MIN_TOP1_ACCURACY,
  RCA_SCENARIOS,
  type RcaScenario,
} from '../../fixtures/intelligence/rca-fixture';
import {
  STORM_EXPECTED,
  STORM_INCIDENTS,
  scoreGrouping,
} from '../../fixtures/intelligence/storm-fixture';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/**
 * Labelled engine fixtures: the correlation engine over a labelled storm (compression and false grouping),
 * and response analysis over labelled root-cause scenarios (the expected top cause).
 */
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const settings = {
  ...INTELLIGENCE_SETTINGS_DEFAULTS,
  maxJobMs: 60_000,
  maxDbMs: 30_000,
  revision: 1,
};
const MINUTE = 60_000;

async function configure(
  mode: 'SHADOW' | 'SUGGEST',
  definition: Partial<typeof DEFAULT_POLICY_DEFINITION>
) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode, definition: { ...DEFAULT_POLICY_DEFINITION, ...definition }, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  return admin;
}

describe('storm fixture: correlation grouping', () => {
  const rule: CorrelationRule = {
    id: 'same-problem',
    kind: 'CONTENT_TEMPLATE',
    enabled: true,
    keys: [],
    windowSeconds: 300,
    maxWindowSeconds: 900,
    minScore: 0.8,
  };

  it('groups each real problem once, mixes none, and leaves decoys alone', async () => {
    await configure('SHADOW', { correlation: { rules: [rule], criticalBypass: true } });
    const services = {
      checkout: await createTestService('Checkout'),
      edge: await createTestService('Edge'),
      storage: await createTestService('Storage'),
      misc: await createTestService('Misc'),
    };
    const start = new Date('2026-10-27T10:00:00Z').getTime();
    const ordered = [...STORM_INCIDENTS].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
    const labelled: Array<{ key: string; label: string }> = [];
    for (const item of ordered) {
      const incident = await createTestIncident(item.title, services[item.service].id, {
        createdAt: new Date(start + item.offsetSeconds * 1000),
        urgency: item.urgency ?? 'LOW',
      });
      await db.$transaction(tx => indexIncident(incident.id, tx));
      await correlateIncident({ subjectKey: incident.id }, settings);
      labelled.push({ key: incident.id, label: item.label });
    }

    const members = await db.correlationMember.findMany({
      select: { incidentId: true, groupId: true },
    });
    const score = scoreGrouping(labelled, new Map(members.map(m => [m.incidentId, m.groupId])));
    console.info(`[engine-fixtures] storm ${JSON.stringify(score)}`);
    expect(score.incidents).toBe(STORM_INCIDENTS.length);
    expect(score.falseGroupRate).toBeLessThanOrEqual(STORM_EXPECTED.maxFalseGroupRate);
    expect(score.pairRecall).toBeGreaterThanOrEqual(STORM_EXPECTED.minPairRecall);
    expect(score.compressionRatio).toBeGreaterThanOrEqual(STORM_EXPECTED.minCompressionRatio);
    expect(score.clusters).toBe(STORM_EXPECTED.clusters);
    // Grouping is a record, never a change to the incidents or a link (SHADOW).
    expect(await db.incidentRelationship.count()).toBe(0);
  });

  it('scores a deliberately wrong grouping as wrong', () => {
    // The scorer must not flatter: one group for everything is maximal compression and maximal mixing.
    const labelled = STORM_INCIDENTS.map((item, i) => ({ key: String(i), label: item.label }));
    const everything = scoreGrouping(labelled, new Map(labelled.map(l => [l.key, 'one'])));
    expect(everything.falseGroupRate).toBe(1);
    const nothing = scoreGrouping(labelled, new Map());
    expect(nothing.compressionRatio).toBe(1);
    expect(nothing.pairRecall).toBe(0);
  });
});

describe('RCA fixture: expected top cause', () => {
  async function run(scenario: RcaScenario): Promise<string | null> {
    const admin = await configure('SUGGEST', { response: { enabled: true } });
    const services = new Map<string, string>();
    for (const name of scenario.services)
      services.set(name, (await createTestService(`${scenario.id} ${name}`)).id);
    for (const [upstream, downstream] of scenario.dependencies ?? [])
      await declareDependency(
        {
          upstreamServiceId: services.get(upstream),
          downstreamServiceId: services.get(downstream),
        },
        { actorId: admin.id, source: 'UI' }
      );
    const onset = new Date(Date.now() - 5 * MINUTE);
    for (const routine of scenario.history ?? [])
      await db.changeEvent.createMany({
        data: Array.from({ length: routine.count }, (_, i) => ({
          serviceId: services.get(routine.service)!,
          source: routine.source,
          kind: 'DEPLOY' as const,
          summary: `routine ${i}`,
          // Between six hours and thirty days before onset: history, never a candidate.
          occurredAt: new Date(onset.getTime() - (8 * 60 + i * 5) * MINUTE),
        })),
      });
    const labels = new Map<string, string>();
    for (const change of scenario.changes) {
      const row = await db.changeEvent.create({
        data: {
          serviceId: change.service === null ? null : services.get(change.service)!,
          source: change.source ?? 'ci',
          kind: change.kind ?? 'DEPLOY',
          summary: change.label,
          occurredAt: new Date(onset.getTime() - change.minutesBefore * MINUTE),
        },
      });
      labels.set(row.id, change.label);
    }
    const incident = await createTestIncident(
      `${scenario.id} errors`,
      services.get(scenario.services[0])!,
      { createdAt: onset, urgency: 'LOW' }
    );
    expect(await analyzeResponse({ subjectKey: incident.id, generation: 1 }, settings)).toBe(
      'analyzed'
    );
    const top = await db.intelligenceFinding.findFirst({
      where: { incidentId: incident.id, kind: 'CHANGE_CORRELATION', status: 'ACTIVE' },
      orderBy: { rank: 'asc' },
    });
    return top ? (labels.get(top.subjectRef) ?? `unlabelled:${top.subjectRef}`) : null;
  }

  const outcomes: Array<{ id: string; expected: string | null; actual: string | null }> = [];

  it.for(RCA_SCENARIOS.map(s => ({ ...s, name: s.id })))('$name', async scenario => {
    const actual = await run(scenario);
    outcomes.push({ id: scenario.id, expected: scenario.expectedTopCause, actual });
    expect(actual, scenario.why).toBe(scenario.expectedTopCause);
  });

  it('reaches the required top-1 accuracy over the whole fixture', () => {
    expect(outcomes).toHaveLength(RCA_SCENARIOS.length);
    const correct = outcomes.filter(o => o.actual === o.expected).length;
    console.info(`[engine-fixtures] rca top-1 ${correct}/${outcomes.length}`);
    expect(correct / outcomes.length).toBeGreaterThanOrEqual(RCA_MIN_TOP1_ACCURACY);
  });
});
