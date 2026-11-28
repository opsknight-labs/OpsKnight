import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    customRole: { findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn(), updateMany: vi.fn() },
  };
  return {
    tx,
    prisma: { $transaction: vi.fn(async (operation: (client: unknown) => unknown) => operation(tx)) },
    logAudit: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjection: vi.fn(),
  invalidateSessionSecurityProjections: vi.fn(),
}));

import { archiveCustomRole } from '@/lib/access/admin';

describe('archiving a custom role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.user.findMany.mockResolvedValue([{ id: 'holder-1' }]);
  });

  it('frees the unique name so the role can be created again', async () => {
    mocks.tx.customRole.findUnique.mockResolvedValue({
      id: 'role-1',
      name: 'Runbook operators',
      archivedAt: null,
    });

    await archiveCustomRole('admin-1', 'role-1');

    expect(mocks.tx.customRole.update).toHaveBeenCalledWith({
      where: { id: 'role-1' },
      data: { archivedAt: expect.any(Date), name: 'Runbook operators (archived role-1)' },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'custom_role.archived',
        details: { name: 'Runbook operators', unassignedUsers: 1 },
      }),
      mocks.tx
    );
  });
});
