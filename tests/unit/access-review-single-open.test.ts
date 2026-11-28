import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findMany: vi.fn() },
    accessGrant: { findMany: vi.fn() },
    systemSettings: { findUnique: vi.fn() },
  },
  tx: {
    accessReview: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    systemSettings: { updateMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
  logAudit: vi.fn(),
  createInAppNotifications: vi.fn(),
  runSerializableTransaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: mocks.createInAppNotifications,
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));
vi.mock('@/lib/access/settings', () => ({ invalidateAccessControlSettings: vi.fn() }));

import { maybeStartScheduledAccessReview, startAccessReview } from '@/lib/access/admin';

describe('one open access review at a time', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runSerializableTransaction.mockImplementation(
      async (operation: (tx: unknown) => unknown) => operation(mocks.tx)
    );
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.prisma.accessGrant.findMany.mockResolvedValue([]);
    mocks.tx.accessReview.create.mockResolvedValue({ id: 'new-review' });
    mocks.tx.user.findMany.mockResolvedValue([]);
  });

  it('refuses a manual start while another review is open', async () => {
    mocks.tx.accessReview.findMany.mockResolvedValue([{ id: 'old-review' }]);

    await expect(startAccessReview('admin-1', { name: 'Second' })).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
    });

    expect(mocks.tx.accessReview.create).not.toHaveBeenCalled();
    expect(mocks.tx.accessReview.updateMany).not.toHaveBeenCalled();
  });

  it('closes stale open reviews with an audit row when a scheduled review starts', async () => {
    mocks.prisma.systemSettings.findUnique.mockResolvedValue({
      accessReviewIntervalDays: 30,
      accessReviewLastStartedAt: new Date('2026-01-01T00:00:00Z'),
    });
    mocks.tx.accessReview.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);

    const result = await maybeStartScheduledAccessReview(new Date('2026-03-01T00:00:00Z'));

    expect(result).toEqual({ started: true });
    expect(mocks.tx.accessReview.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1', 'old-2'] }, status: 'OPEN' },
      data: { status: 'CANCELLED', completedAt: expect.any(Date) },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access_review.superseded', entityId: 'old-1' }),
      mocks.tx
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access_review.superseded', entityId: 'old-2' }),
      mocks.tx
    );
    expect(mocks.tx.accessReview.create).toHaveBeenCalledTimes(1);
  });

  it('starts normally when nothing is open', async () => {
    mocks.tx.accessReview.findMany.mockResolvedValue([]);

    await startAccessReview('admin-1', { name: 'Q1' });

    expect(mocks.tx.accessReview.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.accessReview.create).toHaveBeenCalledTimes(1);
  });
});
