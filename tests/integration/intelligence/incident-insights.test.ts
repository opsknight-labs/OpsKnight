import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  buildStripChips,
  insightsSections,
  loadIncidentInsights,
} from '@/lib/intelligence/incident-ux/strip';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/**
 * The incident page's one intelligence read against a real database: what each kind of viewer gets, that
 * the service's mode is respected, that nothing outside the viewer's scope leaks into a chip or a section,
 * and that the read stays bounded.
 */

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

async function enable(mode: 'SHADOW' | 'SUGGEST', enabled = true) {
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada' });
  await publishPolicyVersion(
    {},
    { mode, definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled },
  });
  return admin;
}

/** Counts every database operation issued through the client. */
function countingClient() {
  const ops: string[] = [];
  const client = db.$extends({
    query: {
      async $allOperations({ operation, model, args, query }) {
        ops.push(model ? `${model}.${operation}` : operation);
        return query(args);
      },
    },
  });
  return { client: client as unknown as PrismaClient, ops };
}

/**
 * Team A owns the incident. It has a similar precedent in team A and one in team B, an automatic related
 * link to a team A incident and one to a team B incident, a storm child in each team and a suppression.
 */
async function seed() {
  const teamA = await createTestTeam('A');
  const teamB = await createTestTeam('B');
  const svcA = await createTestService('svc-a', teamA.id);
  const svcB = await createTestService('svc-b', teamB.id);
  const inA = await createTestUser({ role: 'USER', name: 'Sam' });
  const inB = await createTestUser({ role: 'USER', name: 'Bea' });
  const responder = await createTestUser({ role: 'RESPONDER', name: 'Rae' });
  await db.teamMember.create({ data: { userId: inA.id, teamId: teamA.id } });
  await db.teamMember.create({ data: { userId: inB.id, teamId: teamB.id } });

  const incident = await createTestIncident('Checkout pool exhausted', svcA.id);
  const precedentA = await createTestIncident('Checkout pool exhausted last month', svcA.id, {
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  const precedentB = await createTestIncident('Orders pool exhausted (team B)', svcB.id, {
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  const relatedA = await createTestIncident('Cart latency', svcA.id);
  const relatedB = await createTestIncident('Orders latency (team B)', svcB.id);
  const childA = await createTestIncident('Storm child A', svcA.id);
  const childB = await createTestIncident('Storm child B (team B)', svcB.id);

  const finding = {
    incidentId: incident.id,
    generation: 1,
    engineVersion: 'test',
    policyVersion: 1,
  };
  const components = {
    tokens: 0.9,
    template: 0.9,
    labels: 0,
    sameService: 1,
    recency: 0.5,
    resolved: 1,
  };
  await db.intelligenceFinding.createMany({
    data: [precedentA, precedentB].map((precedent, index) => ({
      ...finding,
      kind: 'SIMILAR_INCIDENT' as const,
      rank: index + 1,
      confidence: 0.9 - index * 0.05,
      subjectRef: precedent.id,
      evidence: { type: 'similarity', calibrated: false, tier: 'FTS', components },
    })),
  });
  for (const other of [relatedA, relatedB])
    await db.incidentRelationship.create({
      data: {
        sourceIncidentId: incident.id,
        targetIncidentId: other.id,
        type: 'RELATED',
        origin: 'RULE',
        decision: 'ACCEPTED',
        evidence: { automatic: true, ruleId: 'same-db' },
        engineVersion: 'test',
      },
    });
  for (const child of [childA, childB])
    await db.incidentRelationship.create({
      data: {
        sourceIncidentId: child.id,
        targetIncidentId: incident.id,
        type: 'PARENT_CHILD',
        origin: 'RULE',
        decision: 'ACCEPTED',
        evidence: { automatic: true },
        engineVersion: 'test',
      },
    });
  await db.prePagingDecision.create({
    data: {
      serviceId: svcA.id,
      incidentId: incident.id,
      control: 'SUPPRESSION',
      action: 'SUPPRESS',
      mode: 'ON',
      applied: true,
      sourceName: 'Known noisy probe',
      reason: 'test',
      evidence: {},
    },
  });
  return {
    incident,
    precedentA,
    precedentB,
    relatedA,
    relatedB,
    childA,
    childB,
    inA,
    inB,
    responder,
  };
}

describe('incident insights loader', () => {
  it('gives a responder the strip and every section the data supports', async () => {
    await enable('SUGGEST');
    const world = await seed();
    const insights = await loadIncidentInsights(
      world.incident.id,
      await actorOf(world.responder.id)
    );
    expect(insights).toMatchObject({ mode: 'SUGGEST', canManage: false, canGiveFeedback: true });
    expect(insights!.similar!.map(item => item.incidentId)).toEqual([
      world.precedentA.id,
      world.precedentB.id,
    ]);
    expect(insights!.noise).toEqual([
      { kind: 'suppressed', label: expect.stringContaining('Known noisy probe') },
    ]);
    expect(insights!.group).toMatchObject({ role: 'PARENT' });
    const chips = buildStripChips(insights!);
    expect(chips.map(chip => chip.id)).toEqual(
      expect.arrayContaining(['similar', 'noise-suppressed'])
    );
    expect(chips.find(chip => chip.id === 'similar')!.label).toBe('2 similar');
    expect(insightsSections(insights!)).toEqual(expect.arrayContaining(['similar', 'related']));
  });

  it('scopes every part to the viewer: a team member sees only their own team’s incidents', async () => {
    await enable('SUGGEST');
    const world = await seed();
    const insights = await loadIncidentInsights(world.incident.id, await actorOf(world.inA.id));
    expect(insights).not.toBeNull();
    expect(insights!.similar!.map(item => item.incidentId)).toEqual([world.precedentA.id]);
    expect(insights!.related!.map(item => item.incidentId)).toEqual([world.relatedA.id]);
    const members = insights!.group!.members.flatMap(member =>
      member.kind === 'INCIDENT' ? [member.id] : []
    );
    expect(members).toEqual([world.childA.id]);
    expect(insights!.group!.hiddenMembers).toBe(1);
    // The chip counts only what this viewer may read.
    expect(buildStripChips(insights!).find(chip => chip.id === 'similar')!.label).toBe('1 similar');
    expect(JSON.stringify(insights)).not.toContain('team B');
  });

  it('returns nothing for a viewer who cannot read the incident', async () => {
    await enable('SUGGEST');
    const world = await seed();
    expect(await loadIncidentInsights(world.incident.id, await actorOf(world.inB.id))).toBeNull();
    expect(await loadIncidentInsights('missing', await actorOf(world.responder.id))).toBeNull();
  });

  it('OFF renders nothing for responders; a manager gets only links that can still be undone', async () => {
    const admin = await enable('SUGGEST', false);
    const world = await seed();
    expect(
      await loadIncidentInsights(world.incident.id, await actorOf(world.responder.id))
    ).toBeNull();
    expect(await loadIncidentInsights(world.incident.id, await actorOf(world.inA.id))).toBeNull();

    const insights = await loadIncidentInsights(world.incident.id, await actorOf(admin.id));
    expect(insights).toMatchObject({
      mode: 'OFF',
      canManage: true,
      similar: null,
      triage: null,
      response: null,
      impact: null,
      proactive: null,
      analysis: null,
      noise: [],
    });
    expect(insights!.related!.map(item => item.incidentId).sort()).toEqual(
      [world.relatedA.id, world.relatedB.id].sort()
    );
    expect(buildStripChips(insights!)).toEqual([]);
    expect(insightsSections(insights!)).toEqual(['related']);
  });

  it('SHADOW records but shows no suggestions; links people accepted stay visible', async () => {
    await enable('SHADOW');
    const world = await seed();
    const insights = await loadIncidentInsights(
      world.incident.id,
      await actorOf(world.responder.id)
    );
    expect(insights).toMatchObject({ mode: 'SHADOW', similar: null, triage: null, response: null });
    expect(buildStripChips(insights!).some(chip => chip.id === 'similar')).toBe(false);
    expect(insights!.analysis).toMatchObject({ status: 'SHADOW' });
  });

  it('is quiet for an incident with no intelligence at all', async () => {
    await enable('SUGGEST');
    const service = await createTestService('quiet');
    const responder = await createTestUser({ role: 'RESPONDER' });
    const incident = await createTestIncident('Nothing known', service.id);
    const insights = await loadIncidentInsights(incident.id, await actorOf(responder.id));
    expect(insights).not.toBeNull();
    expect(buildStripChips(insights!)).toEqual([]);
    expect(insightsSections(insights!)).toEqual([]);
  });

  it('stays bounded: a fixed number of queries however much is linked to the incident', async () => {
    await enable('SUGGEST');
    const world = await seed();
    const actor = await actorOf(world.responder.id);
    const small = countingClient();
    await loadIncidentInsights(world.incident.id, actor, { client: small.client });

    const service = await db.incident.findUniqueOrThrow({
      where: { id: world.incident.id },
      select: { serviceId: true },
    });
    for (let index = 0; index < 30; index += 1) {
      const other = await createTestIncident(`More related ${index}`, service.serviceId);
      await db.incidentRelationship.create({
        data: {
          sourceIncidentId: world.incident.id,
          targetIncidentId: other.id,
          type: 'RELATED',
          origin: 'RULE',
          decision: 'ACCEPTED',
          evidence: { automatic: true },
          engineVersion: 'test',
        },
      });
      await db.intelligenceFinding.create({
        data: {
          incidentId: world.incident.id,
          generation: 1,
          engineVersion: 'test',
          policyVersion: 1,
          kind: 'SIMILAR_INCIDENT',
          rank: 10 + index,
          confidence: 0.5,
          subjectRef: other.id,
          evidence: { type: 'similarity' },
        },
      });
    }
    const large = countingClient();
    const insights = await loadIncidentInsights(world.incident.id, actor, { client: large.client });
    expect(large.ops.length).toBe(small.ops.length);
    expect(large.ops.length).toBeLessThanOrEqual(60);
    // Each list is capped by its view, not by how much exists.
    expect(insights!.similar!.length).toBeLessThanOrEqual(5);
    expect(insights!.related!.length).toBeLessThanOrEqual(10);
  });
});
