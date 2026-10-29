import { beforeEach, describe, expect, it } from 'vitest';
import {
  INTELLIGENCE_SETTINGS_DEFAULTS,
  DEFAULT_POLICY_DEFINITION,
} from '@/lib/intelligence/contract';
import { DISCOVERY_SAFETY_LAG_MS } from '@/lib/intelligence/jobs/discovery';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { createLaneState, runIntelligenceCycle } from '@/lib/intelligence/jobs/runner';
import { enqueueWorkItems } from '@/lib/intelligence/jobs/work-queue';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { analyzeIncident } from '@/lib/intelligence/similarity/analyzer';
import {
  detectCapabilities,
  resetCapabilityCacheForTests,
} from '@/lib/intelligence/similarity/capabilities';
import { replaceSimilarFindings } from '@/lib/intelligence/similarity/findings';
import { findSimilarIncidents } from '@/lib/intelligence/similarity/retrieval';
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
  resetCapabilityCacheForTests();
});

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 };
const options = { candidateCap: 50, lookbackDays: 30, minScore: 0.3, limit: 5, maxDbMs: 2000 };

async function indexed(
  title: string,
  serviceId: string,
  extra: { createdAt?: Date; resolved?: boolean } = {}
) {
  const incident = await createTestIncident(title, serviceId, {
    createdAt: extra.createdAt ?? new Date(Date.now() - 3_600_000),
    ...(extra.resolved ? { status: 'RESOLVED', resolvedAt: new Date() } : {}),
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

async function seedPolicy(mode: 'SHADOW' | 'SUGGEST') {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode, definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
}

describe('similar incident retrieval', () => {
  it('ranks genuine precedents first, excludes itself, and ignores unrelated incidents', async () => {
    const checkout = await createTestService('Checkout');
    const billing = await createTestService('Billing');
    const target = await indexed('Database connection errors on db-primary-1', checkout.id);
    const sameProblem = await indexed('Database connection errors on db-primary-7', checkout.id, {
      resolved: true,
    });
    const otherService = await indexed('Database connection refused on db-replica-2', billing.id);
    await indexed('Disk space low on node-3', checkout.id);

    const result = await findSimilarIncidents(target.id, options);
    expect(result).not.toBeNull();
    const ids = result!.results.map(r => r.incidentId);
    expect(ids[0]).toBe(sameProblem.id);
    expect(ids).toContain(otherService.id);
    expect(ids).not.toContain(target.id);
    expect(result!.results.find(r => r.incidentId === sameProblem.id)!.components).toMatchObject({
      template: 1,
      sameService: 1,
      resolved: 1,
    });
    expect(result!.tier).toBe('TRIGRAM_FTS');
  });

  it('respects the lookback window', async () => {
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    await indexed('Database connection errors', service.id, {
      createdAt: new Date(Date.now() - 90 * 86_400_000),
    });
    const result = await findSimilarIncidents(target.id, { ...options, lookbackDays: 30 });
    expect(result!.results).toHaveLength(0);
  });

  it('bounds the work no matter how many incidents match', async () => {
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    for (let i = 0; i < 12; i += 1)
      await indexed(`Database connection errors variant ${i}`, service.id);
    const result = await findSimilarIncidents(target.id, { ...options, candidateCap: 3, limit: 2 });
    expect(result!.candidatesEvaluated).toBeLessThanOrEqual(9); // three sources x cap
    expect(result!.results.length).toBeLessThanOrEqual(2);
  });

  it('returns null until the incident has been indexed', async () => {
    const service = await createTestService('Checkout');
    const raw = await createTestIncident('Not indexed yet', service.id);
    expect(await findSimilarIncidents(raw.id, options)).toBeNull();
  });

  it('falls back to full-text search when the trigram index is unavailable', async () => {
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors on db-primary-1', service.id);
    const precedent = await indexed('Database connection errors on db-primary-9', service.id);

    await db.$executeRawUnsafe('DROP INDEX IF EXISTS "idx_incident_fingerprint_trgm"');
    resetCapabilityCacheForTests();
    try {
      expect(await detectCapabilities()).toMatchObject({
        similarityTier: 'FTS_ONLY',
        trigramAvailable: false,
      });
      const result = await findSimilarIncidents(target.id, options);
      expect(result!.tier).toBe('FTS_ONLY');
      expect(result!.results[0].incidentId).toBe(precedent.id);
    } finally {
      await db.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "idx_incident_fingerprint_trgm" ON "IncidentFingerprint" USING GIN ("template" gin_trgm_ops)'
      );
      resetCapabilityCacheForTests();
    }
  });
});

describe('analysis and findings', () => {
  it('does no work while the effective policy is OFF', async () => {
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    await indexed('Database connection errors', service.id);
    expect(await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings)).toBe(
      'skipped_off'
    );
    expect(await db.intelligenceFinding.count()).toBe(0);
  });

  it('stores numeric evidence only and supersedes previous findings on re-analysis', async () => {
    await seedPolicy('SHADOW');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors on db-primary-1', service.id);
    const precedent = await indexed(
      'Database connection errors on db-primary-7 customer acme',
      service.id
    );

    expect(await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings)).toBe(
      'analyzed'
    );
    const first = await db.intelligenceFinding.findMany({ where: { incidentId: target.id } });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: 'SIMILAR_INCIDENT',
      status: 'ACTIVE',
      subjectRef: precedent.id,
      rank: 1,
      generation: 1,
    });
    expect(JSON.stringify(first[0].evidence)).not.toMatch(/acme|database|connection/i);
    expect(first[0].evidence).toMatchObject({ calibrated: false, tier: 'TRIGRAM_FTS' });

    expect(await analyzeIncident({ subjectKey: target.id, generation: 2 }, settings)).toBe(
      'analyzed'
    );
    const all = await db.intelligenceFinding.findMany({
      where: { incidentId: target.id },
      orderBy: { generation: 'asc' },
    });
    expect(all.map(f => [f.generation, f.status])).toEqual([
      [1, 'SUPERSEDED'],
      [2, 'ACTIVE'],
    ]);
    expect(all[0].supersededAt).not.toBeNull();
  });

  it('drops a late result from an older generation instead of overwriting newer findings', async () => {
    await seedPolicy('SHADOW');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    await indexed('Database connection errors', service.id);
    await analyzeIncident({ subjectKey: target.id, generation: 5 }, settings);

    const late = await db.$transaction(tx =>
      replaceSimilarFindings(tx, {
        incidentId: target.id,
        generation: 3,
        policyVersion: 1,
        tier: 'FTS_ONLY',
        results: [],
      })
    );
    expect(late).toBe('stale');
    const active = await db.intelligenceFinding.findMany({
      where: { incidentId: target.id, status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    expect(active[0].generation).toBe(5);
  });

  it('clears stale findings when nothing similar remains', async () => {
    await seedPolicy('SUGGEST');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    await indexed('Database connection errors', service.id);
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);
    await db.$transaction(tx =>
      replaceSimilarFindings(tx, {
        incidentId: target.id,
        generation: 2,
        policyVersion: 1,
        tier: 'FTS_ONLY',
        results: [],
      })
    );
    expect(
      await db.intelligenceFinding.count({ where: { incidentId: target.id, status: 'ACTIVE' } })
    ).toBe(0);
  });

  it('handles deleted incidents and not-yet-indexed incidents correctly', async () => {
    await seedPolicy('SHADOW');
    expect(await analyzeIncident({ subjectKey: 'gone', generation: 1 }, settings)).toBe(
      'incident_gone'
    );
    const service = await createTestService('Checkout');
    const raw = await createTestIncident('Not indexed', service.id);
    await expect(analyzeIncident({ subjectKey: raw.id, generation: 1 }, settings)).rejects.toThrow(
      /not ready/
    );
  });

  it('cascades findings away with the incident', async () => {
    await seedPolicy('SHADOW');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    await indexed('Database connection errors', service.id);
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);
    await db.incident.delete({ where: { id: target.id } });
    expect(await db.intelligenceFinding.count()).toBe(0);
  });
});

