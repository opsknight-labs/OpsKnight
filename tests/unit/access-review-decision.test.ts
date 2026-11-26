import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    accessReviewItem: { findUnique: vi.fn(), update: vi.fn() },
  },
  logAudit: vi.fn(),
  runSerializableTransaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

import { decideAccessReviewItem } from '@/lib/access/admin';

const item = (status: 'OPEN' | 'COMPLETED') => ({
  id: 'item-1',
  reviewId: 'rev-1',
  userId: 'subject-1',
  subjectType: 'ORG_ROLE',
  subjectLabel: 'Responder',
  decision: 'KEEP',
  reviewerId: 'reviewer-1',
  review: { status },
});

describe('deciding an access review item', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runSerializableTransaction.mockImplementation(
      async (operation: (tx: unknown) => unknown) => operation(mocks.tx)
    );
  });

  it('runs inside a serializable transaction and refuses a decision after completion', async () => {
    mocks.tx.accessReviewItem.findUnique.mockResolvedValue(item('COMPLETED'));

    await expect(decideAccessReviewItem('reviewer-2', 'item-1', 'REVOKE')).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
    });

    expect(mocks.runSerializableTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.accessReviewItem.update).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('audits the decision with the one it replaced', async () => {
    mocks.tx.accessReviewItem.findUnique.mockResolvedValue(item('OPEN'));

    await decideAccessReviewItem('reviewer-2', 'item-1', 'REVOKE', 'no longer needed');

    expect(mocks.tx.accessReviewItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({ decision: 'REVOKE', reviewerId: 'reviewer-2' }),
      })
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'access_review.item_decided',
        entityId: 'rev-1',
        actorId: 'reviewer-2',
        details: expect.objectContaining({
          decision: 'REVOKE',
          previousDecision: 'KEEP',
          previousReviewerId: 'reviewer-1',
        }),
      }),
      mocks.tx
    );
  });
});
