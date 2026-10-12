// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { restorePasswordAccess } from '@/lib/auth-control/recovery';
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
  digest,
  secret,
} from '@/lib/auth-control/emergency';
import { lockControlActor, type ControlActor } from '@/lib/auth-control/actor';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { processAuthenticationAlerts, securityEvent } from '@/lib/auth-control/security-events';

vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: vi.fn().mockRejectedValue(new Error('delivery queue unavailable')),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(), resetAuthOptionsCache: vi.fn() }));
vi.mock('@/lib/auth-control/origin', () => ({
  authenticationOrigin: vi.fn().mockResolvedValue('https://recovery.example.test'),
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
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw new Error('Isolated enterprise_sso_test DB required.');
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
    const renewed = await verifyEmergencyLogin(
      reauth.challengeId,
      reauth.browserToken,
      assertion(reauth.options.challenge, 3),
      '127.0.0.1'
    );
    expect(renewed.expiresAt).toEqual(login.expiresAt);
    expect(await getEmergencySession(login.token)).toBeNull();
    expect(await getEmergencySession(renewed.token)).not.toBeNull();
    token = renewed.token;
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
    const credential = await prisma.emergencyCredential.findUniqueOrThrow({
      where: { credentialId: b64(credentialId) },
    });
    await revokeEmergencyCredential(actor, credential.id, true);
    expect(await getEmergencySession(token)).toBeNull();
    expect(
      (await prisma.emergencyAccount.findUniqueOrThrow({ where: { id: accountId } })).verifiedAt
    ).toBeNull();
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
