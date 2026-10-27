import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS, type CorrelationRule } from '@/lib/intelligence/contract';
import { closeExpiredGroups } from '@/lib/intelligence/correlation/groups';
import { correlateIncident, shouldCorrelate } from '@/lib/intelligence/correlation/handler';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { createLaneState, runIntelligenceCycle } from '@/lib/intelligence/jobs/runner';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { createTestIncident, createTestService, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, maxJobMs: 60_000, maxDbMs: 30_000, revision: 1 };
const rule = (overrides: Partial<CorrelationRule> = {}): CorrelationRule => ({
  id: 'same-problem',
  kind: 'CONTENT_TEMPLATE',
  enabled: true,
  keys: [],
  windowSeconds: 300,
  maxWindowSeconds: 900,
  minScore: 0.8,
  ...overrides,
});

async function configure(mode: 'SHADOW' | 'SUGGEST', rules: CorrelationRule[] = [rule()], enabled = true) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const head = (await db.intelligencePolicy.findUnique({ where: { scopeKey: 'global' } }))?.headVersion ?? 0;
  await publishPolicyVersion(
    {},
    {
      mode,
      definition: { ...DEFAULT_POLICY_DEFINITION, correlation: { rules, criticalBypass: true } },
      expectedHeadVersion: head,
    },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.upsert({
    where: { id: 'default' },
    update: { enabled },
    create: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled },
  });
}

const base = new Date('2026-10-27T10:00:00Z');
const at = (seconds: number) => new Date(base.getTime() + seconds * 1000);

async function incident(title: string, serviceId: string, createdAt: Date, urgency: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW') {
  const created = await createTestIncident(title, serviceId, { createdAt, urgency });
  await db.$transaction(tx => indexIncident(created.id, tx));
  return created;
}
const correlate = (id: string) => correlateIncident({ subjectKey: id }, settings);

describe('SHADOW correlation', () => {
  it('records one group and its members without creating any link', async () => {
    await configure('SHADOW');
    const service = await createTestService('Checkout');
    const first = await incident('Database errors on db-primary-1', service.id, at(0));
    const second = await incident('Database errors on db-primary-7', service.id, at(30));
    const third = await incident('Database errors on db-primary-9', service.id, at(60));
    for (const i of [first, second, third]) expect(await correlate(i.id)).toMatchObject({ outcome: 'correlated', groups: 1 });

    const groups = await db.correlationGroup.findMany();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ anchorIncidentId: first.id, scopeKind: 'SERVICE', ruleId: 'same-problem' });
    const members = await db.correlationMember.findMany({ orderBy: { createdAt: 'asc' } });
    expect(members.map(m => [m.role, m.decision])).toEqual([
      ['ANCHOR', 'SHADOW'],
      ['MEMBER', 'SHADOW'],
      ['MEMBER', 'SHADOW'],
    ]);
    expect(await db.incidentRelationship.count()).toBe(0);
    expect(await db.correlationDecisionEvent.count()).toBe(3);
  });

  it('never modifies the incidents it groups', async () => {
    await configure('SHADOW');
    const service = await createTestService('Checkout');
    const a = await incident('Database errors', service.id, at(0));
    const b = await incident('Database errors', service.id, at(10));
    const before = await db.incident.findMany({ orderBy: { id: 'asc' } });
    await correlate(a.id);
    await correlate(b.id);
    expect(await db.incident.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.alert.count()).toBe(0);
  });
});

describe('SUGGEST correlation', () => {
  it('proposes a reversible link from each member to the anchor, idempotently', async () => {
    await configure('SUGGEST');
    const service = await createTestService('Checkout');
    const anchor = await incident('Database errors', service.id, at(0));
    const member = await incident('Database errors', service.id, at(20));
    await correlate(anchor.id);
    expect(await correlate(member.id)).toMatchObject({ suggestions: 1 });
    expect(await correlate(member.id)).toMatchObject({ outcome: 'correlated', suggestions: 0 }); // replay

    const links = await db.incidentRelationship.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      sourceIncidentId: member.id, targetIncidentId: anchor.id, type: 'RELATED', origin: 'RULE', decision: 'SUGGESTED',
    });
    expect(await db.incidentRelationshipEvent.count()).toBe(1);
    expect(await db.correlationMember.count()).toBe(2);
    expect(JSON.stringify(links[0].evidence)).not.toMatch(/Database/i); // numeric/enum evidence only
  });
});

