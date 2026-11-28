import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  assertRecentAuthentication: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
  logAudit: vi.fn(),
  userFindUnique: vi.fn(),
  txUserFindUnique: vi.fn(),
  txUserUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/access/step-up', () => ({
  assertRecentAuthentication: mocks.assertRecentAuthentication,
}));
vi.mock('@/lib/password-reset', () => ({
  sendPasswordChangedNotice: mocks.sendPasswordChangedNotice,
}));
vi.mock('@/lib/authentication-policy', () => ({ assertPasswordOperationAllowed: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjection: vi.fn(),
}));
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(async (value: string) => value === 'Old-Passw0rd!x'),
    hash: vi.fn(async () => 'new-hash'),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { updatePassword } from '@/app/(app)/settings/actions';

const NEW_PASSWORD = 'Str0ng-Passw0rd!x';

function form(current: string, next = NEW_PASSWORD) {
  const data = new FormData();
  data.set('currentPassword', current);
  data.set('newPassword', next);
  data.set('confirmPassword', next);
  return data;
}

const profile = {
  name: 'Una',
  email: 'una@example.com',
  phoneNumber: null,
  smsNotificationsEnabled: false,
};

describe('updatePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1', tokenVersion: 4 });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.assertRecentAuthentication.mockResolvedValue(undefined);
    mocks.txUserFindUnique.mockResolvedValue({
      passwordHash: 'old-hash',
      tokenVersion: 4,
      status: 'ACTIVE',
    });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: vi.fn(),
        user: { findUnique: mocks.txUserFindUnique, update: mocks.txUserUpdate },
      })
    );
  });

  it('stops guessing the current password once the attempt limit is reached', async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });

    const result = await updatePassword({}, form('wrong'));

    expect(result.error).toMatch(/Too many/);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it('needs a fresh sign-in before an SSO-only account sets its first local password', async () => {
    mocks.userFindUnique.mockResolvedValue({ passwordHash: null, ...profile });
    mocks.assertRecentAuthentication.mockRejectedValue(new AppError({ code: 'STEP_UP_REQUIRED' }));

    const result = await updatePassword({}, form(''));

    expect(result.error).toMatch(/sign in again/i);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('notifies the user after a successful change', async () => {
    mocks.userFindUnique.mockResolvedValue({ passwordHash: 'old-hash', ...profile });

    const result = await updatePassword({}, form('Old-Passw0rd!x'));

    expect(result).toEqual({ success: true });
    expect(mocks.assertRecentAuthentication).not.toHaveBeenCalled();
    expect(mocks.sendPasswordChangedNotice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', email: 'una@example.com' }),
      expect.stringContaining('settings:user-1:'),
      expect.any(Date)
    );
  });
});
