import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const transaction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ default: { $transaction: transaction } }));
vi.mock('@/lib/auth-control/actor', () => ({ lockControlActor: vi.fn() }));
vi.mock('@/lib/auth-control/origin', () => ({ recoveryOrigin: vi.fn() }));
vi.mock('@/lib/auth-control/emergency', () => ({ digest: vi.fn(), secret: vi.fn() }));
vi.mock('@/lib/auth-control/emergency-password', () => ({
  generateEmergencyPassword: vi.fn().mockResolvedValue({ password: 'pw', hash: 'hash' }),
}));
vi.mock('@/lib/auth-control/security-events', () => ({ securityEvent: vi.fn() }));

import { changeEmergencyMethod } from '@/lib/auth-control/emergency-management';
import type { ControlActor } from '@/lib/auth-control/actor';

const custodian = { kind: 'emergency', id: 'account-1' } as unknown as ControlActor;
const admin = {
  kind: 'admin',
  id: 'admin-1',
  tokenVersion: 1,
  authenticatedAt: Date.now(),
} as ControlActor;

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockResolvedValue({ id: 'account-1' });
});

describe('changeEmergencyMethod self lock-out', () => {
  it('refuses a custodian switching their own identity to a hardware key', async () => {
    await expect(
      changeEmergencyMethod(custodian, 'account-1', 'WEBAUTHN', false, 1)
    ).rejects.toThrow('no way back in');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('still lets a custodian rotate their own password, which hands them a new one', async () => {
    await changeEmergencyMethod(custodian, 'account-1', 'PASSWORD', false, 1);

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('still lets an administrator or another custodian switch the identity to a hardware key', async () => {
    await changeEmergencyMethod(admin, 'account-1', 'WEBAUTHN', false, 1);
    await changeEmergencyMethod(
      { kind: 'emergency', id: 'account-2' } as unknown as ControlActor,
      'account-1',
      'WEBAUTHN',
      false,
      1
    );

    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
