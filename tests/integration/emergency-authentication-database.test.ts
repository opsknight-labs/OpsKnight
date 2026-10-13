// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';
import { restorePasswordAccess, repairCanonicalOrigin } from '@/lib/auth-control/recovery';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  createEmergencyAccount,
  registrationOptions,
  verifyRegistration,
  revokeEmergencyCredential,
  emergencyReadiness,
} from '@/lib/auth-control/emergency-management';
import {
  emergencyLoginOptions,
  verifyEmergencyLogin,
  getEmergencySession,
  deliberateEmergencyActivity,
  legacyEmergencyLogin,
  recordEmergencyFailure,
  digest,
  secret,
} from '@/lib/auth-control/emergency';
import { lockControlActor, type ControlActor } from '@/lib/auth-control/actor';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import {
  processAuthenticationAlerts,
  processAuthenticationAlertFanout,
  securityEvent,
} from '@/lib/auth-control/security-events';

vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: vi.fn().mockRejectedValue(new Error('delivery queue unavailable')),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(), resetAuthOptionsCache: vi.fn() }));
vi.mock('@/lib/auth-control/origin', () => ({
  authenticationOrigin: vi.fn().mockResolvedValue('https://recovery.example.test'),
  recoveryOrigin: vi.fn().mockResolvedValue('https://recovery.example.test'),
}));
vi.mock('@/lib/auth-abuse', () => ({
  consumeAuthRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const actor: ControlActor = {
  kind: 'admin',
  id: 'emergency-db-certifier',
  tokenVersion: 0,
  authenticatedAt: Date.now(),
  method: 'credentials',
  issuedUnderPolicyVersion: 900,
};
const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = key.publicKey.export({ format: 'jwk' });
const credentialId = randomBytes(32);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest();
const cose = isoCBOR.encode(
  new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x!, 'base64url')],
    [-3, Buffer.from(jwk.y!, 'base64url')],
  ])
);
function registration(challenge: string): RegistrationResponseJSON {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    hash('recovery.example.test'),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    length,
    credentialId,
    Buffer.from(cose),
  ]);
  return {
    id: b64(credentialId),
    rawId: b64(credentialId),
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(
        Buffer.from(
          JSON.stringify({
            type: 'webauthn.create',
            challenge,
            origin: 'https://recovery.example.test',
          })
        )
      ),
      attestationObject: b64(
        isoCBOR.encode(
          new Map<string, string | Map<string, never> | Uint8Array>([
            ['fmt', 'none'],
            ['attStmt', new Map<string, never>()],
            ['authData', authData],
          ])
        )
      ),
      transports: ['usb'],
    },
  };
}
function assertion(
  challenge: string,
  counter: number,
  flags = 5,
  origin = 'https://recovery.example.test',
  rp = 'recovery.example.test'
): AuthenticationResponseJSON {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  const authData = Buffer.concat([hash(rp), Buffer.from([flags]), count]);
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const signature = sign('sha256', Buffer.concat([authData, hash(clientData)]), key.privateKey);
  return {
    id: b64(credentialId),
    rawId: b64(credentialId),
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(clientData),
      authenticatorData: b64(authData),
      signature: b64(signature),
    },
  };
}

