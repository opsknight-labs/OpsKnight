import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  emitAuditEvent: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    statusPageAnnouncement: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    notification: { updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: mocks.emitAuditEvent }));

import { endAnnouncement } from '@/lib/status-pages/announcement-commands';

const row = (isActive: boolean) => ({
  id: 'ann-1',
  title: 'Planned maintenance',
  message: 'Database upgrade',
  type: 'MAINTENANCE',
  isActive,
  startDate: new Date('2026-12-01T00:00:00.000Z'),
  endDate: null,
  createdAt: new Date('2026-11-30T00:00:00.000Z'),
  updatedAt: new Date('2026-11-30T00:00:00.000Z'),
});
const input = {
  statusPageId: 'page-1',
  announcementId: 'ann-1',
  actorId: 'user-1',
  source: 'API',
} as const;
const run = (value = input) =>
  endAnnouncement(value, mocks.tx as unknown as Prisma.TransactionClient);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.statusPageAnnouncement.updateMany.mockResolvedValue({ count: 1 });
});

describe('endAnnouncement', () => {
  it('sets a live announcement inactive, cancels unsent notices and audits it', async () => {
    mocks.tx.statusPageAnnouncement.findFirst
      .mockResolvedValueOnce(row(true))
      .mockResolvedValueOnce({ notificationGeneration: 1 });
    mocks.tx.statusPageAnnouncement.update.mockResolvedValue(row(false));

    const ended = await run();

    expect(ended.isActive).toBe(false);
    expect(mocks.tx.statusPageAnnouncement.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ann-1' }, data: { isActive: false } })
    );
    // Lock, then the pending fan-out jobs are deleted; undelivered notices are skipped.
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.tx.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) })
    );
    expect(mocks.emitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'status_page.announcement.ended',
        actor: { type: 'USER', id: 'user-1' },
        target: { type: 'STATUS_PAGE', id: 'page-1' },
      }),
      mocks.tx
    );
  });

  it('answers the same success when it is already ended, without a second audit row', async () => {
    mocks.tx.statusPageAnnouncement.findFirst.mockResolvedValue(row(false));

    const ended = await run();

    expect(ended.isActive).toBe(false);
    expect(mocks.tx.statusPageAnnouncement.update).not.toHaveBeenCalled();
    expect(mocks.emitAuditEvent).not.toHaveBeenCalled();
  });

  it('is a 404 for an announcement that is not on that status page', async () => {
    mocks.tx.statusPageAnnouncement.findFirst.mockResolvedValue(null);

    await expect(run()).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(mocks.tx.statusPageAnnouncement.update).not.toHaveBeenCalled();
  });
});
