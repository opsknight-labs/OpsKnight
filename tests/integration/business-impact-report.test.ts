import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resetBusinessServiceHealthCacheForTests } from '@/lib/business-services/health';
import {
  getBusinessImpactReport,
  impactReportCsv,
  parseImpactReportParams,
} from '@/lib/business-services/impact-report';
import { setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';

setupMcpReadDatabase();
beforeEach(() => resetBusinessServiceHealthCacheForTests());

const HOUR = 3_600_000;
const actorFor = (
  user: { id: string },
  role: AuthorizationActor['role'],
  teamIds: string[] = []
): AuthorizationActor => ({ id: user.id, role, status: 'ACTIVE', teamIds });

async function impact(
  businessServiceId: string,
  serviceId: string,
  startHoursAgo: number,
  endHoursAgo: number | null,
  now: Date
) {
  const start = new Date(now.getTime() - startHoursAgo * HOUR);
  const incident = await createTestIncident('Outage', serviceId, {
    createdAt: start,
    acknowledgedAt: new Date(start.getTime() + 10 * 60_000),
    resolvedAt: endHoursAgo === null ? null : new Date(now.getTime() - endHoursAgo * HOUR),
    status: endHoursAgo === null ? 'OPEN' : 'RESOLVED',
  });
  await db.incidentBusinessServiceImpact.create({
    data: {
      incidentId: incident.id,
      businessServiceId,
      source: 'DIRECT',
      startedAt: start,
      endedAt: endHoursAgo === null ? null : new Date(now.getTime() - endHoursAgo * HOUR),
    },
  });
}

describe('business impact report', () => {
  it('reports engine stats per business service, worst first, with the worst member', async () => {
    const now = new Date();
    const [mine, other] = [await createTestTeam('Mine'), await createTestTeam('Other')];
    const web = await createTestService('web', mine.id);
    const api = await createTestService('api', mine.id);
    const hidden = await createTestService('hidden', other.id);
    const tag = Math.random().toString(36).slice(2, 8);
    const checkout = await db.businessService.create({
      data: {
        name: `Checkout-${tag}`,
        ownerTeamId: mine.id,
        criticality: 'TIER_0',
        members: {
          create: [{ serviceId: web.id }, { serviceId: api.id }, { serviceId: hidden.id }],
        },
      },
    });
    const quiet = await db.businessService.create({
      data: { name: `Quiet-${tag}`, ownerTeamId: mine.id, criticality: 'TIER_2' },
    });
    const secret = await db.businessService.create({
      data: {
        name: `Secret-${tag}`,
        ownerTeamId: other.id,
        members: { create: [{ serviceId: hidden.id }] },
      },
    });
    // web: 4 h; api: 2 h overlapping web's last hour; hidden: 10 h but invisible to the reader.
    await impact(checkout.id, web.id, 10, 6, now);
    await impact(checkout.id, api.id, 7, 5, now);
    await impact(checkout.id, hidden.id, 30, 20, now);
    await impact(secret.id, hidden.id, 30, 20, now);

    const user = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { teamId: mine.id, userId: user.id } });
    const actor = actorFor(user, 'USER', [mine.id]);
    const report = await getBusinessImpactReport(
      actor,
      parseImpactReportParams({ days: '7', team: mine.id }),
      now
    );
    expect(report.rows.map(row => row.id)).toEqual([checkout.id, quiet.id]);
    const [first, second] = report.rows;
    // Union: 30→20 h, and 10→5 h = 15 h impacted; counted once though web and api overlap.
    expect(first.stats.impactMinutes).toBeCloseTo(15 * 60, 0);
    expect(first.stats.incidentCount).toBe(3);
    expect(first.stats.mttaMinutes).toBeCloseTo(10, 5);
    // The hidden member impacted longest but is never named to this reader.
    expect(first.worstMember).toMatchObject({ id: web.id });
    expect(first.worstMember!.impactMinutes).toBeCloseTo(240, 0);
    expect(second.stats).toMatchObject({ impactMinutes: 0, incidentCount: 0, uptimePercent: 100 });

    const tiered = await getBusinessImpactReport(
      actor,
      parseImpactReportParams({ tier: 'TIER_2' }),
      now
    );
    expect(tiered.rows.map(row => row.id)).toEqual([quiet.id]);

    const csv = impactReportCsv(report).trim().split('\n');
    expect(csv[0]).toContain('Business service,Tier,Owner team,Uptime %');
    expect(csv[1]).toContain(`Checkout-${tag},TIER_0`);
    expect(csv[1]).toContain(`,15,`);
    expect(csv).toHaveLength(3);
  });

  it('parses only known windows and tiers', () => {
    expect(parseImpactReportParams({ days: '365', tier: 'TIER_9', team: 'x y' })).toEqual({
      days: 30,
      teamId: null,
      tier: null,
    });
    expect(parseImpactReportParams(new URLSearchParams('days=90&tier=TIER_1&team=t1'))).toEqual({
      days: 90,
      teamId: 't1',
      tier: 'TIER_1',
    });
  });
});
