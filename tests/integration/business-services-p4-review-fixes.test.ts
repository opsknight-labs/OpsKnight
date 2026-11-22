import { beforeEach, describe, expect, it } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
} from '../helpers/test-db';
import { CAPABILITIES } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { setSupportingBusinessServices } from '@/lib/business-services/supporting';
import { notifyIncidentStakeholders } from '@/lib/business-services/stakeholder-comms';
import { resetBusinessServiceHealthCacheForTests } from '@/lib/business-services/health';
import { reconcileScimRoles } from '@/lib/scim/lifecycle/roles';
import { stakeholderConversionBlockers } from '@/lib/users/stakeholder-role-guard';

const admin = async (): Promise<AuthorizationActor> => {
  const user = await createTestUser({ role: 'ADMIN' });
  return { id: user.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
};

describe('PR #1038 review fixes', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetBusinessServiceHealthCacheForTests();
  });

  it('keeps supporting edits inside the actor’s business-service scope', async () => {
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const [mine, alsoMine, theirs] = await Promise.all([
      testPrisma.businessService.create({ data: { name: 'Mine', ownerTeamId: teamA.id } }),
      testPrisma.businessService.create({ data: { name: 'Also mine', ownerTeamId: teamA.id } }),
      testPrisma.businessService.create({ data: { name: 'Theirs', ownerTeamId: teamB.id } }),
    ]);
    const user = await createTestUser();
    const scoped: AuthorizationActor = {
      id: user.id,
      role: 'USER',
      status: 'ACTIVE',
      teamIds: [teamA.id],
      capabilities: new Set([CAPABILITIES.OPERATIONS_MANAGE, CAPABILITIES.SERVICE_READ_SCOPED]),
    };
    const noCycle = { wouldCreateSupportCycle: async () => false };
    await expect(
      setSupportingBusinessServices(
        theirs.id,
        { businessServiceIds: [mine.id] },
        { actor: scoped },
        noCycle
      )
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      setSupportingBusinessServices(
        mine.id,
        { businessServiceIds: [theirs.id] },
        { actor: scoped },
        noCycle
      )
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await setSupportingBusinessServices(
      mine.id,
      { businessServiceIds: [alsoMine.id] },
      { actor: scoped },
      noCycle
    );
    expect(await testPrisma.businessServiceSupport.count()).toBe(1);
  });

  it('skips a SCIM stakeholder conversion for someone on call, records why, and syncs the rest', async () => {
    const connector = await testPrisma.scimConnector.create({ data: { name: 'Entra' } });
    const onCall = await createTestUser({ role: 'RESPONDER' });
    const free = await createTestUser({ role: 'RESPONDER' });
    const schedule = await createTestOnCallSchedule('Primary', [{ userIds: [onCall.id] }]);
    const group = await testPrisma.scimGroup.create({
      data: { connectorId: connector.id, name: 'Stakeholders', systemRole: 'STAKEHOLDER' },
    });
    for (const [index, user] of [onCall, free].entries()) {
      await testPrisma.scimIdentity.create({
        data: { connectorId: connector.id, externalId: `ext-${index}`, userId: user.id },
      });
      await testPrisma.scimGroupMembership.create({ data: { groupId: group.id, userId: user.id } });
    }
    const changed = await testPrisma.$transaction(tx =>
      reconcileScimRoles(tx, connector.id, [onCall.id, free.id], 'req-1')
    );
    expect(changed).toEqual([free.id]);
    const roles = await testPrisma.user.findMany({
      where: { id: { in: [onCall.id, free.id] } },
      select: { id: true, role: true },
    });
    expect(Object.fromEntries(roles.map(row => [row.id, row.role]))).toEqual({
      [onCall.id]: 'RESPONDER',
      [free.id]: 'STAKEHOLDER',
    });
    const skipped = await testPrisma.scimEvent.findFirstOrThrow({
      where: { action: 'user.role.sync_skipped', resourceId: onCall.id },
    });
    expect(skipped.details).toMatchObject({
      role: 'STAKEHOLDER',
      duties: [`on call in "${schedule.name}"`],
    });

    // The OIDC sign-in path uses the same check and keeps the role instead of refusing sign-in.
    expect(await stakeholderConversionBlockers(onCall.id, 'RESPONDER', 'STAKEHOLDER')).toEqual([
      `on call in "${schedule.name}"`,
    ]);
    expect(await stakeholderConversionBlockers(onCall.id, 'RESPONDER', 'USER')).toBeNull();
  });

  it('notifies only business services the engine’s thresholds consider impacted when no rows exist yet', async () => {
    const actor = await admin();
    const api = await createTestService('Payments API');
    const follower = await createTestUser({ role: 'STAKEHOLDER' });
    // TIER_0 needs HIGH urgency or P1/P2; the untiered one counts every incident.
    const tier0 = await testPrisma.businessService.create({
      data: {
        name: 'Checkout',
        criticality: 'TIER_0',
        members: { create: [{ serviceId: api.id }] },
        followers: { create: [{ userId: follower.id }] },
      },
    });
    const untiered = await testPrisma.businessService.create({
      data: {
        name: 'Back office',
        members: { create: [{ serviceId: api.id }] },
        followers: { create: [{ userId: follower.id }] },
      },
    });
    const low = await createTestIncident('Slow reports', api.id, { urgency: 'LOW' });
    expect(await testPrisma.incidentBusinessServiceImpact.count()).toBe(0);
    const lowResult = await notifyIncidentStakeholders(
      low.id,
      { phase: 'investigating', message: 'Looking.' },
      { actor }
    );
    expect(lowResult.businessServices.map(row => row.id)).toEqual([untiered.id]);

    const high = await createTestIncident('Payments down', api.id, { urgency: 'HIGH' });
    resetBusinessServiceHealthCacheForTests();
    const highResult = await notifyIncidentStakeholders(
      high.id,
      { phase: 'investigating', message: 'Looking.' },
      { actor }
    );
    expect(highResult.businessServices.map(row => row.id).sort()).toEqual(
      [tier0.id, untiered.id].sort()
    );
  });
});