describe('concurrency', () => {
  it('produces exactly one group and one anchor when many workers process the same problem at once', async () => {
    await configure('SUGGEST');
    const service = await createTestService('Checkout');
    const incidents = [];
    for (let i = 0; i < 8; i += 1) incidents.push(await incident('Database errors', service.id, at(i)));
    await Promise.all(incidents.map(i => correlate(i.id)));

    expect(await db.correlationGroup.count()).toBe(1);
    const group = await db.correlationGroup.findFirstOrThrow();
    expect(group.anchorIncidentId).toBeTruthy();
    expect(await db.correlationMember.count({ where: { role: 'ANCHOR' } })).toBe(1);
    expect(await db.correlationMember.count({ where: { role: 'MEMBER' } })).toBe(7);
    expect(await db.incidentRelationship.count()).toBe(7);
    // Every link points at the single anchor.
    expect(new Set((await db.incidentRelationship.findMany()).map(r => r.targetIncidentId))).toEqual(new Set([group.anchorIncidentId]));
  });
});

describe('safety rules', () => {
  it('never groups highest-urgency (page-immediately) incidents', async () => {
    await configure('SUGGEST');
    const service = await createTestService('Checkout');
    const a = await incident('Database errors', service.id, at(0), 'HIGH');
    const b = await incident('Database errors', service.id, at(10), 'HIGH');
    expect(await correlate(a.id)).toMatchObject({ outcome: 'skipped_critical' });
    expect(await correlate(b.id)).toMatchObject({ outcome: 'skipped_critical' });
    expect(await db.correlationGroup.count()).toBe(0);
  });

  it('does nothing when intelligence is off, the policy is off, or there are no rules', async () => {
    const service = await createTestService('Checkout');
    const a = await incident('Database errors', service.id, at(0));
    expect(await correlate(a.id)).toMatchObject({ outcome: 'skipped_off' }); // nothing configured

    await configure('SUGGEST', [rule()], false);
    expect(await correlate(a.id)).toMatchObject({ outcome: 'skipped_off' }); // master switch off

    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: true } });
    await configure('SUGGEST', []);
    expect(await correlate(a.id)).toMatchObject({ outcome: 'skipped_no_rules' });
    expect(await db.correlationGroup.count()).toBe(0);
  });

  it('skips disabled rules and handles deleted incidents', async () => {
    await configure('SUGGEST', [rule({ enabled: false })]);
    const service = await createTestService('Checkout');
    const a = await incident('Database errors', service.id, at(0));
    expect(await correlate(a.id)).toMatchObject({ outcome: 'skipped_no_rules' });
    expect(await correlate('missing')).toMatchObject({ outcome: 'incident_gone' });
  });

  it('retries (does not drop) an incident whose fingerprint is not ready', async () => {
    await configure('SUGGEST');
    const service = await createTestService('Checkout');
    const raw = await createTestIncident('Not indexed', service.id, { urgency: 'LOW' });
    await expect(correlate(raw.id)).rejects.toThrow(/not ready/);
  });
});

