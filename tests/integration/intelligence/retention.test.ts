import { beforeEach, describe, expect, it } from 'vitest';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { createLaneState, runIntelligenceCycle } from '@/lib/intelligence/jobs/runner';
import {
  RETENTION_INTERVAL_MS,
  purgeExpiredIntelligenceData,
} from '@/lib/intelligence/jobs/retention';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const retention = { ...INTELLIGENCE_SETTINGS_DEFAULTS, maxDbMs: 5000 };

async function finding(incidentId: string, createdAt: Date) {
  return db.intelligenceFinding.create({
    data: {
      incidentId,
      kind: 'SIMILAR_INCIDENT',
      evidence: {},
      generation: 1,
      engineVersion: 'test',
      createdAt,
    },
  });
}

describe('retention sweep', () => {
  it('removes only expired data, per the configured retention of each entity', async () => {
    const service = await createTestService('Checkout');
    const oldIncident = await createTestIncident('Old', service.id, { createdAt: days(800) });
    const newIncident = await createTestIncident('New', service.id, { createdAt: days(1) });
    for (const incident of [oldIncident, newIncident])
      await db.$transaction(tx => indexIncident(incident.id, tx));
    await finding(newIncident.id, days(400)); // beyond 365d findings retention
    await finding(newIncident.id, days(10));
    const user = await createTestUser({ role: 'ADMIN' });
    await db.intelligenceFeedback.createMany({
      data: [
        {
          subjectType: 'FINDING',
          subjectId: 'a',
          verdict: 'HELPFUL',
          actorId: user.id,
          createdAt: days(800),
        },
        {
          subjectType: 'FINDING',
          subjectId: 'b',
          verdict: 'HELPFUL',
          actorId: user.id,
          createdAt: days(5),
        },
      ],
    });
    await db.intelligencePattern.createMany({
      data: [
        { scopeKey: 'global', kind: 'k', key: 'old', lastSeenAt: days(800) },
        { scopeKey: 'global', kind: 'k', key: 'new', lastSeenAt: days(2) },
      ],
    });

    const result = await purgeExpiredIntelligenceData(retention, { batchSize: 100 });
    expect(result).toMatchObject({
      fingerprints: 1,
      findings: 1,
      feedback: 1,
      patterns: 2, // the seeded old pattern and the old fingerprint's derived outcome aggregate
      more: false,
    });
    expect((await db.incidentFingerprint.findMany()).map(f => f.incidentId)).toEqual([
      newIncident.id,
    ]);
    expect(await db.intelligenceFinding.count()).toBe(1);
    expect((await db.intelligenceFeedback.findMany()).map(f => f.subjectId)).toEqual(['b']);
    expect(
      (await db.intelligencePattern.findMany({ where: { kind: 'k' } })).map(p => p.key)
    ).toEqual(['new']);
    expect(
      await db.intelligencePattern.count({
        where: { kind: 'PROBLEM_OUTCOME', scopeKey: service.id },
      })
    ).toBe(1);
    // The retained incidents themselves are never touched.
    expect(await db.incident.count()).toBe(2);
  });

  it('keeps links a person made or confirmed, and drops expired system suggestions', async () => {
    const service = await createTestService('Checkout');
    const [a, b, c, d] = await Promise.all(
      ['A', 'B', 'C', 'D'].map(title =>
        createTestIncident(title, service.id, { createdAt: days(1) })
      )
    );
    const old = days(400);
    await db.incidentRelationship.createMany({
      data: [
        {
          sourceIncidentId: a.id,
          targetIncidentId: b.id,
          type: 'RELATED',
          origin: 'RULE',
          decision: 'SUGGESTED',
          score: 1,
          evidence: {},
          engineVersion: 't',
          createdAt: old,
        },
        {
          sourceIncidentId: a.id,
          targetIncidentId: c.id,
          type: 'RELATED',
          origin: 'RULE',
          decision: 'ACCEPTED',
          score: 1,
          evidence: {},
          engineVersion: 't',
          createdAt: old,
        },
        {
          sourceIncidentId: a.id,
          targetIncidentId: d.id,
          type: 'RELATED',
          origin: 'HUMAN',
          decision: 'ACCEPTED',
          score: 1,
          evidence: {},
          engineVersion: 't',
          createdAt: old,
        },
      ],
    });
    const result = await purgeExpiredIntelligenceData(retention, { batchSize: 100 });
    expect(result.relationships).toBe(1);
    expect((await db.incidentRelationship.findMany()).map(r => r.targetIncidentId).sort()).toEqual(
      [c.id, d.id].sort()
    );
  });

  it('keeps superseded findings only briefly and closes groups whose window has passed', async () => {
    const service = await createTestService('Checkout');
    const incident = await createTestIncident('X', service.id, { createdAt: days(1) });
    await db.intelligenceFinding.createMany({
      data: [
        {
          incidentId: incident.id,
          kind: 'SIMILAR_INCIDENT',
          evidence: {},
          generation: 1,
          engineVersion: 't',
          status: 'SUPERSEDED',
          supersededAt: days(8),
        },
        {
          incidentId: incident.id,
          kind: 'SIMILAR_INCIDENT',
          evidence: {},
          generation: 2,
          engineVersion: 't',
          status: 'SUPERSEDED',
          supersededAt: days(1),
        },
        {
          incidentId: incident.id,
          kind: 'SIMILAR_INCIDENT',
          evidence: {},
          generation: 3,
          engineVersion: 't',
        },
      ],
    });
    const result = await purgeExpiredIntelligenceData(retention, { batchSize: 100 });
    expect(result.supersededFindings).toBe(1);
    expect(
      (await db.intelligenceFinding.findMany({ orderBy: { generation: 'asc' } })).map(
        f => f.generation
      )
    ).toEqual([2, 3]);
  });

  it('works through a backlog in bounded batches and reports when more remains', async () => {
    const service = await createTestService('Checkout');
    const incident = await createTestIncident('Anchor', service.id);
    for (let i = 0; i < 5; i += 1) await finding(incident.id, days(500));

    const first = await purgeExpiredIntelligenceData(retention, { batchSize: 2 });
    expect(first).toMatchObject({ findings: 2, more: true });
    expect(await db.intelligenceFinding.count()).toBe(3);
    await purgeExpiredIntelligenceData(retention, { batchSize: 2 });
    const last = await purgeExpiredIntelligenceData(retention, { batchSize: 2 });
    expect(last).toMatchObject({ findings: 1, more: false });
    expect(await db.intelligenceFinding.count()).toBe(0);
  });

  it('honours shorter retention configured from the UI', async () => {
    const service = await createTestService('Checkout');
    const incident = await createTestIncident('Anchor', service.id);
    await finding(incident.id, days(40));
    await purgeExpiredIntelligenceData(
      { ...retention, findingRetentionDays: 30 },
      { batchSize: 100 }
    );
    expect(await db.intelligenceFinding.count()).toBe(0);
  });
});

