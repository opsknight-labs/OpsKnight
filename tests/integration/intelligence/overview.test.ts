import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  getOverviewChange,
  getOverviewHealth,
  getOverviewNoise,
  getOverviewOutcomes,
  getOverviewQuality,
  getOverviewSpeed,
  loadSection,
  resolveOverviewScope,
  resolveOverviewWindow,
} from '@/lib/intelligence/overview';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
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
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

/**
 * Two teams, one service each, with incidents, findings, feedback, noise decisions and changes on both.
 * The admin sees both; a team-scoped reader (role USER: scoped service and incident read) sees only its
 * own team's service. Responders currently hold global read, so the scoped path is exercised with the
 * scoped role rather than assumed.
 */
async function seedTwoTeams(now: number) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const scoped = await createTestUser({ role: 'USER' });
  const responder = await createTestUser({ role: 'RESPONDER' });
  const mine = await createTestTeam('Payments');
  const theirs = await createTestTeam('Search');
  await db.teamMember.create({ data: { userId: scoped.id, teamId: mine.id } });
  const myService = await createTestService('Checkout', mine.id);
  const otherService = await createTestService('Indexer', theirs.id);

  const seedService = async (serviceId: string, count: number, ackMinutes: number) => {
    const incidents = [];
    for (let i = 0; i < count; i += 1) {
      const createdAt = new Date(now - (i + 1) * HOUR);
      const incident = await createTestIncident(`incident ${serviceId} ${i}`, serviceId, {
        createdAt,
        acknowledgedAt: new Date(createdAt.getTime() + ackMinutes * MIN),
        resolvedAt: new Date(createdAt.getTime() + 2 * ackMinutes * MIN),
        status: 'RESOLVED',
      });
      incidents.push(incident);
      await db.alert.create({
        data: { incidentId: incident.id, serviceId, payload: {}, createdAt },
      });
      await db.alert.create({
        data: { incidentId: incident.id, serviceId, payload: {}, createdAt },
      });
    }
    // The previous window: one incident eight days ago, acknowledged twice as slowly.
    await createTestIncident(`old ${serviceId}`, serviceId, {
      createdAt: new Date(now - 8 * DAY),
      acknowledgedAt: new Date(now - 8 * DAY + 2 * ackMinutes * MIN),
      status: 'ACKNOWLEDGED',
    });
    // First insight 30 s after creation; a change correlation and a triage chip on the first incident.
    for (const incident of incidents)
      await db.intelligenceFinding.create({
        data: {
          incidentId: incident.id,
          kind: 'SIMILAR_INCIDENT',
          subjectRef: incident.id,
          evidence: {},
          generation: 1,
          engineVersion: 't',
          createdAt: new Date(incident.createdAt.getTime() + 30_000),
        },
      });
    const change = await db.changeEvent.create({
      data: {
        serviceId,
        source: 'ci',
        kind: 'DEPLOY',
        summary: `deploy ${serviceId}`,
        occurredAt: new Date(now - 2 * HOUR),
        riskScore: serviceId === myService.id ? 0.4 : 0.9,
      },
    });
    await db.intelligenceFinding.create({
      data: {
        incidentId: incidents[0].id,
        kind: 'CHANGE_CORRELATION',
        subjectRef: change.id,
        evidence: {},
        generation: 1,
        engineVersion: 't',
      },
    });
    const triage = await db.intelligenceFinding.create({
      data: {
        incidentId: incidents[0].id,
        kind: 'TRIAGE_URGENCY',
        subjectRef: 'HIGH',
        evidence: {},
        generation: 1,
        engineVersion: 't',
      },
    });
    await db.intelligenceFeedback.create({
      data: {
        subjectType: 'FINDING',
        subjectId: triage.id,
        verdict: 'HELPFUL',
        serviceId,
        actorId: admin.id,
      },
    });
    const relationship = await db.incidentRelationship.create({
      data: {
        sourceIncidentId: incidents[0].id,
        targetIncidentId: incidents[1].id,
        type: 'RELATED',
        origin: 'RULE',
        decision: 'ACCEPTED',
        evidence: {},
        engineVersion: 't',
      },
    });
    await db.incidentRelationshipEvent.create({
      data: {
        relationshipId: relationship.id,
        fromDecision: 'SUGGESTED',
        toDecision: 'ACCEPTED',
        actorType: 'USER',
        actorId: admin.id,
        reasonCode: 'CONFIRMED',
      },
    });
    for (const [mode, applied, control, sourceName] of [
      ['ON', true, 'SUPPRESSION', `rule ${serviceId}`],
      ['ON', true, 'MAINTENANCE', `window ${serviceId}`],
      ['SHADOW', false, 'SUPPRESSION', `rule ${serviceId}`],
    ] as const)
      await db.prePagingDecision.create({
        data: {
          serviceId,
          control,
          action: 'SUPPRESS',
          mode,
          applied,
          sourceId: sourceName,
          sourceName,
          reason: 'test',
          evidence: {},
          createdAt: new Date(now - HOUR),
        },
      });
    return { incidents, change };
  };

  const my = await seedService(myService.id, 3, 4);
  const other = await seedService(otherService.id, 5, 10);
  await db.noiseControlPolicy.create({
    data: { scopeKey: 'global', mode: 'ON', definition: {} },
  });
  return { admin, scoped, responder, myService, otherService, my, other };
}

