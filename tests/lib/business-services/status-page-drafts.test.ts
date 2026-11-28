import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  fanout: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/prisma', () => {
  const tx = {
    statusPageAnnouncement: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      deleteMany: mocks.deleteMany,
      updateMany: mocks.updateMany,
    },
  };
  return { default: { $transaction: (run: (client: typeof tx) => unknown) => run(tx) } };
});
vi.mock('@/lib/audit', () => ({ emitAuditEvent: mocks.audit }));
vi.mock('@/lib/status-pages/announcement-commands', () => ({
  createAnnouncementFanoutJob: mocks.fanout,
}));

import {
  draftStatusPageUpdates,
  statusDraftId,
  statusDraftKind,
  statusDraftText,
} from '@/lib/business-services/status-page-drafts';

const bs = { id: 'bs1', name: 'Checkout', autoPublishStatusUpdates: false };
const now = new Date('2026-12-02T10:00:00Z');

describe('status-page drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(null);
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.create.mockImplementation(async ({ data }) => ({
      id: data.id,
      notificationGeneration: 0,
    }));
  });

  it('drafts only when impact starts or ends', () => {
    expect(statusDraftKind('OPERATIONAL', 'DEGRADED')).toBe('IMPACT');
    expect(statusDraftKind('MAINTENANCE', 'MAJOR_OUTAGE')).toBe('IMPACT');
    expect(statusDraftKind('PARTIAL_OUTAGE', 'OPERATIONAL')).toBe('RECOVERY');
    expect(statusDraftKind('DEGRADED', 'MAJOR_OUTAGE')).toBeNull();
    expect(statusDraftKind('OPERATIONAL', 'MAINTENANCE')).toBeNull();
    expect(statusDraftKind('MAJOR_OUTAGE', 'MAINTENANCE')).toBeNull();
  });

  it('words drafts in public, plain language', () => {
    expect(statusDraftText('IMPACT', 'Checkout', 'PARTIAL_OUTAGE')).toEqual({
      type: 'INCIDENT',
      title: 'Checkout: partial outage',
      message:
        'We are investigating a partial outage affecting Checkout. We will post an update as we learn more.',
    });
    expect(statusDraftText('IMPACT', 'Checkout', 'DEGRADED').type).toBe('WARNING');
    expect(statusDraftText('RECOVERY', 'Checkout', 'OPERATIONAL').title).toBe(
      'Checkout has recovered'
    );
  });

  it('writes an inactive draft per page with a deterministic id, audited, without fan-out', async () => {
    const written = await draftStatusPageUpdates({
      businessService: bs,
      pages: [{ statusPageId: 'p1', displayName: 'Payments checkout' }, { statusPageId: 'p2' }],
      from: 'OPERATIONAL',
      to: 'MAJOR_OUTAGE',
      changeKey: 'k1',
      now,
    });
    expect(written).toBe(2);
    const first = mocks.create.mock.calls[0][0].data;
    expect(first).toMatchObject({
      id: statusDraftId('k1', 'p1'),
      statusPageId: 'p1',
      isActive: false,
      title: 'Payments checkout: major outage',
      affectedBusinessServiceIds: ['bs1'],
      notificationTiming: 'ON_PUBLISH',
    });
    expect(first.id.startsWith('bsd_')).toBe(true);
    expect(mocks.fanout).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'status_page.announcement.auto_drafted' }),
      expect.anything()
    );
  });

  it('gives each page its own draft id, page id and page-specific name for one transition', async () => {
    await draftStatusPageUpdates({
      businessService: bs,
      pages: [{ statusPageId: 'p1' }, { statusPageId: 'p2', displayName: 'Partner checkout' }],
      from: 'OPERATIONAL',
      to: 'DEGRADED',
      changeKey: 'k9',
      now,
    });
    const data = mocks.create.mock.calls.map(c => c[0].data);
    expect(data.map(d => d.statusPageId)).toEqual(['p1', 'p2']);
    expect(data[0].id).not.toBe(data[1].id);
    expect(data[1].title).toBe('Partner checkout: degraded performance');
  });

  it('is idempotent: a retried transition finds its draft and writes nothing', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'existing' });
    expect(
      await draftStatusPageUpdates({
        businessService: bs,
        pages: [{ statusPageId: 'p1' }],
        from: 'OPERATIONAL',
        to: 'DEGRADED',
        changeKey: 'k1',
        now,
      })
    ).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('publishes and queues the subscriber fan-out when the business service opted in', async () => {
    await draftStatusPageUpdates({
      businessService: { ...bs, autoPublishStatusUpdates: true },
      pages: [{ statusPageId: 'p1' }],
      from: 'OPERATIONAL',
      to: 'DEGRADED',
      changeKey: 'k2',
      now,
    });
    expect(mocks.create.mock.calls[0][0].data.isActive).toBe(true);
    expect(mocks.fanout).toHaveBeenCalledWith(expect.anything(), {
      announcementId: statusDraftId('k2', 'p1'),
      statusPageId: 'p1',
      scheduledAt: now,
      generation: 0,
      deliveryMode: 'ALL_ELIGIBLE',
    });
    expect(mocks.audit.mock.calls[0][0].action).toBe('status_page.announcement.auto_published');
  });

  it('a published recovery ends the published impact notice for that business service', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await draftStatusPageUpdates({
      businessService: { ...bs, autoPublishStatusUpdates: true },
      pages: [{ statusPageId: 'p1' }],
      from: 'MAJOR_OUTAGE',
      to: 'OPERATIONAL',
      changeKey: 'k4',
      now,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        statusPageId: 'p1',
        id: { startsWith: 'bsd_' },
        isActive: true,
        endDate: null,
        affectedBusinessServiceIds: { array_contains: ['bs1'] },
      },
      data: { endDate: now },
    });
    expect(mocks.audit.mock.calls[0][0].metadata.closedNotices).toBe(1);
  });

  it('a recovery draft leaves the published impact notice for the admin to close', async () => {
    await draftStatusPageUpdates({
      businessService: bs,
      pages: [{ statusPageId: 'p1' }],
      from: 'MAJOR_OUTAGE',
      to: 'OPERATIONAL',
      changeKey: 'k5',
      now,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('on recovery withdraws unpublished impact drafts and drafts the recovery', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    await draftStatusPageUpdates({
      businessService: bs,
      pages: [{ statusPageId: 'p1' }],
      from: 'MAJOR_OUTAGE',
      to: 'OPERATIONAL',
      changeKey: 'k3',
      now,
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        statusPageId: 'p1',
        id: { startsWith: 'bsd_' },
        isActive: false,
        affectedBusinessServiceIds: { array_contains: ['bs1'] },
      },
    });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ type: 'UPDATE', endDate: now });
    expect(mocks.audit.mock.calls[0][0].metadata.withdrawnDrafts).toBe(1);
  });
});
