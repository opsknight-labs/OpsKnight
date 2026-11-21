import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  DEFAULT_RUNBOOK_WEIGHTS,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { loadRunbookExamples } from '@/lib/intelligence/learning/runbook-weights';
import { computeRunbookFindings } from '@/lib/intelligence/recommendations/ranker';
import { analyzeResponse } from '@/lib/intelligence/response/handler';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const MIN = 60_000;
async function publishedRunbook(name: string) {
  const runbook = await db.runbook.create({
    data: { name, slug: `${name}-${Math.random().toString(36).slice(2, 8)}` },
  });
  const version = await db.runbookVersion.create({
    data: { runbookId: runbook.id, version: 1, state: 'PUBLISHED', definition: {}, checksum: 'x' },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { publishedVersionId: version.id } });
  return { runbook, version };
}

const evidence = { type: 'runbook_history', succeeded: 3, eligible: 4, bound: true };

describe('runbook-ranking labels', () => {
  it('labels recommendations from verdicts and from what happened when they were run', async () => {
    const service = await createTestService('Checkout');
    const { runbook, version } = await publishedRunbook('restart');
    const now = Date.now();
    const finding = async (incidentId: string, createdAt: Date) =>
      db.intelligenceFinding.create({
        data: {
          incidentId,
          kind: 'RUNBOOK_RECOMMENDATION',
          subjectRef: runbook.id,
          evidence,
          generation: 1,
          engineVersion: 'test',
          createdAt,
        },
      });
    const run = (
      incidentId: string,
      status: 'SUCCEEDED' | 'FAILED',
      startedAt: Date,
      completedAt: Date
    ) =>
      db.runbookExecution.create({
        data: {
          runbookId: runbook.id,
          runbookVersionId: version.id,
          serviceId: service.id,
          incidentId,
          status,
          startedAt,
          completedAt,
          createdAt: startedAt,
          deadlineAt: new Date(now + 3_600_000),
          definitionChecksum: 'x',
        },
      });
    const ago = (minutes: number) => new Date(now - minutes * MIN);

    // 1. Fixed: recommended, run, resolved 10 minutes later. A NOT_HELPFUL verdict is overridden.
    const fixed = await createTestIncident('fixed', service.id, {
      status: 'RESOLVED',
      createdAt: ago(600),
      resolvedAt: ago(470),
    });
    const fixedFinding = await finding(fixed.id, ago(590));
    await run(fixed.id, 'SUCCEEDED', ago(490), ago(480));
    await db.intelligenceFeedback.create({
      data: { subjectType: 'FINDING', subjectId: fixedFinding.id, verdict: 'NOT_HELPFUL' },
    });
    // 2. Failed run: a negative.
    const failed = await createTestIncident('failed', service.id, { createdAt: ago(300) });
    await finding(failed.id, ago(295));
    await run(failed.id, 'FAILED', ago(290), ago(289));
    // 3. Succeeded but still open and the window has not elapsed: undecided, excluded.
    const pending = await createTestIncident('pending', service.id, { createdAt: ago(60) });
    await finding(pending.id, ago(55));
    await run(pending.id, 'SUCCEEDED', ago(30), ago(20));
    // 4. Run before it was ever recommended: not a label for the recommendation.
    const early = await createTestIncident('early', service.id, { createdAt: ago(900) });
    await run(early.id, 'FAILED', ago(890), ago(889));
    await finding(early.id, ago(880));
    // 5. Only a verdict: HELPFUL.
    const rated = await createTestIncident('rated', service.id, { createdAt: ago(100) });
    const ratedFinding = await finding(rated.id, ago(95));
    await db.intelligenceFeedback.create({
      data: { subjectType: 'FINDING', subjectId: ratedFinding.id, verdict: 'HELPFUL' },
    });

    const examples = await loadRunbookExamples();
    const summary = examples.map(row => [row.source, row.helpful]).sort();
    expect(summary).toEqual([
      ['FEEDBACK', true],
      ['OUTCOME', false],
      ['OUTCOME', true],
    ]);
    expect(examples.every(row => row.succeeded === 3 && row.eligible === 4 && row.bound)).toBe(
      true
    );
  });

  it('ranks with published runbook weights and records that learned weights were used', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    await publishPolicyVersion(
      {},
      {
        mode: 'SUGGEST',
        definition: {
          ...DEFAULT_POLICY_DEFINITION,
          response: {
            enabled: true,
            runbookWeights: { ...DEFAULT_RUNBOOK_WEIGHTS, boundPrior: 0.15 },
          },
        },
        expectedHeadVersion: 0,
      },
      { actorId: admin.id, source: 'UI' }
    );
    const service = await createTestService('Edge');
    const { runbook } = await publishedRunbook('bound-untried');
    await db.serviceAutomationRule.create({
      data: { serviceId: service.id, runbookId: runbook.id },
    });
    const incident = await createTestIncident('Edge 500s', service.id);
    // Shipped ranking: an untried binding scores 0.
    const shipped = await db.$transaction(tx => computeRunbookFindings(tx, incident));
    expect(shipped[0].confidence).toBe(0);
    await analyzeResponse(
      { subjectKey: incident.id, generation: 1 },
      { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 }
    );
    const stored = await db.intelligenceFinding.findFirst({
      where: { incidentId: incident.id, kind: 'RUNBOOK_RECOMMENDATION' },
    });
    expect(stored).toMatchObject({ subjectRef: runbook.id, confidence: 0.15 });
    expect(stored!.evidence).toMatchObject({ learnedWeights: true, bound: true });
  });
});
