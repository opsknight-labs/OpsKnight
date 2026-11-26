import { beforeEach, describe, expect, it } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  linkServiceToStatusPage,
} from '../helpers/test-db';
import { resolveAnnouncementAudience } from '@/lib/status-page-notifications';

describe('announcement audience (P3)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('is scoped-but-empty for a memberless business service, so nobody is mailed', async () => {
    const page = await createTestStatusPage({ enabled: true });
    const empty = await testPrisma.businessService.create({ data: { name: 'Empty' } });
    expect(await resolveAnnouncementAudience(page.id, undefined, [empty.id])).toEqual({
      scoped: true,
      serviceIds: [],
    });
  });

  it('expands only members published on this page', async () => {
    const page = await createTestStatusPage({ enabled: true });
    const published = await createTestService('Published');
    const unpublished = await createTestService('Unpublished');
    await linkServiceToStatusPage(page.id, published.id);
    const bs = await testPrisma.businessService.create({
      data: {
        name: 'Both',
        members: { create: [{ serviceId: published.id }, { serviceId: unpublished.id }] },
      },
    });
    expect(await resolveAnnouncementAudience(page.id, [], [bs.id])).toEqual({
      scoped: true,
      serviceIds: [published.id],
    });
  });

  it('is unscoped when it names nothing', async () => {
    const page = await createTestStatusPage({ enabled: true });
    expect(await resolveAnnouncementAudience(page.id, null, null)).toEqual({
      scoped: false,
      serviceIds: [],
    });
  });
});
