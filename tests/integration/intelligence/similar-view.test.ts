import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { analyzeIncident } from '@/lib/intelligence/similarity/analyzer';
import { describeReasons, getSimilarIncidentsForActor } from '@/lib/intelligence/similarity/view';
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

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 };

async function actorFor(userId: string) {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
}

async function indexed(title: string, serviceId: string, teamId?: string | null, resolved = false) {
  const incident = await createTestIncident(title, serviceId, {
    createdAt: new Date(Date.now() - 3_600_000),
    ...(teamId ? { teamId } : {}),
    ...(resolved ? { status: 'RESOLVED', resolvedAt: new Date() } : {}),
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

async function setup(mode: 'SHADOW' | 'SUGGEST') {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode, definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({ data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true } });
  return admin;
}

describe('similar incidents as seen by a viewer', () => {
  it('shows precedents to a responder in SUGGEST mode, with reasons and no stored text', async () => {
    const admin = await setup('SUGGEST');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors on db-primary-1', service.id);
    const precedent = await indexed('Database connection errors on db-primary-7', service.id, null, true);
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);

    const result = await getSimilarIncidentsForActor(target.id, await actorFor(admin.id));
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      incidentId: precedent.id,
      title: 'Database connection errors on db-primary-7',
      status: 'RESOLVED',
    });
    expect(result![0].matchPercent).toBeGreaterThan(80);
    expect(result![0].reasons).toEqual(expect.arrayContaining(['Very similar wording', 'Same service', 'Previously resolved']));
  });

  it('shows nothing in SHADOW mode: findings are recorded but not surfaced', async () => {
    const admin = await setup('SHADOW');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    await indexed('Database connection errors', service.id);
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);
    expect(await db.intelligenceFinding.count()).toBe(1);
    expect(await getSimilarIncidentsForActor(target.id, await actorFor(admin.id))).toBeNull();
  });

  it('shows nothing while the master switch is off, even with a SUGGEST policy', async () => {
    const admin = await setup('SUGGEST');
    const service = await createTestService('Checkout');
    const target = await indexed('Database connection errors', service.id);
    await indexed('Database connection errors', service.id);
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);
    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
    expect(await getSimilarIncidentsForActor(target.id, await actorFor(admin.id))).toBeNull();
  });

  it('never reveals an incident the viewer is not allowed to read', async () => {
    const admin = await setup('SUGGEST');
    const teamA = await createTestTeam('Team A');
    const teamB = await createTestTeam('Team B');
    const serviceA = await createTestService('Service A', teamA.id);
    const serviceB = await createTestService('Service B', teamB.id);
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });

    const target = await indexed('Payment gateway timeout', serviceA.id, teamA.id);
    const visible = await indexed('Payment gateway timeout seen before', serviceA.id, teamA.id);
    const hidden = await indexed('Payment gateway timeout secret customer', serviceB.id, teamB.id);
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);
    expect(await db.intelligenceFinding.count({ where: { incidentId: target.id } })).toBe(2);

    // The admin can see both precedents.
    const adminView = await getSimilarIncidentsForActor(target.id, await actorFor(admin.id));
    expect(adminView!.map(v => v.incidentId).sort()).toEqual([visible.id, hidden.id].sort());

    // A scoped user (team A only) sees the precedent in their own team, and nothing hints at the other.
    const memberActor = await actorFor(member.id);
    expect(memberActor.role).toBe('USER');
    const memberView = await getSimilarIncidentsForActor(target.id, memberActor);
    expect(memberView!.map(v => v.incidentId)).toEqual([visible.id]);
    expect(JSON.stringify(memberView)).not.toMatch(/secret customer|Service B/);
  });

  it('returns nothing to a viewer who cannot see the source incident, is disabled, or when it is missing', async () => {
    const admin = await setup('SUGGEST');
    const teamA = await createTestTeam('Team A');
    const teamB = await createTestTeam('Team B');
    const serviceB = await createTestService('Service B', teamB.id);
    const outsider = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: outsider.id, teamId: teamA.id, role: 'MEMBER' } });
    const target = await indexed('Payment gateway timeout', serviceB.id, teamB.id);
    await indexed('Payment gateway timeout', serviceB.id, teamB.id);
    await analyzeIncident({ subjectKey: target.id, generation: 1 }, settings);

    const outsiderActor = await actorFor(outsider.id);
    expect(await getSimilarIncidentsForActor(target.id, outsiderActor)).toBeNull(); // cannot see the source
    expect(await getSimilarIncidentsForActor(target.id, { ...outsiderActor, status: 'DISABLED' })).toBeNull();
    expect(await getSimilarIncidentsForActor('missing', await actorFor(admin.id))).toBeNull();
    expect(await getSimilarIncidentsForActor(target.id, await actorFor(admin.id))).toHaveLength(1);
  });
});

describe('reason text', () => {
  it('is derived from numeric components only', () => {
    const base = { tokens: 0.3, template: 0.3, labels: 0, sameService: 0, recency: 1, resolved: 0 };
    expect(describeReasons(base)).toEqual(['Similar wording']);
    expect(describeReasons({ ...base, template: 0.9, labels: 0.8, sameService: 1, resolved: 1 })).toEqual([
      'Very similar wording',
      'Shared labels',
      'Same service',
      'Previously resolved',
    ]);
  });
});
