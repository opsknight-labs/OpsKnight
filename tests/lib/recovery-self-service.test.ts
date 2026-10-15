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
import { relaxRequiredToOptional, restorePasswordAccess } from '@/lib/auth-control/recovery';
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

describe('emergency recovery stepping SSO Required back to SSO Optional', () => {
  const emergency: ControlActor = {
    kind: 'emergency',
    id: 'recovery-1',
    sessionId: 'session-1',
    credentialVersion: 1,
    authenticatedAt: Date.now(),
    sessionTokenHash: 'hash',
  };
  const transaction = (mode: string, enabled = true) => {
    const tx = {
      authenticationPolicy: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'default', mode, version: 12 }),
        update: vi.fn().mockResolvedValue({ mode: 'SSO_OPTIONAL', version: 13 }),
      },
      oidcConfig: { findUnique: vi.fn().mockResolvedValue({ enabled, configVersion: 4 }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async callback =>
      (callback as unknown as (value: typeof tx) => unknown)(tx)
    );
    return tx;
  };
  beforeEach(() => vi.clearAllMocks());

  it('relaxes Required to Optional under a fresh recovery lock, without touching passwords', async () => {
    const tx = transaction('SSO_REQUIRED');
    expect(await relaxRequiredToOptional(emergency, 12)).toEqual({
      mode: 'SSO_OPTIONAL',
      version: 13,
    });
    expect(lockControlActor).toHaveBeenCalledWith(tx, emergency);
    expect(tx.authenticationPolicy.update).toHaveBeenCalledWith({
      where: { id: 'default' },
      data: expect.objectContaining({ mode: 'SSO_OPTIONAL', enforcedAt: null }),
    });
    expect(securityEvent).toHaveBeenCalledWith(
      tx,
      'auth.policy.changed',
      'recovery-1',
      expect.objectContaining({ oldMode: 'SSO_REQUIRED', recoveryOnly: true })
    );
  });

  it.each([
    ['a normal administrator', admin],
    ['legacy recovery', { ...emergency, kind: 'legacy' } as ControlActor],
  ])('is not available to %s', async (_label, actor) => {
    await expect(relaxRequiredToOptional(actor, 12)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('only steps down from SSO Required and needs an enabled provider', async () => {
    transaction('PASSWORD_ONLY');
    await expect(relaxRequiredToOptional(emergency, 12)).rejects.toThrow(
      'only while SSO Required is active'
    );
    transaction('SSO_REQUIRED', false);
    await expect(relaxRequiredToOptional(emergency, 12)).rejects.toThrow('Enable an OIDC provider');
  });

  it('rejects a stale policy version', async () => {
    transaction('SSO_REQUIRED');
    await expect(relaxRequiredToOptional(emergency, 11)).rejects.toThrow('Policy changed');
  });
});
