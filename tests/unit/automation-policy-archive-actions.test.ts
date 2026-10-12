import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), transition: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ assertAdmin: mocks.admin }));
vi.mock('@/lib/escalation/policy-lifecycle', () => ({ transitionPolicyArchive: mocks.transition }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { setPolicyArchived } from '@/app/(app)/policies/actions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ id: 'admin' });
});

it.each([true, false])('denies unauthorized lifecycle mutation (archived=%s)', async archived => {
  mocks.admin.mockRejectedValue(new Error('Admin required'));
  await expect(setPolicyArchived('policy', archived)).rejects.toThrow('Admin required');
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});

it('rejects forged state and empty identifiers before entering the lifecycle transaction', async () => {
  await expect(setPolicyArchived('', true)).rejects.toThrow();
  await expect(setPolicyArchived('policy', 'true' as unknown as boolean)).rejects.toThrow();
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});
