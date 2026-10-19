// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as audit from '@/lib/audit';
import { updatePassword } from '@/app/(app)/settings/actions';
import { getCurrentUser } from '@/lib/rbac';
import { changeAuthenticationMode } from '@/app/(app)/settings/system/authentication-actions';
import {
  assertPasswordOperationAllowed,
  getAuthenticationPolicy,
  checkAuthenticationPolicy,
} from '@/lib/authentication-policy';

const integration = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const actorId = 'enterprise-sso-policy-certifier';
const password = 'Local certification passphrase October 2026';
vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
  resetAuthOptionsCache: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(async () =>
    prisma.user.findUniqueOrThrow({ where: { id: 'enterprise-sso-policy-certifier' } })
  ),
  getUserPermissions: vi.fn().mockResolvedValue({ isAdmin: true, capabilities: ['admin.manage'] }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => ({
    user: { id: 'enterprise-sso-policy-certifier', tokenVersion: 0 },
    authenticatedAt: Date.now(),
    authenticationMethod: 'credentials',
    issuedUnderPolicyVersion: (
      await prisma.authenticationPolicy.findUnique({ where: { id: 'default' } })
    )?.version,
  })),
}));
vi.mock('@/lib/auth-abuse', () => ({
  consumeAuthRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

integration('authoritative authentication policy in PostgreSQL', () => {
  beforeAll(async () => {
    // This suite deliberately tests missing policy state and must never target a user's DB.
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test')) {
      throw new Error('Use the isolated enterprise_sso_test database for this suite.');
    }
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', 'true');
    vi.stubEnv('AUTH_BREAK_GLASS_ENABLED', 'false');
    await prisma.oidcConfig.deleteMany();
    await prisma.authenticationPolicy.deleteMany();
    await prisma.authenticationPolicyImport.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'auth.policy.' } } });
    await prisma.user.upsert({
      where: { id: actorId },
      update: {
        tokenVersion: 0,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash(password, 12),
      },
      create: {
        id: actorId,
        email: 'sso-policy-certifier@example.test',
        name: 'SSO Policy Certifier',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
  });
  afterAll(async () => {
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'PASSWORD_ONLY' },
    });
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it('serializes concurrent migration across separate database connections', async () => {
    const policies = await Promise.all(Array.from({ length: 8 }, () => getAuthenticationPolicy()));
    expect(policies.every(policy => policy.version === 1 && policy.mode === 'PASSWORD_ONLY')).toBe(
      true
    );
    expect(await prisma.authenticationPolicy.count()).toBe(1);
    expect(await prisma.authenticationPolicyImport.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'auth.policy.migrated' } })).toBe(1);
  });

  it('rejects old password sessions across replicas immediately and after returning to optional', async () => {
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: {
        mode: 'SSO_REQUIRED',
        version: 2,
        passwordSessionMinVersion: 2,
      },
    });
    expect(
      (await checkAuthenticationPolicy('SESSION', {}, { method: 'credentials', policyVersion: 1 }))
        .allowed
    ).toBe(false);
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'SSO_OPTIONAL', version: 3 },
    });
    expect(
      (await checkAuthenticationPolicy('SESSION', {}, { method: 'credentials', policyVersion: 1 }))
        .allowed
    ).toBe(false);
    expect(
      (await checkAuthenticationPolicy('SESSION', {}, { method: 'credentials', policyVersion: 3 }))
        .allowed
    ).toBe(true);
  });

  it('holds password completion behind policy enforcement and denies it after the enforcing transaction commits', async () => {
    let releaseEnforcement!: () => void;
    let acquiredEnforcement!: () => void;
    const release = new Promise<void>(resolve => {
      releaseEnforcement = resolve;
    });
    const acquired = new Promise<void>(resolve => {
      acquiredEnforcement = resolve;
    });
    const enforcement = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "AuthenticationPolicy" WHERE "id" = 'default' FOR UPDATE`;
      await tx.authenticationPolicy.update({
        where: { id: 'default' },
        data: { mode: 'SSO_REQUIRED', version: 4, passwordSessionMinVersion: 4 },
      });
      acquiredEnforcement();
      await release;
    });
    await acquired;
    const passwordWrite = prisma.$transaction(async tx => {
      await assertPasswordOperationAllowed(tx);
      throw new Error('Password write must never become reachable.');
    });
    // Attach rejection handling before releasing the other transaction.
    const result = passwordWrite.then(
      () => 'unexpected success',
      error => (error as Error).message
    );
    releaseEnforcement();
    await enforcement;
    expect(await result).toContain('disabled by authentication policy');
  });

  it('does not reinterpret environment controls when the authoritative policy row is missing', async () => {
    const saved = await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    await prisma.authenticationPolicy.delete({ where: { id: 'default' } });
    try {
      await expect(getAuthenticationPolicy()).rejects.toThrow('environment fallback is prohibited');
    } finally {
      await prisma.authenticationPolicy.create({
        data: {
          ...saved,
          legacySnapshot:
            saved.legacySnapshot === null
              ? Prisma.JsonNull
              : (saved.legacySnapshot as Prisma.InputJsonValue),
        },
      });
    }
  });

  it('allows only one of two simultaneous administrator edits using the same expected version', async () => {
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'SSO_OPTIONAL', version: 10 },
    });
    const input = {
      mode: 'PASSWORD_ONLY',
      expectedVersion: 10,
      confirmation: 'CHANGE AUTHENTICATION POLICY',
      currentPassword: password,
    };
    const outcomes = await Promise.allSettled([
      changeAuthenticationMode(input),
      changeAuthenticationMode(input),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    const policy = await prisma.authenticationPolicy.findUniqueOrThrow({
      where: { id: 'default' },
    });
    expect(policy.version).toBe(11);
    expect(policy.oidcSessionMinVersion).toBe(11);
    expect(await prisma.auditLog.count({ where: { action: 'auth.policy.changed' } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actorId } })).id).toBe(actorId);
  });

  it('rolls the policy transition back if its mandatory audit cannot commit', async () => {
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'SSO_OPTIONAL', version: 12 },
    });
    const failure = vi
      .spyOn(audit, 'logAudit')
      .mockRejectedValueOnce(new Error('audit unavailable'));
    try {
      await expect(
        changeAuthenticationMode({
          mode: 'PASSWORD_ONLY',
          expectedVersion: 12,
          confirmation: 'CHANGE AUTHENTICATION POLICY',
          currentPassword: password,
        })
      ).rejects.toThrow('audit unavailable');
      expect(
        await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } })
      ).toMatchObject({ mode: 'SSO_OPTIONAL', version: 12 });
    } finally {
      failure.mockRestore();
    }
  });
  it('does not let an in-flight password change overwrite a concurrent administrator reset', async () => {
    const snapshot = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    vi.mocked(getCurrentUser).mockResolvedValueOnce(snapshot);
    let hashing!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => {
      hashing = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const originalHash = bcrypt.hash;
    const candidate = 'Cobalt sheltered passage October2026!';
    const changedHash = await originalHash('Administrator recovery replacement October2026!', 12);
    const intercept = vi.spyOn(bcrypt, 'hash').mockImplementation(((
      value: string,
      salt: string | number,
      callback?: (error: Error | null, result: string) => void,
      progress?: (percent: number) => void
    ) => {
      if (callback) return originalHash(value, salt, callback, progress);
      if (value !== candidate) return originalHash(value, salt);
      return originalHash(value, salt).then(async result => {
        hashing();
        await gate;
        return result;
      });
    }) as typeof bcrypt.hash);
    try {
      const input = new FormData();
      input.set('currentPassword', password);
      input.set('newPassword', candidate);
      input.set('confirmPassword', candidate);
      const changing = updatePassword({}, input);
      const stage = await Promise.race([
        entered.then(() => ({ hashing: true as const })),
        changing.then(result => ({ hashing: false as const, result })),
      ]);
      if (!stage.hashing)
        throw new Error(
          `Password change finished before hashing: ${stage.result.error ?? 'unexpected success'}`
        );
      await prisma.user.update({
        where: { id: actorId },
        data: { passwordHash: changedHash, tokenVersion: { increment: 1 } },
      });
      release();
      const result = await changing;
      expect(result.error).toBeTruthy();
      const current = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
      expect(current.passwordHash).toBe(changedHash);
      expect(current.tokenVersion).toBe(snapshot.tokenVersion + 1);
    } finally {
      release();
      intercept.mockRestore();
    }
  });
});
