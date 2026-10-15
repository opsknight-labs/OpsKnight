// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-control/actor', () => ({
  lockControlActor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/auth-control/security-events', () => ({
  securityEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/auth', () => ({ resetAuthOptionsCache: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { user: { findUniqueOrThrow: vi.fn() }, $transaction: vi.fn() },
}));

import prisma from '@/lib/prisma';
import { restorePasswordAccess } from '@/lib/auth-control/recovery';
import type { ControlActor } from '@/lib/auth-control/actor';
import { securityEvent } from '@/lib/auth-control/security-events';
import { lockControlActor } from '@/lib/auth-control/actor';

const admin: ControlActor = {
  kind: 'admin',
  id: 'admin-self',
  tokenVersion: 2,
  authenticatedAt: Date.now(),
  method: 'oidc',
};
const password = 'Correct horse battery staple 2026!';

describe('administrator self-service password access recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: 'admin-self',
      email: 'admin@example.test',
      name: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      tokenVersion: 2,
    } as never);
  });

  it('refuses to let a normal administrator restore another administrator', async () => {
    await expect(
      restorePasswordAccess(admin, 'other-admin', password, 7, 'RESTORE PASSWORD ACCESS')
    ).rejects.toThrow('only for your own account');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets a normal administrator restore their own account under the fresh-session lock', async () => {
    const tx = {
      authenticationPolicy: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'default',
          mode: 'SSO_REQUIRED',
          version: 7,
          oidcSessionMinVersion: 3,
          enforcedAt: new Date(),
        }),
        update: vi.fn().mockResolvedValue({ mode: 'SSO_REQUIRED', version: 8 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'admin-self',
          email: 'admin@example.test',
          role: 'ADMIN',
          status: 'ACTIVE',
          tokenVersion: 2,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      userToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      emergencySession: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async callback =>
      (callback as unknown as (value: typeof tx) => unknown)(tx)
    );

    const result = await restorePasswordAccess(
      admin,
      'admin-self',
      password,
      7,
      'RESTORE PASSWORD ACCESS'
    );

    expect(result).toEqual({ mode: 'SSO_REQUIRED', version: 8 });
    // Freshness, session validity and permissions are enforced by the shared control lock.
    expect(lockControlActor).toHaveBeenCalledWith(tx, admin);
    // Administrator-only scope keeps SSO Required for everyone else.
    expect(tx.authenticationPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'SSO_REQUIRED',
          passwordRecoveryUserId: 'admin-self',
        }),
      })
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-self' },
      data: { passwordHash: expect.any(String), tokenVersion: { increment: 1 } },
    });
    expect(securityEvent).toHaveBeenCalledWith(
      tx,
      'auth.recovery.password.restored',
      'admin-self',
      expect.objectContaining({ initiatedBy: 'administrator-self-service' })
    );
  });
});
