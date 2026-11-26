import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resetBusinessServiceHealthCacheForTests } from '@/lib/business-services/health';
import { readableServiceIds } from '@/lib/business-services/stats';
import {
  serviceIdsOf,
  businessServiceDto,
  BUSINESS_SERVICE_SELECT,
  createBusinessService,
  updateBusinessService,
} from '@/lib/business-services/commands';
import {
  getBusinessImpactReport,
  impactReportCsv,
  parseImpactReportParams,
} from '@/lib/business-services/impact-report';
import { collectServiceReviews } from '@/lib/business-services/reviews/data';
import { reviewPeriod } from '@/lib/business-services/reviews/period';
import { createCustomerImpactReport } from '@/lib/business-services/customer-reports';
import {
  reconcileBusinessServiceImpacts,
  setIncidentImpactCommand,
  syncIncidentImpacts,
} from '@/lib/business-services/impacts';
import { setSupportingBusinessServices } from '@/lib/business-services/supporting';
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

const actorFor = (
  user: { id: string },
  role: AuthorizationActor['role'],
  teamIds: string[] = []
): AuthorizationActor => ({ id: user.id, role, status: 'ACTIVE', teamIds });

describe('M2 financial visibility', () => {
  it('hides revenue, customers, currency and cost from read-scoped actors', async () => {
    const team = await createTestTeam('Fin');
    const bs = await db.businessService.create({
      data: {
        ownerTeamId: team.id,
        name: `Fin-${Math.random().toString(36).slice(2, 8)}`,
        revenuePerHourCents: 500_000,
        customersTotal: 1234,
        currency: 'EUR',
      },
    });
    const row = await db.businessService.findUniqueOrThrow({
      where: { id: bs.id },
      select: BUSINESS_SERVICE_SELECT,
    });
    expect(businessServiceDto(row)).not.toHaveProperty('revenuePerHourCents');
    expect(businessServiceDto(row, null, undefined, true)).toMatchObject({
      revenuePerHourCents: 500_000,
      customersTotal: 1234,
      currency: 'EUR',
    });

    const user = await createTestUser({ role: 'USER' });
    const admin = await createTestUser({ role: 'ADMIN' });
    for (const [actor, visible] of [
      [actorFor(user, 'USER', [team.id]), false],
      [actorFor(admin, 'ADMIN'), true],
    ] as const) {
      const report = await getBusinessImpactReport(actor, parseImpactReportParams({ days: '7' }));
      const found = report.rows.find(r => r.id === bs.id)!;
      expect(found.revenuePerHourCents).toBe(visible ? 500_000 : null);
      expect(found.customersTotal).toBe(visible ? 1234 : null);
      const csv = impactReportCsv(report);
      expect(csv.includes('1234')).toBe(visible);
    }
  });
});

describe('H1 concurrent supporting updates', () => {
  it('never stores a cycle when A->B and B->A are set at the same time', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = actorFor(admin, 'ADMIN');
    const tag = Math.random().toString(36).slice(2, 8);
    const [a, b] = await Promise.all(
      ['A', 'B'].map(n => db.businessService.create({ data: { name: `${n}-${tag}` } }))
    );
    for (let round = 0; round < 5; round++) {
      await db.businessServiceSupport.deleteMany({});
      const results = await Promise.allSettled([
        setSupportingBusinessServices(a.id, { businessServiceIds: [b.id] }, { actor }),
        setSupportingBusinessServices(b.id, { businessServiceIds: [a.id] }, { actor }),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.businessServiceSupport.count()).toBe(1);
    }
  });

  it('bumps the realtime clock so health caches refresh', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const tag = Math.random().toString(36).slice(2, 8);
    const [a, b] = await Promise.all(
      ['A', 'B'].map(n => db.businessService.create({ data: { name: `${n}-${tag}` } }))
    );
    const before = await db.realtimeChange.count();
    await setSupportingBusinessServices(
      a.id,
      { businessServiceIds: [b.id] },
      { actor: actorFor(admin, 'ADMIN') }
    );
    expect(await db.realtimeChange.count()).toBeGreaterThan(before);
  });
});

