import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  createTestIncident,
  createTestStatusPageSubscription,
  createTestUser,
  linkServiceToStatusPage,
} from '../helpers/test-db';
import { rebuildStatusPageSnapshot, readStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { subscriberServiceFilter } from '@/lib/status-pages/subscription-policy';
import { assignIncidentRoleCommand } from '@/lib/incidents/roles-command';

vi.mock('@/lib/sla-server', () => ({ calculateMultiServiceUptime: vi.fn().mockResolvedValue({}) }));

async function snapshotRevision(pageId: string) {
  const rows = await testPrisma.$queryRaw<Array<{ revision: bigint; publishedRevision: bigint }>>`
    SELECT "revision", "publishedRevision" FROM "StatusPageSnapshot" WHERE "statusPageId" = ${pageId}`;
  return rows[0];
}

describe('business services on status pages', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function groupedPage(layout: 'FLAT' | 'BUSINESS' | 'BUSINESS_EXPANDABLE') {
    const page = await createTestStatusPage({ enabled: true, serviceLayout: layout });
    const api = await createTestService('Payments API');
    const cdn = await createTestService('Edge CDN');
    const mail = await createTestService('Email');
    for (const service of [api, cdn, mail]) await linkServiceToStatusPage(page.id, service.id);
    const checkout = await testPrisma.businessService.create({
      data: {
        name: 'Checkout',
        members: { create: [{ serviceId: api.id }, { serviceId: cdn.id }] },
      },
    });
    await testPrisma.statusPageBusinessService.create({
      data: { statusPageId: page.id, businessServiceId: checkout.id },
    });
    return { page, api, cdn, mail, checkout };
  }

  it('publishes business rows with the worst member status only on grouped layouts', async () => {
    const { page, api, checkout } = await groupedPage('BUSINESS_EXPANDABLE');
    await createTestIncident('Card payments failing', api.id, {
      visibility: 'PUBLIC',
      urgency: 'HIGH',
    });
    expect(await rebuildStatusPageSnapshot(page.id)).toBe(true);
    const snapshot = await readStatusPageSnapshot(page.id);
    expect(snapshot?.page.serviceLayout).toBe('BUSINESS_EXPANDABLE');
    expect(snapshot?.businessServices).toHaveLength(1);
    expect(snapshot?.businessServices?.[0]).toMatchObject({
      id: checkout.id,
      name: 'Checkout',
      status: 'MAJOR_OUTAGE',
      impactedServiceCount: 1,
    });
    expect(snapshot?.businessServices?.[0].memberServiceIds).toHaveLength(2);
    expect(snapshot?.schemaVersion).toBe(3);
  });

  it('keeps FLAT snapshots free of business data', async () => {
    const { page } = await groupedPage('FLAT');
    await rebuildStatusPageSnapshot(page.id);
    const snapshot = await readStatusPageSnapshot(page.id);
    expect(snapshot?.businessServices).toBeUndefined();
    expect(snapshot?.page.serviceLayout).toBeUndefined();
  });

  it('marks the page dirty when membership, names or page mappings change', async () => {
    const { page, mail, checkout } = await groupedPage('BUSINESS');
    await rebuildStatusPageSnapshot(page.id);
    const clean = await snapshotRevision(page.id);
    expect(clean.revision).toBe(clean.publishedRevision);

    await testPrisma.businessServiceMember.create({
      data: { businessServiceId: checkout.id, serviceId: mail.id },
    });
    expect((await snapshotRevision(page.id)).revision).toBeGreaterThan(clean.revision);

    await rebuildStatusPageSnapshot(page.id);
    const afterMember = await snapshotRevision(page.id);
    await testPrisma.businessService.update({
      where: { id: checkout.id },
      data: { name: 'Checkout & Cart' },
    });
    expect((await snapshotRevision(page.id)).revision).toBeGreaterThan(afterMember.revision);

    await rebuildStatusPageSnapshot(page.id);
    const afterRename = await snapshotRevision(page.id);
    await testPrisma.statusPageBusinessService.updateMany({
      where: { statusPageId: page.id },
      data: { order: 3 },
    });
    expect((await snapshotRevision(page.id)).revision).toBeGreaterThan(afterRename.revision);
  });

  it('matches whole-page, service and business-service subscribers for an affected service', async () => {
    const { page, api, mail, checkout } = await groupedPage('BUSINESS');
    const all = await createTestStatusPageSubscription(page.id, 'all@example.com');
    const byService = await createTestStatusPageSubscription(page.id, 'api@example.com');
    await testPrisma.statusPageSubscriptionService.create({
      data: { subscriptionId: byService.id, serviceId: api.id },
    });
    const byBusiness = await createTestStatusPageSubscription(page.id, 'checkout@example.com');
    await testPrisma.statusPageSubscriptionBusinessService.create({
      data: { subscriptionId: byBusiness.id, businessServiceId: checkout.id },
    });
    const unrelated = await createTestStatusPageSubscription(page.id, 'mail@example.com');
    await testPrisma.statusPageSubscriptionService.create({
      data: { subscriptionId: unrelated.id, serviceId: mail.id },
    });

    const matched = await testPrisma.statusPageSubscription.findMany({
      where: { statusPageId: page.id, ...subscriberServiceFilter([api.id]) },
      select: { email: true },
      orderBy: { email: 'asc' },
    });
    expect(matched.map(row => row.email)).toEqual(
      [all.email, byService.email, byBusiness.email].sort()
    );
  });
});

describe('incident roles persistence', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('keeps one holder per role, records events and clears cleanly', async () => {
    const service = await createTestService('API');
    const incident = await createTestIncident('Latency', service.id);
    const ada = await createTestUser({ name: 'Ada' });
    const grace = await createTestUser({ name: 'Grace' });

    await assignIncidentRoleCommand({
      incidentId: incident.id,
      roleKey: 'COMMANDER',
      userId: ada.id,
      actor: { id: ada.id, name: 'Ada' },
    });
    await assignIncidentRoleCommand({
      incidentId: incident.id,
      roleKey: 'COMMANDER',
      userId: grace.id,
      actor: { id: ada.id, name: 'Ada' },
    });
    const holders = await testPrisma.incidentRoleAssignment.findMany({
      where: { incidentId: incident.id },
    });
    expect(holders).toHaveLength(1);
    expect(holders[0].userId).toBe(grace.id);
    expect(await testPrisma.incidentWatcher.count({ where: { incidentId: incident.id } })).toBe(2);

    const cleared = await assignIncidentRoleCommand({
      incidentId: incident.id,
      roleKey: 'COMMANDER',
      userId: null,
      actor: { id: grace.id, name: 'Grace' },
    });
    expect(cleared.changed).toBe(true);
    const events = await testPrisma.incidentEvent.findMany({
      where: { incidentId: incident.id, type: { in: ['ROLE_ASSIGNED', 'ROLE_UNASSIGNED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map(event => event.type)).toEqual([
      'ROLE_ASSIGNED',
      'ROLE_ASSIGNED',
      'ROLE_UNASSIGNED',
    ]);
    await expect(
      testPrisma.incidentRoleAssignment.createMany({
        data: [
          { incidentId: incident.id, roleKey: 'SCRIBE', userId: ada.id },
          { incidentId: incident.id, roleKey: 'SCRIBE', userId: grace.id },
        ],
      })
    ).rejects.toThrow();
  });
});
