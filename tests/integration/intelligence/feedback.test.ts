import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { FEEDBACK_RATE_LIMIT } from '@/lib/intelligence/feedback/schema';
import {
  getMyFeedback,
  revokeFeedback,
  submitFeedback,
  summarizeFeedback,
} from '@/lib/intelligence/feedback/service';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
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

async function actorFor(role: 'ADMIN' | 'RESPONDER' | 'USER' | 'AUDITOR', teamId?: string) {
  const user = await createTestUser({ role });
  if (teamId) await db.teamMember.create({ data: { userId: user.id, teamId, role: 'MEMBER' } });
  const actor = await resolveUserActor(user.id);
  if (!actor) throw new Error('actor');
  return actor;
}

async function finding(incidentId: string, subjectRef: string | null) {
  return db.intelligenceFinding.create({
    data: { incidentId, kind: 'SIMILAR_INCIDENT', subjectRef, evidence: {}, generation: 1, engineVersion: 't' },
  });
}

async function world() {
  const team = await createTestTeam('Team A');
  const service = await createTestService('Svc', team.id);
  const a = await createTestIncident('Incident A', service.id, { teamId: team.id });
  const b = await createTestIncident('Incident B', service.id, { teamId: team.id });
  return { team, service, a, b, f: await finding(a.id, b.id) };
}