async function impactScenario() {
  const tag = Math.random().toString(36).slice(2, 8);
  const service = await createTestService(`svc-${tag}`);
  const bs = await db.businessService.create({
    data: { name: `BS-${tag}`, members: { create: [{ serviceId: service.id }] } },
  });
  return { service, bs };
}

describe('H2 incident resolved before the first impact sync', () => {
  it('records a closed interval for an incident that was resolved before any sync ran', async () => {
    const { service, bs } = await impactScenario();
    const createdAt = new Date(Date.now() - 3 * 3_600_000);
    const resolvedAt = new Date(Date.now() - 2 * 3_600_000);
    const incident = await createTestIncident('Quick outage', service.id, {
      status: 'RESOLVED',
      createdAt,
      resolvedAt,
    });
    await syncIncidentImpacts([incident.id]);
    const rows = await db.incidentBusinessServiceImpact.findMany({
      where: { incidentId: incident.id, businessServiceId: bs.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].startedAt.getTime()).toBe(createdAt.getTime());
    expect(rows[0].endedAt?.getTime()).toBe(resolvedAt.getTime());
    // Replays converge.
    await syncIncidentImpacts([incident.id]);
    expect(
      await db.incidentBusinessServiceImpact.count({ where: { incidentId: incident.id } })
    ).toBe(1);
  });
});

describe('M1 sync versus unmark', () => {
  it('never leaves a counted interval behind after an unmark that ran concurrently with a sync', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = actorFor(admin, 'ADMIN');
    const { service, bs } = await impactScenario();
    for (let round = 0; round < 15; round++) {
      const incident = await createTestIncident(`Race ${round}`, service.id);
      await Promise.all([
        syncIncidentImpacts([incident.id]),
        setIncidentImpactCommand(
          { incidentId: incident.id, businessServiceId: bs.id, impacted: false },
          actor
        ),
      ]);
      const counted = await db.incidentBusinessServiceImpact.count({
        where: { incidentId: incident.id, businessServiceId: bs.id, excluded: false },
      });
      expect(counted).toBe(0);
    }
  });
});

describe('M8 reconcile paging', () => {
  it('reconciles every open incident even when there are more than one page', async () => {
    const { service, bs } = await impactScenario();
    const incidents = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createTestIncident(`Open ${i}`, service.id))
    );
    const totals = await reconcileBusinessServiceImpacts(new Date(), 2);
    expect(totals.incidents).toBeGreaterThanOrEqual(5);
    expect(
      await db.incidentBusinessServiceImpact.count({
        where: { businessServiceId: bs.id, incidentId: { in: incidents.map(i => i.id) } },
      })
    ).toBe(5);
  });
});