describe('full lane chain', () => {
  it('discovers, fingerprints and analyzes new incidents without touching the incident rows', async () => {
    await seedPolicy('SHADOW');
    const service = await createTestService('Checkout');
    const precedent = await createTestIncident(
      'Database connection errors on db-primary-2',
      service.id,
      {
        status: 'RESOLVED',
        resolvedAt: new Date(),
      }
    );
    await db.$transaction(tx => indexIncident(precedent.id, tx));

    const state = createLaneState();
    let clock = Date.now();
    const deps = { getCriticalLagMs: async () => 0, now: () => clock };
    await runIntelligenceCycle(state, deps); // initialise the discovery cursor
    const created = await createTestIncident(
      'Database connection errors on db-primary-8',
      service.id
    );
    const before = await db.incident.findUniqueOrThrow({ where: { id: created.id } });

    clock = Date.now() + DISCOVERY_SAFETY_LAG_MS + 5000;
    await runIntelligenceCycle(state, deps); // discover + index (enqueues analysis)
    await runIntelligenceCycle(state, deps); // analyze

    const findings = await db.intelligenceFinding.findMany({
      where: { incidentId: created.id, status: 'ACTIVE' },
    });
    expect(findings.map(f => f.subjectRef)).toEqual([precedent.id]);
    expect(await db.incident.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before);
    expect(await db.intelligenceWorkItem.count()).toBe(0);
  });

  it('keeps re-analysing an incident after earlier work finished, so newer results are never dropped as stale', async () => {
    await seedPolicy('SHADOW');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors on db-primary-1', service.id);
    const deps = { getCriticalLagMs: async () => 0 };

    // A busy incident is signalled several times while queued, then analysed and its item deleted.
    for (let i = 0; i < 3; i += 1)
      await enqueueWorkItems([{ kind: 'ANALYZE_INCIDENT', subjectKey: target.id }]);
    await runIntelligenceCycle(createLaneState(), deps);
    expect(await db.intelligenceWorkItem.count()).toBe(0);
    expect(await db.intelligenceFinding.count({ where: { incidentId: target.id } })).toBe(0);

    // A precedent appears and the incident is signalled again: the new analysis must be written.
    const precedent = await indexed('Database connection errors on db-primary-2', service.id, {
      resolved: true,
    });
    await enqueueWorkItems([{ kind: 'ANALYZE_INCIDENT', subjectKey: target.id }]);
    await runIntelligenceCycle(createLaneState(), deps);
    const active = await db.intelligenceFinding.findMany({
      where: { incidentId: target.id, status: 'ACTIVE' },
    });
    expect(active.map(f => f.subjectRef)).toEqual([precedent.id]);

    // And once more after that item is gone too: the precedent is now superseded by a fresh analysis.
    await enqueueWorkItems([{ kind: 'ANALYZE_INCIDENT', subjectKey: target.id }]);
    await runIntelligenceCycle(createLaneState(), deps);
    const latest = await db.intelligenceFinding.findMany({
      where: { incidentId: target.id, status: 'ACTIVE' },
    });
    expect(latest).toHaveLength(1);
    expect(latest[0].generation).toBeGreaterThan(active[0].generation);
  });

  it('keeps no text for an incident whose policy is OFF and never offers it as a precedent', async () => {
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    const service = await createTestService('Checkout');
    const incident = await createTestIncident(
      'Database connection errors on db-primary-3',
      service.id
    );
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: incident.id }]);
    await runIntelligenceCycle(createLaneState(), { getCriticalLagMs: async () => 0 });
    expect(
      await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } })
    ).toMatchObject({
      template: '',
      tokens: [],
    });

    const target = await indexed('Database connection errors on db-primary-4', service.id);
    const result = await findSimilarIncidents(target.id, options);
    expect(result!.results.map(r => r.incidentId)).not.toContain(incident.id);
  });
});