describe('submitting feedback', () => {
  it('records a verdict with the service and audits it without the note', async () => {
    const { service, f } = await world();
    const responder = await actorFor('RESPONDER');
    const result = await submitFeedback(responder, {
      subjectType: 'FINDING', subjectId: f.id, verdict: 'NOT_HELPFUL', reasonCode: 'UNRELATED', note: 'private note',
    });
    expect(result).toEqual({ verdict: 'NOT_HELPFUL', replaced: false });
    expect(await db.intelligenceFeedback.findFirstOrThrow()).toMatchObject({
      subjectId: f.id, verdict: 'NOT_HELPFUL', reasonCode: 'UNRELATED', note: 'private note',
      serviceId: service.id, actorId: responder.id,
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'intelligence.feedback.submitted' } });
    expect(JSON.stringify(audit)).not.toContain('private note');
  });

  it('keeps one live verdict per person: a new one replaces the old', async () => {
    const { f } = await world();
    const responder = await actorFor('RESPONDER');
    await submitFeedback(responder, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' });
    const second = await submitFeedback(responder, { subjectType: 'FINDING', subjectId: f.id, verdict: 'NOT_HELPFUL' });
    expect(second.replaced).toBe(true);
    const rows = await db.intelligenceFeedback.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('NOT_HELPFUL');
  });

  it('counts different people separately', async () => {
    const { f } = await world();
    for (const verdict of ['HELPFUL', 'HELPFUL', 'NOT_HELPFUL'] as const) {
      await submitFeedback(await actorFor('RESPONDER'), { subjectType: 'FINDING', subjectId: f.id, verdict });
    }
    expect(await summarizeFeedback({ subjectType: 'FINDING' })).toEqual({ total: 3, positive: 2, negative: 1, positiveRate: 2 / 3 });
  });

  it('serialises concurrent submissions from the same person into one row', async () => {
    const { f } = await world();
    const responder = await actorFor('RESPONDER');
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        submitFeedback(responder, { subjectType: 'FINDING', subjectId: f.id, verdict: i % 2 ? 'HELPFUL' : 'NOT_HELPFUL' })
      )
    );
    expect(await db.intelligenceFeedback.count()).toBe(1);
  });

  it('rejects roles without the capability and inactive accounts', async () => {
    const { f } = await world();
    const input = { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' };
    await expect(submitFeedback(await actorFor('AUDITOR'), input)).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    const responder = await actorFor('RESPONDER');
    await expect(submitFeedback({ ...responder, status: 'DISABLED' }, input)).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(await db.intelligenceFeedback.count()).toBe(0);
  });

  it('validates input and subject/verdict pairing', async () => {
    const { f } = await world();
    const responder = await actorFor('RESPONDER');
    await expect(submitFeedback(responder, { subjectType: 'FINDING', subjectId: f.id, verdict: 'CORRECT' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(submitFeedback(responder, { nonsense: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('reports unknown subjects as not found', async () => {
    const responder = await actorFor('RESPONDER');
    await expect(
      submitFeedback(responder, { subjectType: 'FINDING', subjectId: 'missing', verdict: 'HELPFUL' })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('applies a per-person hourly rate limit', async () => {
    const { f } = await world();
    const responder = await actorFor('RESPONDER');
    await db.rateLimit.create({
      data: {
        key: `intelligence-feedback:${responder.id}:${Math.floor(Date.now() / FEEDBACK_RATE_LIMIT.windowMs)}`,
        count: FEEDBACK_RATE_LIMIT.limit,
        expiresAt: new Date(Date.now() + FEEDBACK_RATE_LIMIT.windowMs),
      },
    });
    await expect(
      submitFeedback(responder, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    expect(await db.intelligenceFeedback.count()).toBe(0);
  });
});

describe('feedback and incident visibility', () => {
  it('hides subjects a scoped user cannot read, as "not found" rather than forbidden', async () => {
    const { f } = await world();
    const otherTeam = await createTestTeam('Other');
    const outsider = await actorFor('USER', otherTeam.id);
    expect(outsider.role).toBe('USER');
    await expect(
      submitFeedback(outsider, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(await db.intelligenceFeedback.count()).toBe(0);
  });

  it('lets a scoped user rate suggestions about incidents in their own team', async () => {
    const { team, f } = await world();
    const member = await actorFor('USER', team.id);
    await expect(
      submitFeedback(member, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' })
    ).resolves.toMatchObject({ verdict: 'HELPFUL' });
  });

  it('requires access to the referenced precedent too, so ratings cannot probe other teams', async () => {
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const serviceA = await createTestService('SA', teamA.id);
    const serviceB = await createTestService('SB', teamB.id);
    const mine = await createTestIncident('Mine', serviceA.id, { teamId: teamA.id });
    const secret = await createTestIncident('Secret', serviceB.id, { teamId: teamB.id });
    const f = await finding(mine.id, secret.id);

    const member = await actorFor('USER', teamA.id);
    await expect(
      submitFeedback(member, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(await db.intelligenceFeedback.count()).toBe(0);
  });

  it('validates relationship subjects against both incidents', async () => {
    const { a, b, team } = await world();
    const relationship = await db.incidentRelationship.create({
      data: { sourceIncidentId: a.id, targetIncidentId: b.id, type: 'RELATED', origin: 'RULE', evidence: {}, engineVersion: 't' },
    });
    const member = await actorFor('USER', team.id);
    await expect(
      submitFeedback(member, { subjectType: 'INCIDENT_RELATIONSHIP', subjectId: relationship.id, verdict: 'CORRECT' })
    ).resolves.toMatchObject({ verdict: 'CORRECT' });
    const outsider = await actorFor('USER', (await createTestTeam('Z')).id);
    await expect(
      submitFeedback(outsider, { subjectType: 'INCIDENT_RELATIONSHIP', subjectId: relationship.id, verdict: 'CORRECT' })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('revoking and reading back', () => {
  it('lets a person withdraw only their own verdict, idempotently', async () => {
    const { f } = await world();
    const alice = await actorFor('RESPONDER');
    const bob = await actorFor('RESPONDER');
    await submitFeedback(alice, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' });
    await submitFeedback(bob, { subjectType: 'FINDING', subjectId: f.id, verdict: 'NOT_HELPFUL' });

    expect(await revokeFeedback(alice, { subjectType: 'FINDING', subjectId: f.id })).toEqual({ revoked: 1 });
    expect(await revokeFeedback(alice, { subjectType: 'FINDING', subjectId: f.id })).toEqual({ revoked: 0 });
    const left = await db.intelligenceFeedback.findMany();
    expect(left).toHaveLength(1);
    expect(left[0].actorId).toBe(bob.id);
  });

  it('returns the caller\'s own live verdicts for rendering controls', async () => {
    const { f } = await world();
    const alice = await actorFor('RESPONDER');
    const bob = await actorFor('RESPONDER');
    await submitFeedback(alice, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' });
    await submitFeedback(bob, { subjectType: 'FINDING', subjectId: f.id, verdict: 'NOT_HELPFUL' });
    expect([...(await getMyFeedback(alice, 'FINDING', [f.id, 'other'])).entries()]).toEqual([[f.id, 'HELPFUL']]);
    expect((await getMyFeedback(alice, 'FINDING', [])).size).toBe(0);
  });

  it('excludes feedback from deactivated users in summaries', async () => {
    const { f } = await world();
    const alice = await actorFor('RESPONDER');
    const bob = await actorFor('RESPONDER');
    await submitFeedback(alice, { subjectType: 'FINDING', subjectId: f.id, verdict: 'HELPFUL' });
    await submitFeedback(bob, { subjectType: 'FINDING', subjectId: f.id, verdict: 'NOT_HELPFUL' });
    await db.user.update({ where: { id: bob.id }, data: { status: 'DISABLED' } });
    expect(await summarizeFeedback({ subjectType: 'FINDING' })).toMatchObject({ total: 1, positive: 1, positiveRate: 1 });
    expect(await summarizeFeedback({ serviceId: 'none' })).toEqual({ total: 0, positive: 0, negative: 0, positiveRate: null });
  });
});