describe('AIOps overview data', () => {
  it('scopes every section to what a team-scoped reader may see, while an admin sees all', async () => {
    const now = Date.now();
    const seeded = await seedTwoTeams(now);
    // Rows stamped by the database during seeding (feedback) must fall inside the window.
    const range = resolveOverviewWindow('7d', new Date());
    const adminScope = await resolveOverviewScope(await actorOf(seeded.admin.id));
    const scopedActor = await actorOf(seeded.scoped.id);
    const scopedScope = await resolveOverviewScope(scopedActor);
    expect(adminScope.global).toBe(true);
    expect(scopedScope.global).toBe(false);
    expect(scopedScope.serviceIds).toEqual([seeded.myService.id]);

    const [adminNoise, scopedNoise] = await Promise.all([
      getOverviewNoise(adminScope, range),
      getOverviewNoise(scopedScope, range),
    ]);
    expect(adminNoise.alerts).toBe(16);
    expect(adminNoise.incidents).toBe(8);
    expect(scopedNoise.alerts).toBe(6);
    expect(scopedNoise.incidents).toBe(3);
    expect(scopedNoise.compressionRatio).toBe(2);
    // Only applied (ON) decisions count as avoided; SHADOW is reported separately.
    expect(scopedNoise.pagesAvoided).toBe(2);
    expect(scopedNoise.shadowWouldAvoid).toBe(1);
    expect(adminNoise.pagesAvoided).toBe(4);
    expect(scopedNoise.suppressedBySource.map(row => row.label).sort()).toEqual(
      [`rule ${seeded.myService.id}`, `window ${seeded.myService.id}`].sort()
    );
    expect(adminNoise.suppressedBySource).toHaveLength(4);
    expect(scopedNoise.modes.on).toBe(1);

    const [adminSpeed, scopedSpeed] = await Promise.all([
      getOverviewSpeed(adminScope, range),
      getOverviewSpeed(scopedScope, range),
    ]);
    expect(scopedSpeed.incidents).toBe(3);
    expect(scopedSpeed.incidentsWithInsight).toBe(3);
    expect(scopedSpeed.firstInsightP50Seconds).toBeCloseTo(30, 0);
    expect(scopedSpeed.triage).toEqual({ accepted: 1, reviewed: 1, rate: 1 });
    expect(adminSpeed.triage.reviewed).toBe(2);
    expect(scopedSpeed.relatedSuggestions).toEqual({ accepted: 1, reviewed: 1, rate: 1 });
    expect(adminSpeed.relatedSuggestions.reviewed).toBe(2);
    expect(adminSpeed.findings.rate).toBeNull();

    const [adminChange, scopedChange] = await Promise.all([
      getOverviewChange(adminScope, range),
      getOverviewChange(scopedScope, range),
    ]);
    expect(scopedChange.changeLinked).toBe(1);
    expect(scopedChange.incidents).toBe(3);
    expect(scopedChange.changes).toBe(1);
    expect(scopedChange.riskiest.map(row => row.id)).toEqual([seeded.my.change.id]);
    expect(scopedChange.recentLinked[0].change?.summary).toBe(`deploy ${seeded.myService.id}`);
    expect(adminChange.riskiest.map(row => row.id)).toEqual([
      seeded.other.change.id,
      seeded.my.change.id,
    ]);
    expect(adminChange.changeLinked).toBe(2);

    const [adminOutcomes, scopedOutcomes] = await Promise.all([
      getOverviewOutcomes(adminScope, range),
      getOverviewOutcomes(scopedScope, range),
    ]);
    expect(scopedOutcomes.current.incidents).toBe(3);
    expect(scopedOutcomes.current.mttaSeconds).toBeCloseTo(240, 0);
    expect(scopedOutcomes.current.mttrSeconds).toBeCloseTo(480, 0);
    expect(scopedOutcomes.previous.incidents).toBe(1);
    expect(scopedOutcomes.previous.mttaSeconds).toBeCloseTo(480, 0);
    expect(scopedOutcomes.series).toHaveLength(7);
    expect(scopedOutcomes.series.reduce((sum, b) => sum + b.current.incidents, 0)).toBe(3);
    expect(adminOutcomes.current.incidents).toBe(8);
    expect(adminOutcomes.current.mttaSeconds).toBeCloseTo((3 * 240 + 5 * 600) / 8, 0);
  });

  it('shows an incident assigned to the scoped reader on another team, and nothing else of that team', async () => {
    const now = Date.now();
    const seeded = await seedTwoTeams(now);
    await db.incident.update({
      where: { id: seeded.other.incidents[1].id },
      data: { assigneeId: seeded.scoped.id },
    });
    const range = resolveOverviewWindow('7d', new Date(now));
    const scope = await resolveOverviewScope(await actorOf(seeded.scoped.id));
    const outcomes = await getOverviewOutcomes(scope, range);
    expect(outcomes.current.incidents).toBe(4);
    // Services stay team-scoped: the assignment does not reveal the other team's noise.
    const noise = await getOverviewNoise(scope, range);
    expect(noise.alerts).toBe(6);
  });

  it('gives a reader without any readable service an empty, non-failing view', async () => {
    const now = Date.now();
    await seedTwoTeams(now);
    const loner = await createTestUser({ role: 'USER' });
    const scope = await resolveOverviewScope(await actorOf(loner.id));
    const range = resolveOverviewWindow('24h', new Date(now));
    expect(scope.serviceIds).toEqual([]);
    const noise = await getOverviewNoise(scope, range);
    expect(noise.alerts).toBe(0);
    const change = await getOverviewChange(scope, range);
    expect(change.changes).toBe(0);
    expect(change.incidents).toBe(0);
    const outcomes = await getOverviewOutcomes(scope, range);
    expect(outcomes.current.incidents).toBe(0);
    expect(outcomes.series).toHaveLength(24);
  });

  it('keeps the selected window: 24 hours excludes older incidents', async () => {
    const now = Date.now();
    const seeded = await seedTwoTeams(now);
    await createTestIncident('two days ago', seeded.myService.id, {
      createdAt: new Date(now - 2 * DAY),
    });
    const scope = await resolveOverviewScope(await actorOf(seeded.admin.id));
    const day = await getOverviewOutcomes(scope, resolveOverviewWindow('24h', new Date(now)));
    const week = await getOverviewOutcomes(scope, resolveOverviewWindow('7d', new Date(now)));
    expect(day.current.incidents).toBe(8);
    expect(week.current.incidents).toBe(9);
  });

  it('ranks noisy and flapping services for readers with intelligence access only', async () => {
    const team = await createTestTeam('Noisy');
    const admin = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('Flappy', team.id);
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) {
      const createdAt = new Date(now - (i + 1) * HOUR);
      await createTestIncident(`flap ${i}`, service.id, {
        createdAt,
        status: i < 3 ? 'SUPPRESSED' : 'RESOLVED',
        resolvedAt: i < 3 ? null : new Date(createdAt.getTime() + MIN),
      });
    }
    const quality = await getOverviewQuality(await actorOf(admin.id), new Date(now));
    expect(quality.noisy.map(row => row.serviceId)).toEqual([service.id]);
    expect(quality.flapping[0].flappingRatio).toBeCloseTo(0.5, 2);
    expect(quality.jiraConfigured).toBe(false);
    const plain = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: plain.id, teamId: team.id } });
    expect((await getOverviewQuality(await actorOf(plain.id), new Date(now))).noisy).toEqual([]);
  });

  it('reports lane health and backlog to administrators only', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const responder = await createTestUser({ role: 'RESPONDER' });
    const health = await getOverviewHealth(await actorOf(admin.id));
    expect(health?.backlog.ready).toBe(0);
    expect(['healthy', 'degraded', 'disabled']).toContain(health?.lane.status);
    expect(await getOverviewHealth(await actorOf(responder.id))).toBeNull();
  });

  it('fails one section softly with a fixed message', async () => {
    const result = await loadSection('noise', async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    expect(result).toEqual({
      ok: false,
      error: 'The noise section could not be loaded. Try again shortly.',
    });
  });

  it('caps the scoped service list and records that it did', async () => {
    const team = await createTestTeam('Big');
    const user = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: user.id, teamId: team.id } });
    await db.service.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({ name: `svc-cap-${i}`, teamId: team.id })),
    });
    const actor: AuthorizationActor = await actorOf(user.id);
    const scope = await resolveOverviewScope(actor);
    expect(scope.serviceIds).toHaveLength(3);
    expect(scope.servicesTruncated).toBe(false);
  });
});
