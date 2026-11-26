import { beforeEach, describe, expect, it } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  createTestUser,
  linkServiceToStatusPage,
} from '../helpers/test-db';
import {
  createBusinessService,
  deleteBusinessService,
  updateBusinessService,
} from '@/lib/business-services/commands';
import type { AuthorizationActor } from '@/lib/authorization-policy';

describe('business-service changes keep status-page publication in step (P1)', () => {
  let admin: AuthorizationActor;

  beforeEach(async () => {
    await resetDatabase();
    const user = await createTestUser({ role: 'ADMIN' });
    admin = { id: user.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
  });

  async function setup() {
    const page = await createTestStatusPage({ enabled: true });
    const a = await createTestService('Alpha');
    const b = await createTestService('Beta');
    const direct = await createTestService('Direct');
    const bs = await createBusinessService(
      { name: 'Checkout', memberServiceIds: [a.id, b.id] },
      { actor: admin }
    );
    await testPrisma.statusPageBusinessService.create({
      data: { statusPageId: page.id, businessServiceId: bs.id, order: 0 },
    });
    await linkServiceToStatusPage(page.id, direct.id); // a direct selection
    return { page, a, b, direct, bs };
  }

  const published = async (pageId: string) =>
    (
      await testPrisma.statusPageService.findMany({
        where: { statusPageId: pageId },
        select: { serviceId: true, viaBusinessService: true },
      })
    ).map(row => `${row.serviceId}:${row.viaBusinessService}`);

  it('unpublishes members of a deleted business service but keeps direct selections', async () => {
    const { page, a, b, direct, bs } = await setup();
    await testPrisma.statusPageService.createMany({
      data: [
        { statusPageId: page.id, serviceId: a.id, viaBusinessService: true },
        { statusPageId: page.id, serviceId: b.id, viaBusinessService: true },
      ],
      skipDuplicates: true,
    });
    await deleteBusinessService(bs.id, { actor: admin });
    expect(await published(page.id)).toEqual([`${direct.id}:false`]);
  });

  it('keeps a member that another business service on the page still contains', async () => {
    const { page, a, b, bs } = await setup();
    const other = await createBusinessService(
      { name: 'Other', memberServiceIds: [a.id] },
      { actor: admin }
    );
    await testPrisma.statusPageBusinessService.create({
      data: { statusPageId: page.id, businessServiceId: other.id, order: 1 },
    });
    await testPrisma.statusPageService.createMany({
      data: [a, b].map(s => ({ statusPageId: page.id, serviceId: s.id, viaBusinessService: true })),
      skipDuplicates: true,
    });
    await deleteBusinessService(bs.id, { actor: admin });
    const rows = await published(page.id);
    expect(rows).toContain(`${a.id}:true`);
    expect(rows).not.toContain(`${b.id}:true`);
  });

  it('publishes a newly added member and drops a removed one on update', async () => {
    const { page, a, b, bs } = await setup();
    const c = await createTestService('Gamma');
    await updateBusinessService(bs.id, { memberServiceIds: [a.id, c.id] }, { actor: admin });
    const rows = await published(page.id);
    expect(rows).toContain(`${c.id}:true`);
    expect(rows).not.toContain(`${b.id}:true`);
  });
});
