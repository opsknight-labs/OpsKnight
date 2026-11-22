import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestService,
  createTestIncident,
  createTestTeam,
  createTestUser,
} from '../helpers/test-db';
import {
  notifyIncidentStakeholders,
  setBusinessServiceSubscribers,
  stakeholderRecipients,
} from '@/lib/business-services/stakeholder-comms';
import { importBusinessServices } from '@/lib/business-services/import';
import { setSupportingBusinessServices } from '@/lib/business-services/supporting';
import { createFakeBusinessServiceEngine } from '@/lib/business-services/__fixtures__/health';
import type { AuthorizationActor } from '@/lib/authorization-policy';

vi.mock('@/lib/sla-server', () => ({ calculateMultiServiceUptime: vi.fn().mockResolvedValue({}) }));

const actorFor = (user: { id: string }, role: AuthorizationActor['role'] = 'ADMIN') =>
  ({ id: user.id, role, status: 'ACTIVE', teamIds: [] }) satisfies AuthorizationActor;

describe('stakeholder subscriptions and updates', () => {
  let admin: AuthorizationActor;
  beforeEach(async () => {
    await resetDatabase();
    admin = actorFor(await createTestUser({ role: 'ADMIN', name: 'Ada' }));
  });

  it('matches followers and members of subscribed teams once each, skipping muted and inactive people', async () => {
    const team = await createTestTeam('Finance');
    const [follower, member, muted, disabled, both] = await Promise.all([
      createTestUser({ name: 'Follower' }),
      createTestUser({ name: 'Member', role: 'STAKEHOLDER' }),
      createTestUser({ name: 'Muted' }),
      createTestUser({ name: 'Disabled', status: 'DISABLED' }),
      createTestUser({ name: 'Both' }),
    ]);
    await testPrisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: member.id },
        { teamId: team.id, userId: muted.id, receiveTeamNotifications: false },
        { teamId: team.id, userId: disabled.id },
        { teamId: team.id, userId: both.id },
      ],
    });
    const checkout = await testPrisma.businessService.create({
      data: {
        name: 'Checkout',
        followers: { create: [{ userId: follower.id }, { userId: both.id }] },
      },
    });
    await setBusinessServiceSubscribers(checkout.id, { teamIds: [team.id] }, { actor: admin });
    const recipients = await stakeholderRecipients([checkout.id]);
    expect(recipients.map(recipient => recipient.userId).sort()).toEqual(
      [follower.id, member.id, both.id].sort()
    );

    // Replacing the set drops the team; "subscribe all" makes every active user a follower.
    const result = await setBusinessServiceSubscribers(
      checkout.id,
      { teamIds: [], subscribeAllUsers: true },
      { actor: admin }
    );
    expect(result.teamIds).toEqual([]);
    const followers = await testPrisma.businessServiceFollower.findMany({
      where: { businessServiceId: checkout.id },
      select: { userId: true },
    });
    expect(followers.map(row => row.userId)).not.toContain(disabled.id);
    expect(followers).toHaveLength(5); // admin, follower, member, muted, both
  });

  it('sends a templated update by email and in-app, audits it, never pages, and rate limits', async () => {
    const team = await createTestTeam('Finance');
    const stakeholder = await createTestUser({ role: 'STAKEHOLDER', name: 'Sam' });
    await testPrisma.teamMember.create({ data: { teamId: team.id, userId: stakeholder.id } });
    const api = await createTestService('Payments API');
    const checkout = await testPrisma.businessService.create({
      data: {
        name: 'Checkout',
        members: { create: [{ serviceId: api.id }] },
        teamSubscribers: { create: [{ teamId: team.id }] },
      },
    });
    const incident = await createTestIncident('Card payments failing', api.id);
    const result = await notifyIncidentStakeholders(
      incident.id,
      { phase: 'identified', message: 'We found the cause.' },
      { actor: admin }
    );
    expect(result).toMatchObject({
      businessServices: [{ id: checkout.id, name: 'Checkout' }],
      recipientCount: 1,
      emailCount: 1,
    });
    const inApp = await testPrisma.inAppNotification.findMany({ where: { userId: stakeholder.id } });
    expect(inApp).toHaveLength(1);
    expect(inApp[0].title).toContain('Checkout');
    const outbox = await testPrisma.notification.findMany({ where: { userId: stakeholder.id } });
    expect(outbox.map(row => row.channel)).toEqual(['EMAIL']);
    expect(outbox[0].category).toBe('STATUS_PAGE');
    expect(
      await testPrisma.auditLog.count({ where: { action: 'incident.stakeholders_notified' } })
    ).toBe(1);

    // Limited to 3 per incident per window.
    for (let index = 0; index < 2; index += 1)
      await notifyIncidentStakeholders(
        incident.id,
        { phase: 'monitoring', message: `Update ${index}` },
        { actor: admin }
      );
    await expect(
      notifyIncidentStakeholders(incident.id, { phase: 'resolved', message: 'Done' }, { actor: admin })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
  });

  it('refuses a stakeholder (no incident access) and an incident without business impact', async () => {
    const api = await createTestService('Lonely API');
    const incident = await createTestIncident('Something odd', api.id);
    const stakeholder = actorFor(await createTestUser({ role: 'STAKEHOLDER' }), 'STAKEHOLDER');
    await expect(
      notifyIncidentStakeholders(incident.id, { phase: 'identified', message: 'x' }, { actor: stakeholder })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      notifyIncidentStakeholders(incident.id, { phase: 'identified', message: 'x' }, { actor: admin })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('business-service import', () => {
  let admin: AuthorizationActor;
  beforeEach(async () => {
    await resetDatabase();
    admin = actorFor(await createTestUser({ role: 'ADMIN' }));
  });

  it('shows a dry-run diff, then applies it in one go and reports a repeat as unchanged', async () => {
    const team = await testPrisma.team.create({ data: { name: 'Payments' } });
    const api = await testPrisma.service.create({ data: { name: 'checkout-api' } });
    const pay = await testPrisma.service.create({ data: { name: 'payments-api' } });
    const old = await testPrisma.service.create({ data: { name: 'legacy-api' } });
    await testPrisma.businessService.create({
      data: { name: 'Payments', members: { create: [{ serviceId: old.id }] } },
    });
    const csv = [
      'name,description,criticality,owner_team,members,depends_on',
      `Checkout,"Paying, on web",TIER_0,Payments,checkout-api;payments-api,Payments`,
      'Payments,,1,,payments-api,',
    ].join('\n');

    const dryRun = await importBusinessServices(
      { content: csv, format: 'csv', dryRun: true },
      { actor: admin }
    );
    expect(dryRun.applied).toBe(false);
    expect(dryRun.issues).toEqual([]);
    expect(dryRun.summary).toEqual({ create: 1, update: 1, unchanged: 0, invalid: 0 });
    expect(dryRun.changes.find(change => change.name === 'Payments')).toMatchObject({
      action: 'update',
      membersAdded: ['payments-api'],
      membersRemoved: ['legacy-api'],
    });
    expect(await testPrisma.businessService.count()).toBe(1);

    const applied = await importBusinessServices(
      { content: csv, format: 'csv', dryRun: false },
      { actor: admin }
    );
    expect(applied.applied).toBe(true);
    const checkout = await testPrisma.businessService.findUniqueOrThrow({
      where: { name: 'Checkout' },
      include: { members: true, supportedBy: true },
    });
    expect(checkout).toMatchObject({
      description: 'Paying, on web',
      criticality: 'TIER_0',
      ownerTeamId: team.id,
    });
    expect(checkout.members.map(member => member.serviceId).sort()).toEqual([api.id, pay.id].sort());
    expect(checkout.supportedBy).toHaveLength(1);
    expect(
      await testPrisma.auditLog.count({ where: { action: 'business_service.imported' } })
    ).toBe(1);

    const repeat = await importBusinessServices(
      { content: csv, format: 'csv', dryRun: true },
      { actor: admin }
    );
    expect(repeat.summary).toEqual({ create: 0, update: 0, unchanged: 2, invalid: 0 });
  });

  it('applies nothing when any row is invalid and catches dependency cycles', async () => {
    const yaml = `businessServices:
  - name: A
    dependsOn: [B]
  - name: B
    dependsOn: [A]
  - name: C
    members: [no-such-service]
`;
    const result = await importBusinessServices(
      { content: yaml, format: 'yaml', dryRun: false },
      { actor: admin }
    );
    expect(result.applied).toBe(false);
    expect(result.issues.map(issue => issue.message)).toEqual(
      expect.arrayContaining([
        'Unknown service "no-such-service".',
        'The dependencies between business services would form a cycle.',
      ])
    );
    expect(await testPrisma.businessService.count()).toBe(0);
  });

  it('maps a Backstage catalog: systems become business services, their components members', async () => {
    const svc = await testPrisma.service.create({ data: { name: 'Orders' } });
    const catalog = `apiVersion: backstage.io/v1alpha1
kind: System
metadata: { name: shop }
spec: { owner: team-a }
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: orders-svc
  annotations: { opsknight.com/service-id: ${svc.id} }
spec: { system: shop, type: service }
`;
    const result = await importBusinessServices(
      { content: catalog, format: 'backstage', dryRun: false },
      { actor: admin }
    );
    expect(result.issues).toEqual([]);
    const shop = await testPrisma.businessService.findUniqueOrThrow({
      where: { name: 'shop' },
      include: { members: true },
    });
    expect(shop.members.map(member => member.serviceId)).toEqual([svc.id]);
  });

  it('refuses a plain user', async () => {
    const user = actorFor(await createTestUser({ role: 'USER' }), 'USER');
    await expect(
      importBusinessServices({ content: 'name\nX', format: 'csv', dryRun: true }, { actor: user })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });
});

describe('supporting business services', () => {
  it('replaces the set and rejects an edge that would close a cycle', async () => {
    await resetDatabase();
    const admin = actorFor(await createTestUser({ role: 'ADMIN' }));
    const [a, b] = await Promise.all([
      testPrisma.businessService.create({ data: { name: 'A' } }),
      testPrisma.businessService.create({ data: { name: 'B' } }),
    ]);
    const { engine, supports } = createFakeBusinessServiceEngine({ supports: [] });
    const check = engine.wouldCreateSupportCycle;
    await setSupportingBusinessServices(a.id, { businessServiceIds: [b.id] }, { actor: admin }, {
      wouldCreateSupportCycle: check,
    });
    supports.push([a.id, b.id]);
    await expect(
      setSupportingBusinessServices(b.id, { businessServiceIds: [a.id] }, { actor: admin }, {
        wouldCreateSupportCycle: check,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await testPrisma.businessServiceSupport.findMany()).toEqual([
      expect.objectContaining({ parentId: a.id, childId: b.id }),
    ]);
  });
});
