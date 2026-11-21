import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS, type CorrelationRule } from '@/lib/intelligence/contract';
import { correlateIncident } from '@/lib/intelligence/correlation/handler';
import { replayPolicyRules } from '@/lib/intelligence/evaluation/replay';
import { simulateCorrelation, type ReplayIncident } from '@/lib/intelligence/evaluation/simulate';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { createTestIncident, createTestService, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, maxJobMs: 60_000, maxDbMs: 30_000, revision: 1 };
const rule = (o: Partial<CorrelationRule> = {}): CorrelationRule => ({
  id: 'same', kind: 'CONTENT_TEMPLATE', enabled: true, keys: [], windowSeconds: 300, maxWindowSeconds: 900, minScore: 0.8, ...o,
});
const hoursAgo = (h: number, extraSeconds = 0) => new Date(Date.now() - h * 3_600_000 + extraSeconds * 1000);

async function seed() {
  const checkout = await createTestService('Checkout');
  const billing = await createTestService('Billing');
  const specs: Array<[string, string, Date, 'LOW' | 'HIGH']> = [
    ['Database errors on db-1', checkout.id, hoursAgo(5), 'LOW'],
    ['Database errors on db-2', checkout.id, hoursAgo(5, 40), 'LOW'],
    ['Database errors on db-3', checkout.id, hoursAgo(5, 90), 'LOW'],
    ['Database errors on db-4', billing.id, hoursAgo(5, 20), 'LOW'],
    ['Disk space low on node-1', checkout.id, hoursAgo(4), 'LOW'],
    ['Database errors on db-5', checkout.id, hoursAgo(3), 'HIGH'],
    ['Database errors on db-6', checkout.id, hoursAgo(3, 30), 'HIGH'],
    ['Database errors on db-7', checkout.id, hoursAgo(2), 'LOW'],
  ];
  const created = [];
  for (const [title, serviceId, createdAt, urgency] of specs) {
    const incident = await createTestIncident(title, serviceId, { createdAt, urgency });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    created.push(incident);
  }
  return created;
}

async function publish(rules: CorrelationRule[]) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: { ...DEFAULT_POLICY_DEFINITION, correlation: { rules, criticalBypass: true } }, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({ data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true } });
  return admin;
}

describe('replay preview', () => {
  it('predicts exactly what the live engine then does', async () => {
    const rules = [rule(), rule({ id: 'by-service', kind: 'EXACT_FIELD', keys: ['service'], windowSeconds: 3600, maxWindowSeconds: 7200 })];
    const incidents = await seed();
    const admin = await publish(rules);
    const preview = await replayPolicyRules(settings, { rules, days: 7, createdById: admin.id });

    for (const incident of incidents) await correlateIncident({ subjectKey: incident.id }, settings);
    const members = await db.correlationMember.findMany({ include: { group: true } });
    const groupSizes = new Map<string, number>();
    for (const m of members) groupSizes.set(m.groupId, (groupSizes.get(m.groupId) ?? 0) + 1);
    const multi = [...groupSizes.values()].filter(size => size >= 2);

    expect(preview.groups).toBe(multi.length);
    expect(preview.criticalExcluded).toBe(2);
    // Overlapping rules propose the same member-to-anchor pair, which is stored once.
    expect(await db.incidentRelationship.count()).toBe(preview.suggestedLinks);
    const groupedByEngine = new Set(members.filter(m => (groupSizes.get(m.groupId) ?? 0) >= 2).map(m => m.incidentId));
    expect(preview.groupedIncidents).toBe(groupedByEngine.size);
  });

  it('records a completed evaluation run with summary metrics and changes nothing else', async () => {
    const rules = [rule()];
    const incidents = await seed();
    const admin = await publish(rules);
    const before = await db.incident.findMany({ orderBy: { id: 'asc' } });
    const result = await replayPolicyRules(settings, { rules, days: 7, createdById: admin.id });

    const run = await db.intelligenceEvaluationRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({ kind: 'REPLAY', status: 'COMPLETED', createdById: admin.id });
    expect(run.metrics).toMatchObject({ incidentsEvaluated: incidents.length, groups: result.groups, truncated: false });
    expect(JSON.stringify(run.metrics)).not.toMatch(/Database|Disk/);
    expect(await db.incident.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.correlationGroup.count()).toBe(0);
  });

  it('only looks at the requested window and never beyond the configured lookback', async () => {
    const rules = [rule()];
    const service = await createTestService('Old');
    const old = await createTestIncident('Database errors on db-0', service.id, { createdAt: hoursAgo(72), urgency: 'LOW' });
    await db.$transaction(tx => indexIncident(old.id, tx));
    await seed();
    const admin = await publish(rules);
    expect((await replayPolicyRules(settings, { rules, days: 1, createdById: admin.id })).incidentsEvaluated).toBe(8);
    expect((await replayPolicyRules(settings, { rules, days: 7, createdById: admin.id })).incidentsEvaluated).toBe(9);
    const clamped = await replayPolicyRules({ ...settings, lookbackDays: 2 }, { rules, days: 365, createdById: admin.id });
    expect(clamped.days).toBe(2);
    expect(clamped.incidentsEvaluated).toBe(8);
  });

  it('marks failed runs and rethrows', async () => {
    const rules = [rule()];
    const admin = await publish(rules);
    await expect(
      replayPolicyRules(settings, { rules: null as never, days: 7, createdById: admin.id })
    ).rejects.toBeTruthy();
    expect((await db.intelligenceEvaluationRun.findFirstOrThrow()).status).toBe('FAILED');
  });

  it('matches the pure simulator on the same data', async () => {
    const rules = [rule()];
    const incidents = await seed();
    const admin = await publish(rules);
    const fingerprints = await db.incidentFingerprint.findMany({ include: { incident: true } });
    const replayed: ReplayIncident[] = fingerprints.map(f => ({
      id: f.incidentId, serviceId: f.serviceId, urgency: f.incident.urgency, createdAt: f.incidentCreatedAt, template: f.template, labels: {},
    }));
    const direct = simulateCorrelation(replayed, rules);
    const viaDb = await replayPolicyRules(settings, { rules, days: 7, createdById: admin.id });
    expect(viaDb.groups).toBe(direct.groups);
    expect(viaDb.suggestedLinks).toBe(direct.suggestedLinks);
    expect(incidents.length).toBe(8);
  });
});
