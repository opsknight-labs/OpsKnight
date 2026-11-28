import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resetUserNotificationEndpoint: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/user-notification-endpoints', () => ({
  resetUserNotificationEndpoint: mocks.resetUserNotificationEndpoint,
}));
vi.mock('@/lib/authentication-policy', () => ({ assertPasswordOperationAllowed: vi.fn() }));
vi.mock('@/lib/access/step-up', () => ({ assertRecentAuthentication: vi.fn() }));
vi.mock('@/lib/password-reset', () => ({ sendPasswordChangedNotice: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ __esModule: true, default: {} }));

import { resetNotificationEndpoint } from '@/app/(app)/settings/actions';

describe('resetNotificationEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' });
  });

  it("resets the signed-in person's own contact for the channel", async () => {
    mocks.resetUserNotificationEndpoint.mockResolvedValue(true);

    await expect(resetNotificationEndpoint('EMAIL')).resolves.toEqual({ success: true });

    expect(mocks.resetUserNotificationEndpoint).toHaveBeenCalledWith({
      userId: 'user-1',
      channel: 'EMAIL',
      actorId: 'user-1',
    });
  });

  it('refuses a channel that is not a personal contact', async () => {
    await expect(resetNotificationEndpoint('WEBHOOK')).resolves.toEqual({
      success: false,
      error: 'Choose a valid channel.',
    });
    expect(mocks.resetUserNotificationEndpoint).not.toHaveBeenCalled();
  });

  it('says so when the contact is not blocked', async () => {
    mocks.resetUserNotificationEndpoint.mockResolvedValue(false);

    await expect(resetNotificationEndpoint('SMS')).resolves.toEqual({
      success: false,
      error: 'This contact is not blocked.',
    });
  });
});
