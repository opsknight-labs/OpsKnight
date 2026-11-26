import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resetBusinessServiceHealthCacheForTests } from '@/lib/business-services/health';
import { simulateFailure } from '@/lib/intelligence/dependencies/insights/service';
import {
  createTestService,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';
import { setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';

setupMcpReadDatabase();
beforeEach(() => resetBusinessServiceHealthCacheForTests());

async function scenario() {
  const team = await createTestTeam('Sim');
  const root = await createTestService('root', team.id);
  const leaf = await createTestService('leaf', team.id);
  await db.serviceDependency.create({
    data: {
      upstreamServiceId: root.id,
      downstreamServiceId: leaf.id,
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
      evidence: {},
    },
  });
  await db.businessService.create({
    data: {
      name: 'Checkout',
      ownerTeamId: team.id,
      criticality: 'TIER_0',
      revenuePerHourCents: 1_000_000,
      customersTotal: 4200,
      members: { create: [{ serviceId: leaf.id, critical: true }] },
    },
  });
  return { team, root, leaf };
}

describe('simulateFailure (P12)', () => {
  it('shows revenue and customer exposure only to actors who may read financials', async () => {
    const s = await scenario();
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { teamId: s.team.id, userId: user.id } });
    const asAdmin: AuthorizationActor = {
      id: admin.id,
      role: 'ADMIN',
      status: 'ACTIVE',
      teamIds: [],
    };
    const asUser: AuthorizationActor = {
      id: user.id,
      role: 'USER',
      status: 'ACTIVE',
      teamIds: [s.team.id],
    };
    const full = await simulateFailure(asAdmin, [s.root.id]);
    expect(full.exposure).toMatchObject({ revenuePerHourCents: 1_000_000, customers: 4200 });
    const scoped = await simulateFailure(asUser, [s.root.id]);
    expect(scoped.affectedBusinessServices).toHaveLength(1);
    expect(scoped.exposure.revenuePerHourCents).toBeNull();
    expect(scoped.exposure.customers).toBeNull();
    expect(JSON.stringify(scoped)).not.toContain('1000000');
    expect(JSON.stringify(scoped)).not.toContain('4200');
  });

  it('explains a seed beyond the graph cap instead of reporting it missing', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await db.service.createMany({
      data: Array.from({ length: 2005 }, (_, index) => ({
        name: `a-${String(index).padStart(4, '0')}`,
      })),
    });
    const late = await createTestService('zzz-late');
    const asAdmin: AuthorizationActor = {
      id: admin.id,
      role: 'ADMIN',
      status: 'ACTIVE',
      teamIds: [],
    };
    await expect(simulateFailure(asAdmin, [late.id])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(simulateFailure(asAdmin, ['no-such-service'])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