describe('retention in the lane cycle', () => {
  it('runs even while intelligence is disabled, and only once per interval', async () => {
    const service = await createTestService('Checkout');
    const incident = await createTestIncident('Anchor', service.id);
    await db.intelligenceSettings.create({
      data: {
        id: 'default',
        ...INTELLIGENCE_SETTINGS_DEFAULTS,
        enabled: false,
        findingRetentionDays: 30,
      },
    });
    await finding(incident.id, days(40));

    const state = createLaneState();
    let clock = Date.now();
    const deps = { getCriticalLagMs: async () => 0, now: () => clock };
    expect((await runIntelligenceCycle(state, deps)).status).toBe('disabled');
    expect(await db.intelligenceFinding.count()).toBe(0);

    await finding(incident.id, days(40));
    await runIntelligenceCycle(state, deps); // within the interval: no sweep
    expect(await db.intelligenceFinding.count()).toBe(1);

    clock += RETENTION_INTERVAL_MS + 1000;
    await runIntelligenceCycle(state, deps);
    expect(await db.intelligenceFinding.count()).toBe(0);
  });

  it('does nothing on an install that never configured intelligence', async () => {
    const service = await createTestService('Checkout');
    const incident = await createTestIncident('Anchor', service.id);
    await finding(incident.id, days(900));
    await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: async () => 0 });
    expect(await db.intelligenceFinding.count()).toBe(1);
  });
});
