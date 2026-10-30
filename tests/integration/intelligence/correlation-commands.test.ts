import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { decideRelationship, linkIncidents } from '@/lib/intelligence/correlation/commands';
import { getRelatedIncidentsForActor } from '@/lib/intelligence/correlation/view';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { createTestIncident, createTestService, createTestTeam, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function actorFor(role: 'ADMIN' | 'RESPONDER' | 'USER' | 'AUDITOR', teamId?: string) {
  const user = await createTestUser({ role });
  if (teamId) await db.teamMember.create({ data: { userId: user.id, teamId, role: 'MEMBER' } });
  const actor = await resolveUserActor(user.id);
  if (!actor) throw new Error('actor');
  return actor;
}

async function mode(next: 'SHADOW' | 'SUGGEST') {
  const admin = await createTestUser({ role: 'ADMIN' });
  const head = (await db.intelligencePolicy.findUnique({ where: { scopeKey: 'global' } }))?.headVersion ?? 0;
  await publishPolicyVersion({}, { mode: next, definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: head }, { actorId: admin.id, source: 'UI' });
  await db.intelligenceSettings.upsert({
    where: { id: 'default' },
    update: { enabled: true },
    create: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
}

async function pair(teamId?: string, otherTeamId?: string) {
  const service = await createTestService('Svc', teamId);
  const otherService = otherTeamId ? await createTestService('Other', otherTeamId) : service;
  const a = await createTestIncident('Incident A', service.id, { ...(teamId ? { teamId } : {}) });
  const b = await createTestIncident('Incident B', otherService.id, { ...(otherTeamId ? { teamId: otherTeamId } : teamId ? { teamId } : {}) });
  return { a, b, service };
}

async function suggestion(sourceId: string, targetId: string, decision: 'SHADOW' | 'SUGGESTED' | 'ACCEPTED' | 'REJECTED' | 'REVERTED' = 'SUGGESTED') {
  return db.incidentRelationship.create({
    data: { sourceIncidentId: sourceId, targetIncidentId: targetId, type: 'RELATED', origin: 'RULE', decision, evidence: { ruleId: 'same-problem' }, engineVersion: 't' },
  });
}

describe('deciding on a suggested link', () => {
  it('accepts, records an event with the actor, and is idempotent', async () => {
    const { a, b } = await pair();
    const link = await suggestion(b.id, a.id);
    const actor = await actorFor('RESPONDER');
    expect(await decideRelationship(actor, { relationshipId: link.id, decision: 'ACCEPTED', note: ' looks right\n' })).toEqual({
      relationshipId: link.id, decision: 'ACCEPTED', changed: true,
    });
    expect((await db.incidentRelationship.findUniqueOrThrow({ where: { id: link.id } })).decision).toBe('ACCEPTED');
    const events = await db.incidentRelationshipEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromDecision: 'SUGGESTED', toDecision: 'ACCEPTED', actorType: 'USER', actorId: actor.id, reasonCode: 'HUMAN_ACCEPTED', note: 'looks right' });

    expect((await decideRelationship(actor, { relationshipId: link.id, decision: 'ACCEPTED' })).changed).toBe(false);
    expect(await db.incidentRelationshipEvent.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'intelligence.relationship.decided' } })).toBe(1);
  });

  it('keeps full history across reject, revert and re-accept', async () => {
    const { a, b } = await pair();
    const link = await suggestion(b.id, a.id);
    const actor = await actorFor('RESPONDER');
    for (const decision of ['REJECTED', 'REVERTED', 'ACCEPTED'] as const) {
      await decideRelationship(actor, { relationshipId: link.id, decision });
    }
    const events = await db.incidentRelationshipEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map(e => [e.fromDecision, e.toDecision])).toEqual([['SUGGESTED', 'REJECTED'], ['REJECTED', 'REVERTED'], ['REVERTED', 'ACCEPTED']]);
  });

  it('cannot decide shadow-only suggestions, unknown ids, or without the capability', async () => {
    const { a, b } = await pair();
    const shadow = await suggestion(b.id, a.id, 'SHADOW');
    const responder = await actorFor('RESPONDER');
    await expect(decideRelationship(responder, { relationshipId: shadow.id, decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(decideRelationship(responder, { relationshipId: 'missing', decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const live = await suggestion(a.id, b.id);
    await expect(decideRelationship(await actorFor('AUDITOR'), { relationshipId: live.id, decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(decideRelationship({ ...responder, status: 'DISABLED' }, { relationshipId: live.id, decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(decideRelationship(responder, { relationshipId: live.id, decision: 'SHADOW' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('reports a link as not found when the actor cannot read both incidents', async () => {
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const { a, b } = await pair(teamA.id, teamB.id);
    const link = await suggestion(a.id, b.id);
    const member = await actorFor('USER', teamA.id);
    await expect(decideRelationship(member, { relationshipId: link.id, decision: 'ACCEPTED' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect((await db.incidentRelationship.findUniqueOrThrow({ where: { id: link.id } })).decision).toBe('SUGGESTED');
  });
});

describe('linking by hand', () => {
  it('creates one symmetric human link in canonical order', async () => {
    const { a, b } = await pair();
    const actor = await actorFor('RESPONDER');
    const first = await linkIncidents(actor, { incidentId: a.id, otherIncidentId: b.id });
    const again = await linkIncidents(actor, { incidentId: b.id, otherIncidentId: a.id });
    expect(first.changed).toBe(true);
    expect(again).toMatchObject({ relationshipId: first.relationshipId, changed: false });
    const links = await db.incidentRelationship.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ origin: 'HUMAN', decision: 'ACCEPTED', sourceIncidentId: [a.id, b.id].sort()[0] });
  });

  it('turns an existing suggestion (either direction) into an accepted link and re-links a withdrawn one', async () => {
    const { a, b } = await pair();
    const actor = await actorFor('RESPONDER');
    const link = await suggestion(b.id, a.id, 'REVERTED');
    const result = await linkIncidents(actor, { incidentId: a.id, otherIncidentId: b.id });
    expect(result).toMatchObject({ relationshipId: link.id, changed: true });
    expect(await db.incidentRelationship.count()).toBe(1);
  });

  it('serialises concurrent links into a single row', async () => {
    const { a, b } = await pair();
    const actor = await actorFor('RESPONDER');
    await Promise.all(Array.from({ length: 5 }, () => linkIncidents(actor, { incidentId: a.id, otherIncidentId: b.id })));
    expect(await db.incidentRelationship.count()).toBe(1);
  });

  it('rejects self-links and links to incidents the actor cannot read', async () => {
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const { a, b } = await pair(teamA.id, teamB.id);
    const member = await actorFor('USER', teamA.id);
    await expect(linkIncidents(member, { incidentId: a.id, otherIncidentId: a.id })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(linkIncidents(member, { incidentId: a.id, otherIncidentId: b.id })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(await db.incidentRelationship.count()).toBe(0);
  });
});

describe('related incidents as seen by a viewer', () => {
  it('shows suggested and accepted links in SUGGEST mode, from either end, with the rule that made them', async () => {
    await mode('SUGGEST');
    const { a, b, service } = await pair();
    const c = await createTestIncident('Incident C', service.id);
    await suggestion(b.id, a.id);
    await suggestion(a.id, c.id, 'ACCEPTED');
    const admin = await actorFor('ADMIN');
    const view = await getRelatedIncidentsForActor(a.id, admin);
    expect(view!.map(v => [v.incidentId, v.decision, v.ruleId]).sort()).toEqual(
      [[b.id, 'SUGGESTED', 'same-problem'], [c.id, 'ACCEPTED', 'same-problem']].sort()
    );
    expect((await getRelatedIncidentsForActor(b.id, admin))![0]).toMatchObject({ incidentId: a.id, decision: 'SUGGESTED' });
  });

  it('hides rejected, reverted and shadow links', async () => {
    await mode('SUGGEST');
    const { a, b, service } = await pair();
    const c = await createTestIncident('C', service.id);
    const d = await createTestIncident('D', service.id);
    await suggestion(b.id, a.id, 'REJECTED');
    await suggestion(c.id, a.id, 'REVERTED');
    await suggestion(d.id, a.id, 'SHADOW');
    expect(await getRelatedIncidentsForActor(a.id, await actorFor('ADMIN'))).toBeNull();
  });

  it('in SHADOW mode shows only links a person made', async () => {
    await mode('SHADOW');
    const { a, b, service } = await pair();
    const c = await createTestIncident('C', service.id);
    await suggestion(b.id, a.id);
    const actor = await actorFor('RESPONDER');
    expect(await getRelatedIncidentsForActor(a.id, actor)).toBeNull();
    await linkIncidents(actor, { incidentId: a.id, otherIncidentId: c.id });
    expect((await getRelatedIncidentsForActor(a.id, actor))!.map(v => v.incidentId)).toEqual([c.id]);
  });

  it('drops links whose other end the viewer cannot read, without a trace', async () => {
    await mode('SUGGEST');
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const serviceA = await createTestService('SA', teamA.id);
    const serviceB = await createTestService('SB', teamB.id);
    const mine = await createTestIncident('Mine', serviceA.id, { teamId: teamA.id });
    const alsoMine = await createTestIncident('Also mine', serviceA.id, { teamId: teamA.id });
    const secret = await createTestIncident('Secret customer outage', serviceB.id, { teamId: teamB.id });
    await suggestion(alsoMine.id, mine.id);
    await suggestion(secret.id, mine.id);

    const member = await actorFor('USER', teamA.id);
    const view = await getRelatedIncidentsForActor(mine.id, member);
    expect(view!.map(v => v.incidentId)).toEqual([alsoMine.id]);
    expect(JSON.stringify(view)).not.toMatch(/Secret|SB/);
    const admin = await getRelatedIncidentsForActor(mine.id, await actorFor('ADMIN'));
    expect(admin).toHaveLength(2);
  });

  it('returns nothing when the viewer cannot see the incident or intelligence is off', async () => {
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const { a, b } = await pair(teamA.id, teamB.id);
    await suggestion(b.id, a.id);
    const outsider = await actorFor('USER', teamB.id);
    await mode('SUGGEST');
    expect(await getRelatedIncidentsForActor(a.id, outsider)).toBeNull();
    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
    expect(await getRelatedIncidentsForActor(a.id, await actorFor('ADMIN'))).toBeNull();
  });
});
