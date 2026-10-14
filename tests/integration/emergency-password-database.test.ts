// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import {
  createEmergencyAccount,
  changeEmergencyMethod,
  disableEmergencyAccount,
  emergencyReadiness,
} from '@/lib/auth-control/emergency-management';
import { passwordEmergencyLogin, getEmergencySession } from '@/lib/auth-control/emergency';
import * as passwordCrypto from '@/lib/auth-control/emergency-password';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';
import { type ControlActor } from '@/lib/auth-control/actor';
import { evaluateAuthenticationPolicy } from '@/lib/authentication-policy-evaluator';
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/auth-control/origin', () => ({
  recoveryOrigin: vi.fn().mockResolvedValue('https://recovery.example.test'),
}));
vi.mock('@/lib/auth-abuse', () => ({
  consumeAuthRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const actor: ControlActor = {
  kind: 'admin',
  id: 'password-recovery-certifier',
  tokenVersion: 0,
  authenticatedAt: Date.now(),
  method: 'credentials',
};
suite('independent password emergency identities against PostgreSQL', () => {
  const ids: string[] = [];
  let first: Awaited<ReturnType<typeof createEmergencyAccount>>;
  let second: Awaited<ReturnType<typeof createEmergencyAccount>>;
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw Error('Isolated certification database required');
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    await prisma.user.upsert({
      where: { id: actor.id },
      create: {
        id: actor.id,
        email: 'password-recovery@example.test',
        name: 'Fixture',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      update: { role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0 },
    });
    const policy = await prisma.authenticationPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', mode: 'PASSWORD_ONLY', legacySnapshot: {} },
      update: {
        mode: 'PASSWORD_ONLY',
        passwordRecoveryUserId: null,
        passwordRecoveryExpiresAt: null,
        legacyEmergencyEmail: null,
        passwordSessionMinVersion: 0,
        oidcSessionMinVersion: 0,
      },
    });
    actor.issuedUnderPolicyVersion = policy.version;
    first = await createEmergencyAccount(actor, 'Password custodian one', true, 'PASSWORD');
    ids.push(first.id);
    second = await createEmergencyAccount(actor, 'Password custodian two', true, 'PASSWORD');
    ids.push(second.id);
  });
  afterAll(async () => {
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'PASSWORD_ONLY', recoveryDegradedAt: null },
    });
    await prisma.emergencySession.deleteMany({ where: { emergencyAccountId: { in: ids } } });
    await prisma.emergencyCredential.deleteMany({ where: { emergencyAccountId: { in: ids } } });
    await prisma.emergencyAccount.deleteMany({ where: { id: { in: ids } } });
  });
  it('stores salted hashes, never counts enrollment as a drill, and preserves existing user authentication', async () => {
    expect(first.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const account = await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: first.id } });
    expect(account.passwordHash).toMatch(/^scrypt-32768-8-3\$/);
    expect(account.passwordHash).not.toContain(first.password);
    expect(account.status).toBe('ENROLLING');
    expect((await emergencyReadiness(prisma)).some(value => value.id === first.id)).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).passwordHash
    ).toBeNull();
  });
  it('uses identical failures for unknown IDs, wrong passwords and ordinary User identifiers', async () => {
    const failures: string[] = [];
    for (const [id, password] of [
      [first.id, 'wrong'],
      ['unknown-recovery', first.password!],
      [actor.id, first.password!],
    ]) {
      try {
        await passwordEmergencyLogin(id, password, 'fixture-network');
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
    expect(failures).toHaveLength(3);
    expect(new Set(failures).size).toBe(1);
  });
  it('verifies two independent password drills while SSO Required still rejects ordinary password sign-in', async () => {
    await passwordEmergencyLogin(first.id, first.password!, 'fixture-network');
    await passwordEmergencyLogin(second.id, second.password!, 'fixture-network');
    expect((await emergencyReadiness(prisma)).filter(value => ids.includes(value.id))).toHaveLength(
      2
    );
    const policy = await prisma.authenticationPolicy.findUniqueOrThrow({
      where: { id: 'default' },
    });
    expect(
      evaluateAuthenticationPolicy({ ...policy, mode: 'SSO_REQUIRED' }, 'PASSWORD_LOGIN').allowed
    ).toBe(false);
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'SSO_REQUIRED' },
    });
    const login = await passwordEmergencyLogin(first.id, first.password!, 'fixture-network');
    expect((await getEmergencySession(login.token))?.emergencyAccountId).toBe(first.id);
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'PASSWORD_ONLY' },
    });
  });
  it('reauthenticates with token rotation without extending absolute expiry and enforces idle expiry', async () => {
    const login = await passwordEmergencyLogin(first.id, first.password!, 'fixture-network');
    const fresh = await passwordEmergencyLogin(
      first.id,
      first.password!,
      'fixture-network',
      login.token
    );
    expect(fresh.token).not.toBe(login.token);
    expect(fresh.expiresAt).toEqual(login.expiresAt);
    expect(await getEmergencySession(login.token)).toBeNull();
    const session = await getEmergencySession(fresh.token);
    expect(session).not.toBeNull();
    await prisma.emergencySession.update({
      where: { id: session!.id },
      data: { lastActivityAt: new Date(Date.now() - 901000) },
    });
    expect(await getEmergencySession(fresh.token)).toBeNull();
    await expect(
      passwordEmergencyLogin(first.id, first.password!, 'fixture-network', fresh.token)
    ).rejects.toThrow('Emergency sign-in failed');
  });
  it('reserves independent reauthentication budgets and fails closed when network admission rejects', async () => {
    const login = await passwordEmergencyLogin(first.id, first.password!, 'fixture-network');
    await passwordEmergencyLogin(first.id, first.password!, 'fixture-network', login.token);
    expect(consumeAuthRateLimit).toHaveBeenCalledWith(
      'emergency:password:reauth',
      expect.any(String),
      10,
      300000
    );
    vi.mocked(consumeAuthRateLimit).mockResolvedValueOnce({ allowed: false } as never);
    await expect(
      passwordEmergencyLogin(first.id, first.password!, 'fixture-network')
    ).rejects.toThrow('Emergency sign-in failed');
  });
  it('guards readiness, revokes sessions on compromise rotation and resets drill readiness', async () => {
    const login = await passwordEmergencyLogin(first.id, first.password!, 'fixture-network');
    const account = await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: first.id } });
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'SSO_REQUIRED' },
    });
    // Emergency authority remains valid even when ordinary password auth is disabled.
    const session = await getEmergencySession(login.token);
    const recoveryActor: ControlActor = {
      kind: 'emergency',
      id: first.id,
      sessionId: session!.id,
      credentialVersion: session!.credentialVersion,
      authenticatedAt: Date.now(),
      sessionTokenHash: session!.tokenHash,
    };
    await expect(
      changeEmergencyMethod(recoveryActor, first.id, 'PASSWORD', false, account.credentialVersion)
    ).rejects.toThrow('replacement');
    const rotated = await changeEmergencyMethod(
      recoveryActor,
      first.id,
      'PASSWORD',
      true,
      account.credentialVersion
    );
    expect(rotated.password).not.toBe(first.password);
    expect(await getEmergencySession(login.token)).toBeNull();
    await expect(
      passwordEmergencyLogin(first.id, first.password!, 'fixture-network')
    ).rejects.toThrow('Emergency sign-in failed');
    expect(
      (await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } }))
        .recoveryDegradedAt
    ).not.toBeNull();
    await passwordEmergencyLogin(first.id, rotated.password!, 'fixture-network');
    expect(
      (await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } }))
        .recoveryDegradedAt
    ).toBeNull();
    first.password = rotated.password;
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'PASSWORD_ONLY' },
    });
  });
  it('combines one password drill with one current hardware-key drill for readiness', async () => {
    const now = new Date();
    const key = await prisma.emergencyAccount.create({
      data: {
        displayName: 'Hardware readiness fixture',
        independenceConfirmedAt: now,
        status: 'ACTIVE',
        verifiedAt: now,
        verifiedCredentialVersion: 1,
        verifiedOrigin: 'https://recovery.example.test',
        credentials: {
          create: {
            credentialId: `mixed-key-${Date.now()}`,
            publicKey: Buffer.from('readiness-only-fixture'),
            counter: 0,
            displayName: 'Hardware fixture',
            deviceType: 'singleDevice',
            backedUp: false,
          },
        },
      },
    });
    ids.push(key.id);
    const ready = await emergencyReadiness(prisma);
    expect(ready.some(value => value.id === key.id)).toBe(true);
    expect(ready.some(value => value.id === first.id)).toBe(true);
    await prisma.emergencyAccount.update({
      where: { id: key.id },
      data: { verifiedAt: new Date(Date.now() - 91 * 86400000) },
    });
    expect((await emergencyReadiness(prisma)).some(value => value.id === key.id)).toBe(false);
  });
  it('serializes competing rotations and supports switching to hardware enrollment and disabling', async () => {
    const account = await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: second.id } });
    const outcomes = await Promise.allSettled([
      changeEmergencyMethod(actor, second.id, 'PASSWORD', false, account.credentialVersion),
      changeEmergencyMethod(actor, second.id, 'WEBAUTHN', false, account.credentialVersion),
    ]);
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const current = await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: second.id } });
    await changeEmergencyMethod(actor, second.id, 'WEBAUTHN', false, current.credentialVersion);
    expect(
      (await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: second.id } })).passwordHash
    ).toBeNull();
    await expect(
      passwordEmergencyLogin(second.id, second.password!, 'fixture-network')
    ).rejects.toThrow('Emergency sign-in failed');
    await disableEmergencyAccount(actor, second.id);
    expect(
      (await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: second.id } })).status
    ).toBe('DISABLED');
  });
  it('rejects a password verified before concurrent rotation or disablement commits', async () => {
    for (const disable of [false, true]) {
      let ready!: () => void;
      let release!: () => void;
      const admitted = new Promise<void>(resolve => {
        ready = resolve;
      });
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      const verify = passwordCrypto.verifyEmergencyPassword;
      const intercepted = vi
        .spyOn(passwordCrypto, 'verifyEmergencyPassword')
        .mockImplementationOnce(async (...args) => {
          const valid = await verify(...args);
          ready();
          await held;
          return valid;
        });
      const pending = passwordEmergencyLogin(first.id, first.password!, 'fixture-network');
      // Attach rejection handling before releasing the verifier to avoid unhandled rejection noise.
      const result = pending.then(
        () => 'unexpected-success',
        () => 'rejected'
      );
      try {
        await admitted;
        const account = await prisma.emergencyAccount.findUniqueOrThrow({
          where: { id: first.id },
        });
        if (disable) await disableEmergencyAccount(actor, first.id);
        else
          first.password = (
            await changeEmergencyMethod(
              actor,
              first.id,
              'PASSWORD',
              false,
              account.credentialVersion
            )
          ).password;
      } finally {
        release();
        intercepted.mockRestore();
      }
      expect(await result).toBe('rejected');
    }
  });
});
