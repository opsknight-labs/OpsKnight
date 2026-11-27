import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  findMany: vi.fn(),
  permissions: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({ businessServiceMember: { findMany: mocks.findMany } }),
  },
}));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: mocks.permissions,
  getCurrentAuthorizationActor: vi.fn(async () => ({
    id: 'u1',
    role: 'RESPONDER',
    status: 'ACTIVE',
    teamIds: [],
  })),
}));
vi.mock('@/lib/business-services/commands', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/business-services/commands')>()),
  updateBusinessService: mocks.update,
}));

const { addBusinessServiceMembersAction } = await import('@/app/(app)/services/business/actions');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions.mockResolvedValue({ isResponderOrAbove: true });
  mocks.findMany.mockResolvedValue([
    { serviceId: 'a', critical: true },
    { serviceId: 'b', critical: false },
  ]);
});

describe('addBusinessServiceMembersAction', () => {
  it('keeps existing members and adds only new ones, leaving the critical flags alone', async () => {
    const result = await addBusinessServiceMembersAction('bs1', {
      serviceIds: ['a', 'c'],
      critical: true,
    });
    expect(result).toEqual({ ok: true, id: 'bs1' });
    expect(mocks.update).toHaveBeenCalledWith(
      'bs1',
      { memberServiceIds: ['a', 'b', 'c'] },
      expect.anything(),
      expect.anything()
    );
  });

  it('adds non-critical services to the non-critical set too', async () => {
    await addBusinessServiceMembersAction('bs1', { serviceIds: ['c'], critical: false });
    expect(mocks.update.mock.calls[0][1]).toEqual({
      memberServiceIds: ['a', 'b', 'c'],
      nonCriticalServiceIds: ['b', 'c'],
    });
  });

  it('refuses viewers below Responder and empty selections', async () => {
    mocks.permissions.mockResolvedValueOnce({ isResponderOrAbove: false });
    expect(
      await addBusinessServiceMembersAction('bs1', { serviceIds: ['c'], critical: true })
    ).toMatchObject({ ok: false });
    expect(
      await addBusinessServiceMembersAction('bs1', { serviceIds: [], critical: true })
    ).toMatchObject({ ok: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