suite('independent emergency authentication with signed WebAuthn responses and PostgreSQL', () => {
  let accountId: string;
  let token: string;
  const measurements: Record<string, unknown> = {};
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw new Error('Isolated enterprise_sso_test DB required.');
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', appUrl: 'https://recovery.example.test' },
      update: {},
    });
    await prisma.user.upsert({
      where: { id: actor.id },
      create: {
        id: actor.id,
        email: 'emergency-certifier@example.test',
        name: 'Emergency Certifier',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      update: { role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0 },
    });
    await prisma.authenticationPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', mode: 'PASSWORD_ONLY', version: 900, legacySnapshot: {} },
      update: {
        passwordRecoveryUserId: null,
        passwordRecoveryExpiresAt: null,
        recoveryDegradedAt: null,
        mode: 'PASSWORD_ONLY',
        version: 900,
        passwordSessionMinVersion: 0,
        oidcSessionMinVersion: 0,
      },
    });
  });
  afterAll(async () => {
    await prisma.emergencySession.deleteMany({ where: { emergencyAccountId: accountId } });
    await prisma.emergencyCredential.deleteMany({ where: { emergencyAccountId: accountId } });
    if (accountId) await prisma.emergencyAccount.delete({ where: { id: accountId } });
    await prisma.$disconnect();
    if (measurements.recoveryAvailability && measurements.alertFanout) {
      mkdirSync('plans/certification', { recursive: true });
      writeFileSync(
        'plans/certification/enterprise-sso-2.1-resilience.json',
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            scope:
              'Isolated PostgreSQL and signed local WebAuthn fixtures. No live IdP, physical keys or email provider.',
            ...measurements,
          },
          null,
          2
        ) + '\n'
      );
    }
  });
  it('stores only public credentials, and requires a separate sign-in drill for readiness', async () => {
    const account = await createEmergencyAccount(actor, 'Independent custodian', true);
    accountId = account.id;
    const flow = await registrationOptions(actor, accountId);
    await verifyRegistration(
      actor,
      flow.challengeId,
      flow.browserToken,
      'Hardware key',
      registration(flow.options.challenge)
    );
    const stored = await prisma.emergencyAccount.findUniqueOrThrow({
      where: { id: accountId },
      include: { credentials: true },
    });
    expect(stored.status).toBe('ENROLLING');
    expect(stored.verifiedAt).toBeNull();
    expect(stored.credentials[0].publicKey).toEqual(Buffer.from(cose));
    await expect(
      verifyRegistration(
        actor,
        flow.challengeId,
        flow.browserToken,
        'Replay',
        registration(flow.options.challenge)
      )
    ).rejects.toThrow('expired or used');
  });
  it('verifies a real signature once, issues a separate recovery session, and persists alerts', async () => {
    const flow = await emergencyLoginOptions(accountId, '127.0.0.1');
    const response = assertion(flow.options.challenge, 1);
    const result = await verifyEmergencyLogin(
      flow.challengeId,
      flow.browserToken,
      response,
      '127.0.0.1'
    );
    token = result.token;
    const session = await getEmergencySession(token);
    expect(session?.legacyUserId).toBeNull();
    expect(session?.account?.status).toBe('ACTIVE');
    expect(await prisma.user.findUnique({ where: { id: accountId } })).toBeNull();
    expect(
      await prisma.authenticationAlert.count({
        where: {
          eventId: {
            in: (
              await prisma.emergencyAccessEvent.findMany({
                where: { emergencyAccountId: accountId, eventType: 'auth.emergency.login.success' },
                select: { id: true },
              })
            ).map(event => event.id),
          },
        },
      })
    ).toBeGreaterThan(0);
    await expect(
      verifyEmergencyLogin(flow.challengeId, flow.browserToken, response, '127.0.0.1')
    ).rejects.toThrow('sign-in failed');
  });
  it.each([
    ['foreign browser', 5, 'https://recovery.example.test', 'recovery.example.test', true],
    ['wrong origin', 5, 'https://attacker.example.test', 'recovery.example.test', false],
    ['wrong RP', 5, 'https://recovery.example.test', 'attacker.example.test', false],
    [
      'missing user verification',
      1,
      'https://recovery.example.test',
      'recovery.example.test',
      false,
    ],
    ['synchronized passkey', 29, 'https://recovery.example.test', 'recovery.example.test', false],
  ])(
    'rejects %s without advancing credential counters',
    async (_name, flags, origin, rp, foreignBrowser) => {
      const flow = await emergencyLoginOptions(accountId, '127.0.0.1');
      await expect(
        verifyEmergencyLogin(
          flow.challengeId,
          foreignBrowser ? secret() : flow.browserToken,
          assertion(flow.options.challenge, 2, flags, origin, rp),
          '127.0.0.1'
        )
      ).rejects.toThrow('sign-in failed');
      expect(
        (
          await prisma.emergencyCredential.findUniqueOrThrow({
            where: { credentialId: b64(credentialId) },
          })
        ).counter
      ).toBe(BigInt(1));
    }
  );
  it('passive session reads never refresh idle time; explicit activity cannot revive expiry', async () => {
    const initial = await getEmergencySession(token);
    expect(initial).not.toBeNull();
    await getEmergencySession(token);
    expect(
      (await prisma.emergencySession.findUniqueOrThrow({ where: { tokenHash: digest(token) } }))
        .lastActivityAt
    ).toEqual(initial!.lastActivityAt);
    await deliberateEmergencyActivity(token);
    await prisma.emergencySession.update({
      where: { tokenHash: digest(token) },
      data: { lastActivityAt: new Date(Date.now() - 901000) },
    });
    await expect(deliberateEmergencyActivity(token)).rejects.toThrow('expired');
    expect(await getEmergencySession(token)).toBeNull();
  });
  it('absolute expiry revokes the recovery capability even with recent activity', async () => {
    const expiredToken = secret();
    const now = Date.now();
    await prisma.emergencySession.create({
      data: {
        tokenHash: digest(expiredToken),
        emergencyAccountId: accountId,
        credentialVersion: 2,
        createdAt: new Date(now - 7200000),
        expiresAt: new Date(now - 3600000),
        lastActivityAt: new Date(now),
      },
    });
    expect(await getEmergencySession(expiredToken)).toBeNull();
    expect(
      (
        await prisma.emergencySession.findUniqueOrThrow({
          where: { tokenHash: digest(expiredToken) },
        })
      ).revokedAt
    ).not.toBeNull();
  });
  it('reauthentication rotates the capability while preserving the absolute expiry', async () => {
    const flow = await emergencyLoginOptions(accountId, '127.0.0.1');
    const login = await verifyEmergencyLogin(
      flow.challengeId,
      flow.browserToken,
      assertion(flow.options.challenge, 2),
      '127.0.0.1'
    );
    const reauth = await emergencyLoginOptions(accountId, '127.0.0.1', login.token);
    const oldSession = await getEmergencySession(login.token);
    const oldActor: ControlActor = {
      kind: 'emergency',
      id: accountId,
      sessionId: oldSession!.id,
      credentialVersion: oldSession!.credentialVersion,
      authenticatedAt: oldSession!.authenticatedAt.getTime(),
      sessionTokenHash: digest(login.token),
    };
    const renewed = await verifyEmergencyLogin(
      reauth.challengeId,
      reauth.browserToken,
      assertion(reauth.options.challenge, 3),
      '127.0.0.1'
    );
    expect(renewed.expiresAt).toEqual(login.expiresAt);
    expect(await getEmergencySession(login.token)).toBeNull();
    await expect(prisma.$transaction(tx => lockControlActor(tx, oldActor))).rejects.toThrow(
      'Emergency session expired'
    );
    expect(await getEmergencySession(renewed.token)).not.toBeNull();
    token = renewed.token;
  });
  it('preserves real recovery completion during distributed unknown-account and verification abuse', async () => {
    const actual = await vi.importActual<typeof import('@/lib/auth-abuse')>('@/lib/auth-abuse');
    vi.mocked(consumeAuthRateLimit).mockImplementation(actual.consumeAuthRateLimit);
    const started = performance.now();
    try {
      await prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'auth:emergency:' } } });
      // More than the former shared 300-request budget, spread over 40 clients.
      for (let batch = 0; batch < 20; batch++) {
        const attempts = await Promise.allSettled(
          Array.from({ length: 20 }, (_, i) =>
            emergencyLoginOptions(`unknown-${batch}-${i}`, `198.51.100.${(batch * 20 + i) % 40}`)
          )
        );
        expect(attempts.every(result => result.status === 'rejected')).toBe(true);
      }
      const flow = await emergencyLoginOptions(accountId, '192.0.2.1');
      // Even saturation of new ceremonies cannot steal the existing browser capability.
      for (let i = 0; i < 25; i++)
        await actual.consumeAuthRateLimit('emergency:options:account', accountId, 20, 300000);
      await expect(emergencyLoginOptions(accountId, '192.0.2.2')).rejects.toThrow('Too many');
      const failures = await Promise.allSettled(
        Array.from({ length: 40 }, (_, i) =>
          verifyEmergencyLogin(
            flow.challengeId,
            secret(),
            assertion(flow.options.challenge, 4),
            `203.0.113.${i}`
          )
        )
      );
      expect(failures.every(result => result.status === 'rejected')).toBe(true);
      const login = await verifyEmergencyLogin(
        flow.challengeId,
        flow.browserToken,
        assertion(flow.options.challenge, 4),
        '192.0.2.1'
      );
      token = login.token;
      expect((await getEmergencySession(token))?.account?.id).toBe(accountId);
      // Authenticated reauthentication has its own bounded reserve.
      const reauth = await emergencyLoginOptions(accountId, '192.0.2.1', token);
      expect(reauth.challengeId).toBeTruthy();
      for (let attempt = 0; attempt < 3; attempt++)
        await expect(
          verifyEmergencyLogin(
            reauth.challengeId,
            reauth.browserToken,
            assertion(reauth.options.challenge, 5, 1),
            '192.0.2.1'
          )
        ).rejects.toThrow('sign-in failed');
      await expect(
        verifyEmergencyLogin(
          reauth.challengeId,
          reauth.browserToken,
          assertion(reauth.options.challenge, 5),
          '192.0.2.1'
        )
      ).rejects.toThrow('sign-in failed');
      expect(
        (
          await prisma.emergencyCredential.findUniqueOrThrow({
            where: { credentialId: b64(credentialId) },
          })
        ).counter
      ).toBe(BigInt(4));

      measurements.recoveryAvailability = {
        distributedUnknownAccountFailures: 400,
        foreignBrowserFailures: 40,
        validRecoveryCompleted: true,
        saturatedAccountBudgetDidNotBlockCompletion: true,
        authenticatedReauthenticationReserved: true,
        verificationReserveBoundedToThreeAttempts: true,
        durationMs: performance.now() - started,
      };
      console.log(
        'Recovery survived 440 distributed failures, milliseconds:',
        Math.round(performance.now() - started)
      );
    } finally {
      vi.mocked(consumeAuthRateLimit).mockResolvedValue({
        allowed: true,
        remaining: 1,
        resetAt: Date.now(),
        count: 1,
      });
    }
  });
  it('does not count a successful drill from another canonical origin', async () => {
    await prisma.emergencyAccount.update({
      where: { id: accountId },
      data: { verifiedOrigin: 'https://old-origin.example.test' },
    });
    expect((await emergencyReadiness(prisma)).some(account => account.id === accountId)).toBe(
      false
    );
    await prisma.emergencyAccount.update({
      where: { id: accountId },
      data: { verifiedOrigin: 'https://recovery.example.test' },
    });
    expect((await emergencyReadiness(prisma)).some(account => account.id === accountId)).toBe(true);
  });
  it('refuses emergency configuration writes when the authoritative policy is missing', async () => {
    const session = await getEmergencySession(token);
    const principal: ControlActor = {
      kind: 'emergency',
      id: accountId,
      sessionId: session!.id,
      credentialVersion: session!.credentialVersion,
      sessionTokenHash: digest(token),
      authenticatedAt: session!.authenticatedAt.getTime(),
    };
    const saved = await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    await prisma.authenticationPolicy.delete({ where: { id: 'default' } });
    try {
      await expect(
        createEmergencyAccount(principal, 'Must not survive missing policy', true)
      ).rejects.toThrow();
      expect(
        await prisma.emergencyAccount.count({
          where: { displayName: 'Must not survive missing policy' },
        })
      ).toBe(0);
    } finally {
      await prisma.authenticationPolicy.create({
        data: { ...saved, legacySnapshot: saved.legacySnapshot as Prisma.InputJsonValue },
      });
    }
  });
  it('key revocation immediately rejects issued sessions and clears drill readiness', async () => {
    const others = await prisma.emergencyAccount.findMany({
      where: { id: { not: accountId } },
      select: { id: true, verifiedAt: true },
    });
    await prisma.emergencyAccount.updateMany({
      where: { id: { not: accountId } },
      data: { verifiedAt: null },
    });
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'SSO_REQUIRED' },
    });
    const session = await getEmergencySession(token);
    const principal: ControlActor = {
      kind: 'emergency',
      id: accountId,
      sessionId: session!.id,
      sessionTokenHash: digest(token),
      credentialVersion: session!.credentialVersion,
      authenticatedAt: session!.authenticatedAt.getTime(),
    };
    const credential = await prisma.emergencyCredential.findUniqueOrThrow({
      where: { credentialId: b64(credentialId) },
    });
    await expect(revokeEmergencyCredential(principal, credential.id, false)).rejects.toThrow(
      'replacement'
    );
    await revokeEmergencyCredential(principal, credential.id, true);
    const degraded = await prisma.authenticationPolicy.findUniqueOrThrow({
      where: { id: 'default' },
    });
    expect(degraded.mode).toBe('SSO_REQUIRED');
    expect(degraded.recoveryDegradedAt).not.toBeNull();
    expect(await getEmergencySession(token)).toBeNull();
    expect(
      (await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: accountId } })).verifiedAt
    ).toBeNull();
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'PASSWORD_ONLY', recoveryDegradedAt: null },
    });
    for (const other of others)
      await prisma.emergencyAccount.update({
        where: { id: other.id },
        data: { verifiedAt: other.verifiedAt },
      });
  });
  it('bounds the security transaction and completes large alert fan-out once across concurrent workers', async () => {
    const prefix = `fanout-scale-${Date.now()}`;
    const recipients = Array.from({ length: 1200 }, (_, index) => ({
      id: `${prefix}-${String(index).padStart(4, '0')}`,
      name: 'Fanout fixture',
      email: `${prefix}-${index}@example.test`,
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
    }));
    await prisma.user.createMany({ data: recipients });
    let eventId = '';
    try {
      const expected = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
      const start = performance.now();
      const event = await prisma.$transaction(tx =>
        securityEvent(tx, 'auth.test.fanout', actor.id)
      );
      eventId = event.id;
      expect(await prisma.authenticationAlert.count({ where: { eventId } })).toBe(100);
      expect(
        await prisma.authenticationAlertFanout.findUnique({ where: { eventId } })
      ).not.toBeNull();
      const transactionMs = performance.now() - start;
      console.log(
        '1,200-admin bounded security transaction milliseconds:',
        Math.round(performance.now() - start)
      );
      for (let round = 0; round < 4; round++)
        await Promise.all([processAuthenticationAlertFanout(), processAuthenticationAlertFanout()]);
      expect(await prisma.authenticationAlert.count({ where: { eventId } })).toBe(expected);
      expect(await prisma.inAppNotification.count({ where: { entityId: eventId } })).toBe(expected);
      expect(await prisma.authenticationAlertFanout.findUnique({ where: { eventId } })).toBeNull();
      await processAuthenticationAlertFanout();
      expect(await prisma.authenticationAlert.count({ where: { eventId } })).toBe(expected);
      measurements.alertFanout = {
        activeAdministrators: expected,
        synchronousRecipients: 100,
        transactionMs,
        finalRecipients: expected,
        duplicateInAppAlerts: 0,
        concurrentWorkers: 2,
        totalDurationMs: performance.now() - start,
      };
    } finally {
      await prisma.authenticationAlertFanout.deleteMany({ where: { eventId } });
      await prisma.authenticationAlert.deleteMany({ where: { eventId } });
      await prisma.inAppNotification.deleteMany({ where: { entityId: eventId } });
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    }
  });
  it('keeps individual abuse evidence while capping distributed anonymous alert fan-out', async () => {
    await prisma.authenticationFailureWindow.deleteMany();
    const prefix = `abuse-admin-${Date.now()}`;
    await prisma.user.createMany({
      data: Array.from({ length: 120 }, (_, index) => ({
        id: `${prefix}-${index}`,
        name: 'Abuse fixture admin',
        email: `${prefix}-${index}@example.test`,
        role: 'ADMIN' as const,
        status: 'ACTIVE' as const,
      })),
    });
    const before = await prisma.authenticationAlert.count();
    const marker = new Date();
    try {
      for (let batch = 0; batch < 6; batch++)
        await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            recordEmergencyFailure(`unknown-${batch}-${index}`, 'ACCOUNT_OR_CREDENTIAL_UNAVAILABLE')
          )
        );
      expect(
        await prisma.emergencyAccessEvent.count({
          where: { eventType: 'auth.emergency.login.failed', createdAt: { gte: marker } },
        })
      ).toBe(60);
      expect((await prisma.authenticationAlert.count()) - before).toBeLessThanOrEqual(200);
      expect((await prisma.authenticationFailureWindow.findMany())[0].count).toBe(60);
    } finally {
      await prisma.authenticationAlert.deleteMany({
        where: { recipientId: { startsWith: prefix } },
      });
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    }
  });
  it('serializes an acting administrator behind a concurrent role change and rejects the stale authority', async () => {
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>(resolve => {
      acquired = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const demotion = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
      await tx.user.update({
        where: { id: actor.id },
        data: { role: 'USER', tokenVersion: { increment: 1 } },
      });
      acquired();
      await gate;
    });
    await locked;
    const attempted = prisma
      .$transaction(tx => lockControlActor(tx, actor))
      .then(
        () => 'unexpected success',
        error => (error as Error).message
      );
    release();
    await demotion;
    expect(await attempted).toContain('permissions changed');
    await prisma.user.update({ where: { id: actor.id }, data: { role: 'ADMIN', tokenVersion: 0 } });
  });
  it('retains notification intent during delivery-queue outage and allows only one delivery lease per recipient', async () => {
    await prisma.authenticationAlert.deleteMany();
    const event = await prisma.$transaction(tx =>
      securityEvent(tx, 'auth.test.transport.outage', actor.id)
    );
    const recipients = await prisma.authenticationAlert.count({ where: { eventId: event.id } });
    vi.mocked(enqueueCentralNotification).mockClear();
    await Promise.all([processAuthenticationAlerts(), processAuthenticationAlerts()]);
    expect(enqueueCentralNotification).toHaveBeenCalledTimes(recipients);
    const alerts = await prisma.authenticationAlert.findMany({ where: { eventId: event.id } });
    expect(
      alerts.every(
        alert =>
          alert.deliveredAt === null &&
          alert.attempts === 1 &&
          alert.leaseToken === null &&
          alert.nextAttemptAt > alert.createdAt
      )
    ).toBe(true);
  });
  it('mandatory alert failure rolls back the security event and its audit', async () => {
    const before = await prisma.emergencyAccessEvent.count({
      where: { eventType: 'auth.test.rollback' },
    });
    await expect(
      prisma.$transaction(async tx => {
        vi.spyOn(tx.authenticationAlert, 'createMany').mockRejectedValueOnce(
          new Error('intent failure')
        );
        await securityEvent(tx, 'auth.test.rollback', actor.id);
      })
    ).rejects.toThrow('intent failure');
    expect(
      await prisma.emergencyAccessEvent.count({ where: { eventType: 'auth.test.rollback' } })
    ).toBe(before);
  });
  it('repairs only the pinned database origin with fresh independent authority and preserves Required', async () => {
    const saved = await prisma.systemSettings.findUniqueOrThrow({ where: { id: 'default' } });
    const fixture = await prisma.emergencyAccount.create({
      data: {
        displayName: 'Origin repair fixture',
        status: 'ACTIVE',
        independenceConfirmedAt: new Date(),
      },
    });
    const session = await prisma.emergencySession.create({
      data: {
        emergencyAccountId: fixture.id,
        tokenHash: digest(secret()),
        credentialVersion: 1,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const principal: ControlActor = {
      kind: 'emergency',
      id: fixture.id,
      sessionId: session.id,
      sessionTokenHash: session.tokenHash,
      credentialVersion: 1,
      authenticatedAt: Date.now(),
    };
    vi.stubEnv('AUTH_RECOVERY_ORIGIN', 'https://recovery.example.test');
    vi.stubEnv('NEXTAUTH_URL', 'https://recovery.example.test');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://other.example.test');
    try {
      await prisma.systemSettings.update({
        where: { id: 'default' },
        data: { appUrl: 'https://broken.example.test' },
      });
      await expect(repairCanonicalOrigin(principal, 900)).rejects.toThrow('align NEXTAUTH_URL');
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://recovery.example.test');
      await prisma.authenticationPolicy.update({
        where: { id: 'default' },
        data: { mode: 'SSO_REQUIRED' },
      });
      await repairCanonicalOrigin(principal, 900);
      expect(
        (await prisma.systemSettings.findUniqueOrThrow({ where: { id: 'default' } })).appUrl
      ).toBe('https://recovery.example.test');
      expect(
        (await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } })).mode
      ).toBe('SSO_REQUIRED');
      await expect(repairCanonicalOrigin(principal, 900)).rejects.toThrow('Policy changed');
    } finally {
      await prisma.systemSettings.update({
        where: { id: 'default' },
        data: { appUrl: saved.appUrl },
      });
      await prisma.authenticationPolicy.update({
        where: { id: 'default' },
        data: { version: 900, mode: 'PASSWORD_ONLY' },
      });
      await prisma.emergencySession.delete({ where: { id: session.id } });
      await prisma.emergencyAccount.delete({ where: { id: fixture.id } });
      vi.unstubAllEnvs();
    }
  });
  it('imports a legacy password only into recovery and explicitly restores the same administrator', async () => {
    const password = 'Legacy private certification phrase October 2026!';
    const original = await prisma.user.update({
      where: { id: actor.id },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    });
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { mode: 'SSO_REQUIRED', legacyEmergencyEmail: original.email.toLowerCase() },
    });
    await expect(
      legacyEmergencyLogin(original.email, 'wrong credential', '127.0.0.1')
    ).rejects.toThrow('sign-in failed');
    const login = await legacyEmergencyLogin(original.email, password, '127.0.0.1');
    const session = await getEmergencySession(login.token);
    expect(session?.legacyUserId).toBe(original.id);
    expect(session?.emergencyAccountId).toBeNull();
    expect(Object.keys(login).sort()).toEqual(['expiresAt', 'token']);
    const legacyActor: ControlActor = {
      kind: 'legacy',
      id: original.id,
      sessionId: session!.id,
      credentialVersion: original.tokenVersion,
      sessionTokenHash: digest(login.token),
      authenticatedAt: Date.now(),
    };
    await restorePasswordAccess(
      legacyActor,
      original.id,
      'Private legacy restoration phrase October2026!',
      900,
      'RESTORE PASSWORD ACCESS'
    );
    expect(await getEmergencySession(login.token)).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: original.id } })).id).toBe(
      original.id
    );
    expect(
      (await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } }))
        .legacyEmergencyEmail
    ).toBeNull();
  });
});
