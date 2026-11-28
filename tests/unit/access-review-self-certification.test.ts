/* eslint-disable @typescript-eslint/no-explicit-any -- partial prisma mock */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
const settings = vi.hoisted(() => ({
  getAccessControlSettings: vi.fn().mockResolvedValue({ selfApprovalAllowed: true }),
  invalidateAccessControlSettings: vi.fn(),
}));
vi.mock('@/lib/access/settings', () => settings);

import { canSelfCertify, decideAccessReviewItem } from '@/lib/access/admin';

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.accessReviewItem = {
    findUnique: vi.fn().mockResolvedValue({
      id: 'item_1',
      reviewId: 'rev_1',
      userId: 'rev_user',
      subjectType: 'ROLE',
      subjectLabel: 'Admin',
      decision: null,
      reviewerId: null,
      review: { status: 'OPEN' },
    }),
    update: vi.fn().mockResolvedValue({}),
  };
});

describe('access review self-certification', () => {
  it('refuses your own item while another reviewer exists, even when request self-approval is allowed', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'other_admin' });
    await expect(decideAccessReviewItem('rev_user', 'item_1', 'KEEP')).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES',
    });
    expect(db.accessReviewItem.update).not.toHaveBeenCalled();
    await expect(canSelfCertify('rev_user')).resolves.toBe(false);
  });

  it('still lets the only reviewer certify their own item, and records it', async () => {
    db.user.findFirst.mockResolvedValue(null);
    await decideAccessReviewItem('rev_user', 'item_1', 'KEEP');
    expect(db.accessReviewItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ note: expect.stringContaining('no other reviewer') }),
      })
    );
    await expect(canSelfCertify('rev_user')).resolves.toBe(true);
  });
});