describe('M3, L1 and BS-9 update validation', () => {
  const adminActor = async () => actorFor(await createTestUser({ role: 'ADMIN' }), 'ADMIN');

  it('M3: a follower deactivated later does not block unrelated edits', async () => {
    const actor = await adminActor();
    const follower = await createTestUser({ role: 'USER' });
    const created = await createBusinessService(
      { name: `Fol-${Math.random().toString(36).slice(2, 8)}`, followerUserIds: [follower.id] },
      { actor }
    );
    await db.user.update({ where: { id: follower.id }, data: { status: 'DISABLED' } });
    const updated = await updateBusinessService(created.id, { description: 'edited' }, { actor });
    expect(updated.description).toBe('edited');
    expect(updated.followers.map(f => f.user.id)).toEqual([follower.id]);
    const other = await createTestUser({ role: 'USER', status: 'DISABLED' });
    await expect(
      updateBusinessService(created.id, { followerUserIds: [follower.id, other.id] }, { actor })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('L1: quorum thresholds are validated against the stored value', async () => {
    const actor = await adminActor();
    const created = await createBusinessService(
      { name: `Quo-${Math.random().toString(36).slice(2, 8)}`, quorumMajorPct: 50 },
      { actor }
    );
    await expect(
      updateBusinessService(created.id, { quorumPartialPct: 80 }, { actor })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('BS-9: a duplicate name names the name field', async () => {
    const actor = await adminActor();
    const name = `Dup-${Math.random().toString(36).slice(2, 8)}`;
    await createBusinessService({ name }, { actor });
    const error = await createBusinessService({ name }, { actor }).catch(e => e);
    expect(error.code).toBe('RESOURCE_CONFLICT');
    expect(error.fields).toEqual([expect.objectContaining({ field: 'name' })]);
  });
});

describe('M4 customer report idempotency', () => {
  it('concurrent posts with one externalRef inside a caller transaction create one row', async () => {
    const actor = actorFor(await createTestUser({ role: 'ADMIN' }), 'ADMIN');
    const { bs } = await impactScenario();
    const body = {
      source: 'zendesk',
      count: 5,
      windowStart: new Date(Date.now() - 600_000),
      windowEnd: new Date(Date.now() - 60_000),
      externalRef: 'ticket-1',
    };
    // Same shape as the REST route: the caller owns the transaction.
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        db.$transaction(tx => createCustomerImpactReport(bs.id, body, { actor }, tx))
      )
    );
    expect(results.filter(r => r.created)).toHaveLength(1);
    expect(await db.customerImpactReport.count({ where: { businessServiceId: bs.id } })).toBe(1);
  });

  it('a different report under the same externalRef is a conflict, not a silent 200', async () => {
    const actor = actorFor(await createTestUser({ role: 'ADMIN' }), 'ADMIN');
    const { bs } = await impactScenario();
    const body = {
      source: 'zendesk',
      count: 5,
      windowStart: new Date(Date.now() - 600_000),
      windowEnd: new Date(Date.now() - 60_000),
      externalRef: 'ticket-2',
    };
    await createCustomerImpactReport(bs.id, body, { actor });
    await expect(
      createCustomerImpactReport(bs.id, { ...body, count: 99 }, { actor })
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
    const retry = await createCustomerImpactReport(bs.id, body, { actor });
    expect(retry.created).toBe(false);
  });
});

describe('M6 review cost uses weighted downtime', () => {
  it('prices a LOW-urgency hour at a quarter, like the stats do', async () => {
    const { service, bs } = await impactScenario();
    await db.businessService.update({
      where: { id: bs.id },
      data: { revenuePerHourCents: 600_000 },
    });
    const now = new Date();
    const period = reviewPeriod(now, 'UTC');
    const start = new Date(period.to.getTime() - 3 * 3_600_000);
    const incident = await createTestIncident('Slow', service.id, {
      urgency: 'LOW',
      status: 'RESOLVED',
      createdAt: start,
      resolvedAt: new Date(start.getTime() + 3_600_000),
    });
    await db.incidentBusinessServiceImpact.create({
      data: {
        incidentId: incident.id,
        businessServiceId: bs.id,
        source: 'DIRECT',
        startedAt: start,
        endedAt: new Date(start.getTime() + 3_600_000),
      },
    });
    const review = (await collectServiceReviews([bs.id], period, 'UTC')).get(bs.id)!;
    expect(review.downtimeMinutes).toBeCloseTo(60, 0);
    expect(review.estimatedCostCents).toBe(150_000);
  });
});

describe('L3 out-of-scope members', () => {
  it('redacts technical services the reader cannot see from members and reasons', async () => {
    const mine = await createTestTeam('Mine');
    const other = await createTestTeam('Other');
    const visible = await createTestService('visible', mine.id);
    const hidden = await createTestService('hidden', other.id);
    const bs = await db.businessService.create({
      data: {
        name: `L3-${Math.random().toString(36).slice(2, 8)}`,
        ownerTeamId: mine.id,
        members: { create: [{ serviceId: visible.id }, { serviceId: hidden.id }] },
      },
    });
    const user = await createTestUser({ role: 'USER' });
    const actor = actorFor(user, 'USER', [mine.id]);
    const row = await db.businessService.findUniqueOrThrow({
      where: { id: bs.id },
      select: BUSINESS_SERVICE_SELECT,
    });
    const allowed = await readableServiceIds(actor, serviceIdsOf([row], []));
    const dto = businessServiceDto(row, null, undefined, false, allowed);
    expect(dto.members.find(m => m.id === hidden.id)).toMatchObject({ name: 'Restricted service' });
    expect(dto.members.find(m => m.id === visible.id)!.name).toBe(visible.name);
  });
});
