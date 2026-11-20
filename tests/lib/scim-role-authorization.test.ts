import { beforeEach, describe, expect, it, vi } from 'vitest';
const checks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  getControlActor: vi.fn(),
  findFirstOrThrow: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({ assertAdmin: checks.assertAdmin }));
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: checks.getControlActor,
  lockControlActor: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    scimGroup: { findFirstOrThrow: checks.findFirstOrThrow },
    $transaction: checks.transaction,
  },
}));
import {
  getScimRoleMappingAction,
  previewScimRoleMappingAction,
  saveScimRoleMappingAction,
} from '@/app/(app)/settings/system/scim-role-actions';
const input = { connectorId: 'c', groupId: 'g', role: 'ADMIN' };
beforeEach(() => {
  vi.resetAllMocks();
});
describe('SCIM role mapping administration authorization', () => {
  it('blocks unauthorized reads and previews before touching directory data', async () => {
    checks.assertAdmin.mockRejectedValue(new Error('Unauthorized'));
    expect(await getScimRoleMappingAction({ connectorId: 'c', groupId: 'g' })).toEqual({
      scimError: 'Unauthorized',
    });
    expect(await previewScimRoleMappingAction(input)).toEqual({ scimError: 'Unauthorized' });
    expect(checks.findFirstOrThrow).not.toHaveBeenCalled();
    expect(checks.transaction).not.toHaveBeenCalled();
  });
  it('requires a fresh administrator and excludes recovery actors from mapping writes', async () => {
    checks.getControlActor.mockResolvedValue({ kind: 'emergency', id: 'recovery' });
    expect(await saveScimRoleMappingAction({ ...input, revision: 'a'.repeat(64) })).toEqual({
      scimError: 'Administrator sign-in required.',
    });
    expect(checks.getControlActor).toHaveBeenCalledWith(true);
    expect(checks.transaction).not.toHaveBeenCalled();
  });
  it('strictly rejects arbitrary role values and extra authority fields', async () => {
    for (const invalid of [
      { ...input, role: 'OWNER' },
      { ...input, approvedBy: 'forged' },
    ]) {
      expect(
        await saveScimRoleMappingAction({ ...invalid, revision: 'a'.repeat(64) })
      ).toHaveProperty('scimError');
    }
    expect(checks.getControlActor).not.toHaveBeenCalled();
    expect(checks.transaction).not.toHaveBeenCalled();
  });
});
