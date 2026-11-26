import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resetBusinessServiceHealthCacheForTests } from '@/lib/business-services/health';
import { businessServiceDto, BUSINESS_SERVICE_SELECT } from '@/lib/business-services/commands';
import {
  getBusinessImpactReport,
  impactReportCsv,
  parseImpactReportParams,
} from '@/lib/business-services/impact-report';
import { setSupportingBusinessServices } from '@/lib/business-services/supporting';
import { setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import { createTestTeam, createTestUser, testPrisma as db } from '../helpers/test-db';

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
