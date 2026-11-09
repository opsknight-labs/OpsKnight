import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { getIncidentImpactForActor } from '@/lib/intelligence/impact/view';
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
const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};
const depend = (upstreamServiceId: string, downstreamServiceId: string) =>
  db.serviceDependency.create({
    data: {
      upstreamServiceId,
      downstreamServiceId,
      origin: 'DECLARED',
      status: 'ACTIVE',
      evidence: {},
    },
  });

describe('incident impact view', () => {
  it('lists dependent services, components and SLO budget, scoped to what the viewer can read', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const teamA = await createTestTeam('Team A');
    const teamB = await createTestTeam('Team B');
    const db1 = await createTestService('Database', teamA.id);
    const api = await createTestService('API', teamA.id, { status: 'DEGRADED' });
    const hidden = await createTestService('Secret billing', teamB.id);
    const web = await createTestService('Web', teamA.id);
    await depend(db1.id, api.id);
    await depend(db1.id, hidden.id);
    // Web is reachable only through the hidden service.
    await depend(hidden.id, web.id);
    // A suggested edge never counts.
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: db1.id,
        downstreamServiceId: web.id,
        origin: 'OBSERVED',
        status: 'SUGGESTED',
        evidence: {},
      },
    });
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });

    const now = new Date();
    const incident = await createTestIncident('DB down', db1.id, {
      createdAt: new Date(now.getTime() - 30 * MIN),
      teamId: teamA.id,
    });
    await createTestIncident('API errors', api.id, { teamId: teamA.id });
    await createTestIncident('Secret outage', hidden.id, { teamId: teamB.id });
    const page = await db.statusPage.create({ data: { name: 'Public', enabled: true } });
    await db.statusPageService.create({
      data: { statusPageId: page.id, serviceId: db1.id, displayName: 'Data layer' },
    });
    await db.statusPageService.create({
      data: { statusPageId: page.id, serviceId: hidden.id, displayName: 'Secret billing UI' },
    });
    await db.serviceObjective.create({
      data: {
        lineageId: 'avail',
        serviceId: db1.id,
        name: 'Availability',
        metricType: 'AVAILABILITY',
        target: 99.9,
        comparator: 'GREATER_THAN_OR_EQUAL',
        windowType: 'THIRTY_DAYS',
        activeFrom: new Date(now.getTime() - 86_400_000),
      },
    });

    const adminView = await getIncidentImpactForActor(
      incident.id,
      await actorOf(admin.id),
      undefined,
      now
    );
    expect(adminView!.downstream.map(s => [s.id, s.distance])).toEqual([
      [api.id, 1],
      [hidden.id, 1],
      [web.id, 2],
    ]);
    expect(adminView!.downstream.find(s => s.id === api.id)).toMatchObject({
      status: 'DEGRADED',
      openIncidents: 1,
    });
    expect(adminView!.components.map(c => [c.componentName, c.direct])).toEqual([
      ['Data layer', true],
      ['Secret billing UI', false],
    ]);
    expect(adminView!.slo.state).toBe('AVAILABLE');
    if (adminView!.slo.state === 'AVAILABLE') {
      expect(adminView!.slo.objectives[0].budgetMinutes).toBeCloseTo(43.2, 1);
      // 30 minutes of a 43.2-minute monthly budget.
      expect(adminView!.slo.objectives[0].incidentBudgetPercent).toBeCloseTo(69.4, 0);
      expect(adminView!.slo.severity).toBe('critical');
    }

    const memberView = await getIncidentImpactForActor(
      incident.id,
      await actorOf(member.id),
      undefined,
      now
    );
    expect(memberView!.downstream.map(s => s.id)).toEqual([api.id]);
    expect(memberView!.components.map(c => c.componentName)).toEqual(['Data layer']);
    expect(memberView!.slo).toEqual({ state: 'RESTRICTED' });
    expect(JSON.stringify(memberView)).not.toMatch(/secret/i);
    expect(JSON.stringify(memberView)).not.toContain(web.id);
  });

  it('returns nothing for an incident the viewer cannot read', async () => {
    const teamA = await createTestTeam('Team A');
    const teamB = await createTestTeam('Team B');
    const service = await createTestService('Other', teamB.id);
    const incident = await createTestIncident('x', service.id, { teamId: teamB.id });
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
    expect(await getIncidentImpactForActor(incident.id, await actorOf(member.id))).toBeNull();
  });
});
