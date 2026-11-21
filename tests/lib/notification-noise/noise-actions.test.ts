import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  getCurrentUser: vi.fn(),
  notificationNoiseEnabled: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { user: { update: mocks.update } } }));
vi.mock('@/lib/rbac', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/notification-noise/loader', () => ({
  notificationNoiseEnabled: mocks.notificationNoiseEnabled,
}));

import { updateBundlePreference } from '@/app/(app)/settings/noise-actions';

describe('bundling opt-in action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1' });
    mocks.notificationNoiseEnabled.mockResolvedValue(true);
  });

  it('saves the signed-in person own preference only', async () => {
    await expect(updateBundlePreference(true)).resolves.toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { bundleLowUrgencyPages: true },
    });
  });

  it('refuses to turn bundling on while the area is off, but always lets it be turned off', async () => {
    mocks.notificationNoiseEnabled.mockResolvedValue(false);
    await expect(updateBundlePreference(true)).resolves.toMatchObject({ success: false });
    expect(mocks.update).not.toHaveBeenCalled();
    await expect(updateBundlePreference(false)).resolves.toEqual({ success: true });
  });

  it('rejects an unauthenticated caller and a non-boolean value', async () => {
    await expect(updateBundlePreference('yes' as never)).resolves.toMatchObject({ success: false });
    mocks.getCurrentUser.mockRejectedValue(new Error('Unauthorized'));
    await expect(updateBundlePreference(true)).resolves.toMatchObject({ success: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
