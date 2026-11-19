import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  enqueueCentralNotification: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: mocks.enqueueCentralNotification,
}));
vi.mock('@/lib/prisma', () => ({ __esModule: true, default: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { sendTestNotification } from '@/app/(app)/settings/actions';

const baseUser = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  phoneNumber: '+15555550100',
  smsNotificationsEnabled: true,
  voiceNotificationsEnabled: false,
  whatsappNotificationsEnabled: true,
};

describe('sendTestNotification abuse guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(baseUser);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.enqueueCentralNotification.mockResolvedValue({ id: 'n1' });
  });

  it('sends an SMS test when the channel is enabled and under the limit', async () => {
    await expect(sendTestNotification('SMS')).resolves.toEqual({ success: true });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('test-notification:user-1', 5, 60_000);
    expect(mocks.enqueueCentralNotification).toHaveBeenCalledTimes(1);
  });

  it('refuses a test call on a channel the user has switched off', async () => {
    const result = await sendTestNotification('VOICE');
    expect(result.success).toBe(false);
    expect(mocks.enqueueCentralNotification).not.toHaveBeenCalled();
  });

  it('refuses when the per-user test rate limit is exhausted', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: true });
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    const result = await sendTestNotification('SMS');
    expect(result).toEqual({ success: false, error: expect.stringMatching(/Too many/) });
    expect(mocks.enqueueCentralNotification).not.toHaveBeenCalled();
  });
});
