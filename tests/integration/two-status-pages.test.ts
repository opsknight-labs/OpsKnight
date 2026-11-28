/** Two status pages against real PostgreSQL: default invariant, slug uniqueness, per-page drafts. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createStatusPage, deleteStatusPage } from '@/lib/status-pages/admin';
import { draftStatusPageUpdates } from '@/lib/business-services/status-page-drafts';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

describe('two status pages', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('keeps one default, rejects a duplicate slug and a third page, and drafts per page', async () => {
    const first = await createStatusPage({ name: 'Community', slug: 'community' });
    const second = await createStatusPage({ name: 'Partners', slug: 'partners' });
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    await expect(createStatusPage({ name: 'Third', slug: 'third' })).rejects.toMatchObject({
      code: 'STATUS_PAGE_LIMIT_REACHED',
    });
    expect(await db.statusPage.count({ where: { isDefault: true } })).toBe(1);

    const [a, b] = await Promise.all(
      ['Checkout', 'Billing'].map(name =>
        db.businessService.create({ data: { name, autoPublishStatusUpdates: false } })
      )
    );
    await db.statusPageBusinessService.createMany({
      data: [
        { statusPageId: first.id, businessServiceId: a!.id },
        { statusPageId: second.id, businessServiceId: b!.id },
      ],
    });
    for (const [svc, pageId] of [
      [a!, first.id],
      [b!, second.id],
    ] as const) {
      await draftStatusPageUpdates({
        businessService: { id: svc.id, name: svc.name, autoPublishStatusUpdates: false },
        pages: [{ statusPageId: pageId }],
        from: 'OPERATIONAL',
        to: 'MAJOR_OUTAGE',
        changeKey: `k-${svc.id}`,
      });
    }
    const drafts = await db.statusPageAnnouncement.findMany({ select: { statusPageId: true } });
    expect(drafts.map(d => d.statusPageId).sort()).toEqual([first.id, second.id].sort());
  });

  it('deleting the default page promotes the remaining page', async () => {
    const first = await createStatusPage({ name: 'Community', slug: 'community' });
    const second = await createStatusPage({ name: 'Partners', slug: 'partners' });
    await db.statusPage.update({ where: { id: second.id }, data: { enabled: true } });
    await deleteStatusPage(first.id);
    const left = await db.statusPage.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: second.id, isDefault: true });
  });
});
