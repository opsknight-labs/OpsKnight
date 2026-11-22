import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  createTestIncident,
  createTestUser,
  linkServiceToStatusPage,
} from '../helpers/test-db';
import { rebuildStatusPageSnapshot, readStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import {
  expireStatusPageBusinessServiceOverrides,
  setStatusPageBusinessServiceOverride,
} from '@/lib/status-pages/business-service-overrides';
import type { AuthorizationActor } from '@/lib/authorization-policy';

vi.mock('@/lib/sla-server', () => ({ calculateMultiServiceUptime: vi.fn().mockResolvedValue({}) }));

describe('business-service component groups on status pages', () => {
  let admin: AuthorizationActor;

  beforeEach(async () => {
    await resetDatabase();
    const user = await createTestUser({ role: 'ADMIN' });
    admin = { id: user.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
  });

  async function groupedPage() {
    const page = await createTestStatusPage({ enabled: true, serviceLayout: 'BUSINESS_EXPANDABLE' });
    const api = await createTestService('Payments API');
    const cdn = await createTestService('Edge CDN');
    const mail = await createTestService('Email');
    for (const service of [api, cdn, mail]) await linkServiceToStatusPage(page.id, service.id);
    const checkout = await testPrisma.businessService.create({
      data: { name: 'Checkout', members: { create: [{ serviceId: api.id }, { serviceId: cdn.id }] } },
    });
    const messaging = await testPrisma.businessService.create({
      data: { name: 'Messaging', members: { create: [{ serviceId: mail.id }] } },
    });
    await testPrisma.statusPageBusinessService.createMany({
      data: [
        { statusPageId: page.id, businessServiceId: checkout.id, order: 0 },
        { statusPageId: page.id, businessServiceId: messaging.id, order: 1 },
      ],
    });
    return { page, api, cdn, mail, checkout, messaging };
  }

  it('shows an override until it lapses, then the sweep clears it and the computed status returns', async () => {
    const { page, checkout } = await groupedPage();
    const now = new Date();
    const until = new Date(now.getTime() + 60 * 60_000);
    const result = await setStatusPageBusinessServiceOverride(
      page.id,
      checkout.id,
      { status: 'MAINTENANCE', until: until.toISOString() },
      { actor: admin },
      now
    );
    expect(result).toMatchObject({ status: 'MAINTENANCE', until: until.toISOString() });
    expect(await rebuildStatusPageSnapshot(page.id)).toBe(true);
    let row = (await readStatusPageSnapshot(page.id))?.businessServices?.find(
      item => item.id === checkout.id
    );
    expect(row?.status).toBe('MAINTENANCE');

    // Nothing has lapsed yet.
    expect(await expireStatusPageBusinessServiceOverrides(now)).toEqual({ expired: 0 });
    const later = new Date(until.getTime() + 1000);
    expect(await expireStatusPageBusinessServiceOverrides(later)).toEqual({ expired: 1 });
    const mapping = await testPrisma.statusPageBusinessService.findFirstOrThrow({
      where: { statusPageId: page.id, businessServiceId: checkout.id },
    });
    expect(mapping).toMatchObject({ statusOverride: null, statusOverrideUntil: null });
    const audits = await testPrisma.auditLog.findMany({
      where: { entityType: 'STATUS_PAGE', entityId: page.id },
      select: { action: true },
    });
    expect(audits.map(audit => audit.action).sort()).toEqual([
      'status_page.business_service_override_expired',
      'status_page.business_service_override_set',
    ]);

    expect(await rebuildStatusPageSnapshot(page.id)).toBe(true);
    row = (await readStatusPageSnapshot(page.id))?.businessServices?.find(
      item => item.id === checkout.id
    );
    expect(row?.status).toBe('OPERATIONAL');
  });

  it('rejects overrides beyond 30 days, unknown statuses and services not on the page', async () => {
    const { page, checkout } = await groupedPage();
    const far = new Date(Date.now() + 31 * 86_400_000).toISOString();
    await expect(
      setStatusPageBusinessServiceOverride(
        page.id,
        checkout.id,
        { status: 'MAJOR_OUTAGE', until: far },
        { actor: admin }
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      setStatusPageBusinessServiceOverride(page.id, checkout.id, { status: 'UNKNOWN' }, { actor: admin })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const other = await testPrisma.businessService.create({ data: { name: 'Elsewhere' } });
    await expect(
      setStatusPageBusinessServiceOverride(page.id, other.id, { status: null }, { actor: admin })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const responder = await createTestUser({ role: 'USER' });
    await expect(
      setStatusPageBusinessServiceOverride(
        page.id,
        checkout.id,
        { status: null },
        { actor: { id: responder.id, role: 'USER', status: 'ACTIVE', teamIds: [] } }
      )
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('publishes updates that name business services and lists them on incident cards', async () => {
    const { page, api, mail, checkout, messaging } = await groupedPage();
    const now = Date.now();
    await testPrisma.statusPageAnnouncement.create({
      data: {
        statusPageId: page.id,
        title: 'Mail provider upgrade',
        message: 'Planned work',
        type: 'MAINTENANCE',
        startDate: new Date(now - 60_000),
        endDate: new Date(now + 60 * 60_000),
        publishAt: new Date(now - 60_000),
        affectedBusinessServiceIds: [messaging.id],
      },
    });
    const incident = await createTestIncident('Card payments failing', api.id, {
      visibility: 'PUBLIC',
      urgency: 'HIGH',
    });
    await testPrisma.statusPageAnnouncement.create({
      data: {
        statusPageId: page.id,
        title: 'Investigating card failures',
        message: 'Looking into it',
        type: 'INCIDENT',
        startDate: new Date(now - 60_000),
        publishAt: new Date(now - 60_000),
        incidentId: incident.id,
        affectedBusinessServiceIds: [checkout.id],
      },
    });
    expect(await rebuildStatusPageSnapshot(page.id)).toBe(true);
    const snapshot = await readStatusPageSnapshot(page.id);

    // The maintenance named only the business service; its member counts as in maintenance.
    expect(snapshot?.services.find(service => service.id === mail.id)?.status).toBe('MAINTENANCE');
    expect(snapshot?.businessServices?.find(item => item.id === messaging.id)?.status).toBe(
      'MAINTENANCE'
    );
    const maintenance = snapshot?.maintenance?.find(item => item.title === 'Mail provider upgrade');
    expect(maintenance?.affectedBusinessServices).toEqual([{ id: messaging.id, name: 'Messaging' }]);
    expect(maintenance?.affectedServices?.map(service => service.id)).toEqual([mail.id]);

    const card = snapshot?.incidents.find(item => item.id === incident.id);
    expect(card?.businessServices).toEqual([{ id: checkout.id, name: 'Checkout' }]);
  });

  it('hides a business service or its members per page and keeps the display name', async () => {
    const { page, checkout, messaging } = await groupedPage();
    await testPrisma.statusPageBusinessService.update({
      where: {
        statusPageId_businessServiceId: { statusPageId: page.id, businessServiceId: checkout.id },
      },
      data: { displayName: 'Buying things', showMembers: false },
    });
    await testPrisma.statusPageBusinessService.update({
      where: {
        statusPageId_businessServiceId: { statusPageId: page.id, businessServiceId: messaging.id },
      },
      data: { showOnPage: false },
    });
    expect(await rebuildStatusPageSnapshot(page.id)).toBe(true);
    const rows = (await readStatusPageSnapshot(page.id))?.businessServices ?? [];
    expect(rows.map(row => [row.name, row.showMembers])).toEqual([['Buying things', false]]);
  });
});
