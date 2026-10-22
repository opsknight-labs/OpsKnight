import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ admin: vi.fn(), status: vi.fn(), retry: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ assertAdmin: mocks.admin }));
vi.mock('@/lib/automation/privacy-cleanup', () => ({
  getAutomationPrivacyCleanupStatus: mocks.status,
  retryAutomationPrivacyCleanup: mocks.retry,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import {
  readAutomationPrivacyCleanupStatus,
  retryAutomationPrivacyCleanupAction,
} from '@/app/(app)/settings/system/automation-actions';
beforeEach(() => vi.clearAllMocks());
it.each(['RESPONDER', 'AUDITOR', 'USER', 'unauthenticated'])(
  'denies cleanup inspection and retry before database access for %s',
  async () => {
    mocks.admin.mockRejectedValue(new Error('Forbidden'));
    await expect(readAutomationPrivacyCleanupStatus()).rejects.toThrow('Forbidden');
    await expect(retryAutomationPrivacyCleanupAction()).rejects.toThrow('Forbidden');
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
  }
);
it('attributes retry to the authenticated administrator and exposes only the status result', async () => {
  mocks.admin.mockResolvedValue({ id: 'authenticated-admin' });
  mocks.retry.mockResolvedValue({ status: 'PENDING' });
  mocks.status.mockResolvedValue({ status: 'COMPLETE' });
  expect(await retryAutomationPrivacyCleanupAction()).toEqual({ status: 'PENDING' });
  expect(mocks.retry).toHaveBeenCalledWith('authenticated-admin');
  expect(await readAutomationPrivacyCleanupStatus()).toEqual({ status: 'COMPLETE' });
});
