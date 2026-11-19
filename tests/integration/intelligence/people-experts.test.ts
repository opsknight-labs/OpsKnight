import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { loadIncidentExperts } from '@/lib/intelligence/triage/experts';
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

const DAY = 86_400_000;
const actorOf = async (id: string) => (await resolveUserActor(id))!;

async function fixture(peopleInsightsEnabled = true) {
  const admin = await createTestUser({ role: 'ADMIN', name: 'Admin' });
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      peopleInsightsEnabled,
    },
  });
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  const team = await createTestTeam('Payments');
  const service = await createTestService('Checkout', team.id);
  const member = async (name: string, extra: object = {}) => {
    const user = await createTestUser({ name, ...extra });
    await db.teamMember.create({ data: { teamId: team.id, userId: user.id, role: 'MEMBER' } });
    return user;
  };
  const subject = await createTestIncident('Checkout 500s', service.id, { teamId: team.id });
  let rank = 0;
  const precedent = async (
    assigneeId: string | null,
    resolvedDaysAgo: number,
    confidence = 0.9
  ) => {
    const incident = await createTestIncident('Checkout errors', service.id, {
      status: 'RESOLVED',
      assigneeId,
      resolvedAt: new Date(Date.now() - resolvedDaysAgo * DAY),
    });
    rank += 1;
    await db.intelligenceFinding.create({
      data: {
        incidentId: subject.id,
        kind: 'SIMILAR_INCIDENT',
        subjectRef: incident.id,
        confidence,
        rank,
        evidence: {},
        generation: 1,
        engineVersion: 't',
      },
    });
    return incident;
  };
  return { admin, team, service, subject, member, precedent };
}

describe('incident experts', () => {
  it('ranks people who fixed or worked similar resolved incidents, filtered to who can help', async () => {
    const { admin, subject, member, precedent } = await fixture();
    const fixer = await member('Fixer');
    const noter = await member('Noter');
    const gone = await member('Gone');
    const outsider = await createTestUser({ name: 'Outsider' });
    const old = await member('Old timer');
    const assignee = await member('Assignee');
    await db.incident.update({
      where: { id: subject.id },
      data: { assigneeId: assignee.id, teamId: null },
    });

    const a = await precedent(fixer.id, 10);
    const b = await precedent(fixer.id, 20);
    await db.incidentNote.createMany({
      data: [
        { incidentId: a.id, userId: noter.id, content: 'restarted pool' },
        { incidentId: a.id, userId: outsider.id, content: 'fyi' },
        { incidentId: b.id, userId: assignee.id, content: 'me too' },
      ],
    });
    await precedent(gone.id, 5);
    // Left since: the database refuses new assignments to inactive people, so disable afterwards.
    await db.user.update({ where: { id: gone.id }, data: { status: 'DISABLED' } });
    await precedent(old.id, 200);

    const experts = await loadIncidentExperts(await actorOf(admin.id), subject.id);
    expect(experts.map(e => e.name)).toEqual(['Fixer', 'Noter']);
    expect(experts[0]).toMatchObject({ userId: fixer.id, resolved: 2, noted: 0 });
    expect(experts[1]).toMatchObject({ userId: noter.id, resolved: 0, noted: 1 });
  });

  it('is empty while the switch is off', async () => {
    const { admin, subject, member, precedent } = await fixture(false);
    await precedent((await member('Fixer')).id, 3);
    expect(await loadIncidentExperts(await actorOf(admin.id), subject.id)).toEqual([]);
  });

  it('never draws on a precedent the viewer cannot read', async () => {
    const { subject, member } = await fixture();
    const viewer = await member('Viewer', { role: 'USER' });
    const otherTeam = await createTestTeam('Other');
    const hidden = await createTestService('Hidden', otherTeam.id);
    const fixer = await member('Fixer');
    const secret = await createTestIncident('Secret', hidden.id, {
      status: 'RESOLVED',
      assigneeId: fixer.id,
      resolvedAt: new Date(Date.now() - DAY),
    });
    await db.intelligenceFinding.create({
      data: {
        incidentId: subject.id,
        kind: 'SIMILAR_INCIDENT',
        subjectRef: secret.id,
        confidence: 0.9,
        evidence: {},
        generation: 1,
        engineVersion: 't',
      },
    });
    expect(await loadIncidentExperts(await actorOf(viewer.id), subject.id)).toEqual([]);
  });
});