describe('scope and windows', () => {
  it('keeps groups within one service and separates different problems', async () => {
    await configure('SHADOW');
    const checkout = await createTestService('Checkout');
    const billing = await createTestService('Billing');
    const a = await incident('Database errors', checkout.id, at(0));
    const b = await incident('Database errors', billing.id, at(10));
    const c = await incident('Disk space low', checkout.id, at(20));
    for (const i of [a, b, c]) await correlate(i.id);
    expect(await db.correlationGroup.count()).toBe(3);
  });

  it('starts a new group after the window and slides the window while incidents keep arriving', async () => {
    await configure('SHADOW', [rule({ windowSeconds: 60, maxWindowSeconds: 600 })]);
    const service = await createTestService('Checkout');
    const first = await incident('Database errors', service.id, at(0));
    const stillIn = await incident('Database errors', service.id, at(50)); // extends the window to +110s
    const slid = await incident('Database errors', service.id, at(100)); // only reachable because it slid
    const later = await incident('Database errors', service.id, at(500));
    for (const i of [first, stillIn, slid, later]) await correlate(i.id);

    const groups = await db.correlationGroup.findMany({ orderBy: { windowStart: 'asc' } });
    expect(groups).toHaveLength(2);
    const members = await db.correlationMember.findMany();
    const groupOf = (id: string) => members.find(m => m.incidentId === id)!.groupId;
    expect(groupOf(first.id)).toBe(groupOf(stillIn.id));
    expect(groupOf(first.id)).toBe(groupOf(slid.id));
    expect(groupOf(later.id)).not.toBe(groupOf(first.id));
  });

  it('never extends a window beyond its hard ceiling', async () => {
    await configure('SHADOW', [rule({ windowSeconds: 60, maxWindowSeconds: 120 })]);
    const service = await createTestService('Checkout');
    for (const s of [0, 55, 110, 165]) await correlate((await incident('Database errors', service.id, at(s))).id);
    const groups = await db.correlationGroup.findMany();
    for (const g of groups) expect(g.windowEnd.getTime()).toBeLessThanOrEqual(g.maxWindowEnd.getTime());
    expect(groups.length).toBeGreaterThan(1);
  });

  it('keeps old groups intact when the policy changes: a new version is a new identity space', async () => {
    await configure('SHADOW');
    const service = await createTestService('Checkout');
    const a = await incident('Database errors', service.id, at(0));
    const b = await incident('Database errors', service.id, at(10));
    await correlate(a.id);
    await configure('SHADOW'); // publishes version 2
    await correlate(b.id);
    const groups = await db.correlationGroup.findMany({ orderBy: { policyVersion: 'asc' } });
    expect(groups.map(g => g.policyVersion)).toEqual([1, 2]);
    expect(groups[0].anchorIncidentId).toBe(a.id);
    expect(groups[1].anchorIncidentId).toBe(b.id);
  });

  it('closes expired groups without touching membership', async () => {
    await configure('SHADOW');
    const service = await createTestService('Checkout');
    await correlate((await incident('Database errors', service.id, at(0))).id);
    const closed = await db.$transaction(tx => closeExpiredGroups(tx, new Date('2030-01-01T00:00:00Z'), 100));
    expect(closed).toBe(1);
    expect((await db.correlationGroup.findFirstOrThrow()).status).toBe('CLOSED');
    expect(await db.correlationMember.count()).toBe(1);
    expect(await db.$transaction(tx => closeExpiredGroups(tx, new Date('2030-01-01T00:00:00Z'), 100))).toBe(0);
  });

  it('creates one group per matching rule', async () => {
    await configure('SHADOW', [rule(), rule({ id: 'by-service', kind: 'EXACT_FIELD', keys: ['service'] })]);
    const service = await createTestService('Checkout');
    const a = await incident('Database errors', service.id, at(0));
    await correlate(a.id);
    expect(await db.correlationGroup.count()).toBe(2); // one group per matching rule
    expect(await db.correlationMember.count()).toBe(2);
  });
});

describe('chaining through the lane', () => {
  it('chains correlation only when the effective policy has rules', async () => {
    const service = await createTestService('Checkout');
    await configure('SHADOW', []);
    const quiet = await createTestIncident('Quiet', service.id, { urgency: 'LOW' });
    await db.$transaction(tx => indexIncident(quiet.id, tx));
    expect(await shouldCorrelate(quiet.id)).toBe(false);

    await configure('SHADOW', [rule()]);
    expect(await shouldCorrelate(quiet.id)).toBe(true);
    expect(await shouldCorrelate('missing')).toBe(false);
  });

  it('correlates new incidents end to end', async () => {
    await configure('SUGGEST');
    const service = await createTestService('Checkout');
    const state = createLaneState();
    let clock = Date.now();
    const deps = { getCriticalLagMs: async () => 0, now: () => clock };
    await runIntelligenceCycle(state, deps); // initialise the discovery cursor
    const a = await createTestIncident('Database errors on db-1', service.id, { urgency: 'LOW' });
    const b = await createTestIncident('Database errors on db-2', service.id, { urgency: 'LOW' });
    clock = Date.now() + 40_000;
    // Drain rather than assume a cycle count: under load an item may legitimately retry once.
    for (let i = 0; i < 20; i += 1) {
      await runIntelligenceCycle(state, deps);
      if ((await db.intelligenceWorkItem.count()) === 0 && i >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    expect(await db.correlationGroup.count()).toBe(1);
    expect(await db.correlationMember.count()).toBe(2);
    expect(await db.incidentRelationship.count()).toBe(1);
    expect(a.id).not.toBe(b.id);
    expect(await db.intelligenceWorkItem.count()).toBe(0);
  });
});
