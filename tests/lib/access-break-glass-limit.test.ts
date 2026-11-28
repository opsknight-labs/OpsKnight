import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    accessGrant: { count: vi.fn(), create: vi.fn() },
  },
  outerGrantCount: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: mocks.userFindUnique },
    accessGrant: { count: mocks.outerGrantCount },
    $transaction: async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/in-app-notifications', () => ({ createInAppNotifications: vi.fn() }));
vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjection: vi.fn(),
}));
vi.mock('@/lib/users/admin-invariants', () => ({ advanceUserSessionVersions: vi.fn() }));
vi.mock('@/lib/access/settings', () => ({
  getAccessControlSettings: vi.fn().mockResolvedValue({
    breakGlassEnabled: true,
    breakGlassMaxMinutes: 240,
  }),
}));

import { activateBreakGlass } from '@/lib/access/grants';

describe('activateBreakGlass daily limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Una',
      email: 'una@example.com',
      role: 'USER',
      status: 'ACTIVE',
    });
  });

  it('counts recent grants inside the transaction, after locking the user row', async () => {
    const order: string[] = [];
    mocks.tx.$queryRaw.mockImplementation(async () => order.push('lock'));
    mocks.tx.accessGrant.count.mockImplementation(async () => {
      order.push('count');
      return 3;
    });

    await expect(
      activateBreakGlass({ userId: 'user-1', reason: 'Production database is down', minutes: 30 })
    ).rejects.toMatchObject({ code: 'ACCESS_REQUEST_LIMITED' });

    expect(order).toEqual(['lock', 'count']);
    expect(mocks.outerGrantCount).not.toHaveBeenCalled();
    expect(mocks.tx.accessGrant.create).not.toHaveBeenCalled();
  });
});
