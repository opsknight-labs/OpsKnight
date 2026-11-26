import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanModifyService: vi.fn(),
  serviceFindUnique: vi.fn(),
  teamMemberFindUnique: vi.fn(),
  updateServiceWithAutomationPolicyGuard: vi.fn(),
  assertServiceNameAvailable: vi.fn(),
  logAudit: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ assertCanModifyService: mocks.assertCanModifyService }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: { findUnique: mocks.serviceFindUnique },
    teamMember: { findUnique: mocks.teamMemberFindUnique },
  },
}));
vi.mock('@/lib/automation/service-policy', () => ({
  updateServiceWithAutomationPolicyGuard: mocks.updateServiceWithAutomationPolicyGuard,
}));
vi.mock('@/lib/unique-names', () => ({
  assertServiceNameAvailable: mocks.assertServiceNameAvailable,
  UniqueNameConflictError: class UniqueNameConflictError extends Error {},
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { updateService } from '@/app/(app)/services/actions';

function form(teamId: string) {
  const data = new FormData();
  data.set('name', 'Checkout');
  data.set('description', '');
  data.set('region', '');
  data.set('slaTier', '');
  data.set('teamId', teamId);
  data.set('escalationPolicyId', '');
  return data;
}

describe('updateService team ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serviceFindUnique.mockResolvedValue({ teamId: 'team-a' });
    mocks.teamMemberFindUnique.mockResolvedValue({ id: 'member-1' });
    mocks.assertServiceNameAvailable.mockResolvedValue('Checkout');
  });

  it('stops a non-admin member of both teams from moving the service to the other team', async () => {
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1', role: 'RESPONDER' });

    await expect(updateService('svc-1', form('team-b'))).rejects.toThrow(
      /Only administrators can move a service/
    );
    expect(mocks.updateServiceWithAutomationPolicyGuard).not.toHaveBeenCalled();
  });

  it('stops a non-admin from clearing the owning team', async () => {
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1', role: 'RESPONDER' });

    await expect(updateService('svc-1', form(''))).rejects.toThrow(
      /Only administrators can move a service/
    );
    expect(mocks.updateServiceWithAutomationPolicyGuard).not.toHaveBeenCalled();
  });

  it('still lets a non-admin save other settings while the team is unchanged', async () => {
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1', role: 'RESPONDER' });

    await updateService('svc-1', form('team-a'));

    expect(mocks.updateServiceWithAutomationPolicyGuard).toHaveBeenCalledWith(
      'svc-1',
      expect.objectContaining({ teamId: 'team-a' })
    );
  });

  it('lets an administrator move the service', async () => {
    mocks.assertCanModifyService.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });

    await updateService('svc-1', form('team-b'));

    expect(mocks.updateServiceWithAutomationPolicyGuard).toHaveBeenCalledWith(
      'svc-1',
      expect.objectContaining({ teamId: 'team-b' })
    );
  });
});
