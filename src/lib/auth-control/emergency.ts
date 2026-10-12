import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import prisma from '@/lib/prisma';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';
import { recoveryOrigin } from './origin';
import { securityEvent } from './security-events';

export const EMERGENCY_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-opsknight-emergency' : 'opsknight-emergency';
export const CEREMONY_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-opsknight-ceremony' : 'opsknight-ceremony';
export const emergencyCookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');

export async function getEmergencySession(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await prisma.emergencySession.findUnique({
    where: { tokenHash: digest(token) },
    include: { account: true },
  });
  if (!session || session.revokedAt) return null;
  let valid =
    session.expiresAt.getTime() > Date.now() &&
    Date.now() - session.lastActivityAt.getTime() < 900000;
  if (session.account)
    valid =
      valid &&
      session.account.status === 'ACTIVE' &&
      session.account.credentialVersion === session.credentialVersion;
  else {
    const [user, policy] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.legacyUserId! } }),
      getAuthenticationPolicy(),
    ]);
    valid =
      valid &&
      Boolean(
        user &&
        user.role === 'ADMIN' &&
        user.status === 'ACTIVE' &&
        user.tokenVersion === session.credentialVersion &&
        policy.legacyEmergencyEmail === user.email.toLowerCase()
      );
  }
  if (!valid) {
    await prisma.$transaction(async tx => {
      const revoked = await tx.emergencySession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 1)
        await securityEvent(
          tx,
          'auth.emergency.session.revoked',
          session.emergencyAccountId ?? session.legacyUserId!,
          { reason: 'expired_or_security_state_changed' }
        );
    });
    return null;
  }
  return session; // Passive reads never refresh idle time.
}

export async function recordEmergencyFailure(accountId: string, reason: string) {
  await prisma.$transaction(tx =>
    securityEvent(
      tx,
      'auth.emergency.login.failed',
      accountId,
      { reason, aggregateAnonymousFailure: true },
      'failed'
    )
  );
}

export async function emergencyLoginOptions(accountId: string, ip: string, reauthToken?: string) {
  const limits = await Promise.all([
    consumeAuthRateLimit('emergency:options:ip', ip, 30, 300000),
    consumeAuthRateLimit('emergency:options:account', accountId, 20, 300000),
    consumeAuthRateLimit('emergency:global', 'instance', 300, 300000),
  ]);
  if (limits.some(limit => !limit.allowed)) {
    await recordEmergencyFailure(accountId, 'RATE_LIMITED');
    throw new Error('Too many attempts from this network. Try again shortly.');
  }
  const account = await prisma.emergencyAccount.findUnique({
    where: { id: accountId },
    include: { credentials: { where: { revokedAt: null } } },
  });
  if (!account || account.status === 'DISABLED' || account.credentials.length === 0) {
    await recordEmergencyFailure(accountId, 'ACCOUNT_OR_CREDENTIAL_UNAVAILABLE');
    throw new Error('Emergency authentication unavailable. Check the account identifier and key.');
  }
  const session = reauthToken ? await getEmergencySession(reauthToken) : null;
  if (reauthToken && (!session || session.emergencyAccountId !== account.id))
    throw new Error('Reauthentication must use the current emergency identity.');
  const origin = await recoveryOrigin();
  const options = await generateAuthenticationOptions({
    rpID: new URL(origin).hostname,
    userVerification: 'required',
    allowCredentials: account.credentials.map(credential => ({ id: credential.credentialId })),
  });
  const browserToken = secret();
  const challenge = await prisma.emergencyChallenge.create({
    data: {
      challenge: options.challenge,
      browserHash: digest(browserToken),
      kind: session ? 'REAUTH' : 'LOGIN',
      emergencyAccountId: account.id,
      credentialVersion: account.credentialVersion,
      sessionId: session?.id,
      expiresAt: new Date(Date.now() + 300000),
    },
  });
  return { options, challengeId: challenge.id, browserToken };
}

export async function verifyEmergencyLogin(
  challengeId: string,
  browserToken: string,
  response: AuthenticationResponseJSON,
  ip: string
) {
  const origin = await recoveryOrigin();
  const token = secret();
  let accountId = '';
  try {
    if (
      !(await consumeAuthRateLimit('emergency:verify:ip', ip, 30, 300000)).allowed ||
      !(await consumeAuthRateLimit('emergency:global', 'instance', 300, 300000)).allowed
    )
      throw new Error('RATE_LIMITED');
    return await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(210012002::bigint)`;
        const flow = await tx.emergencyChallenge.findUnique({ where: { id: challengeId } });
        accountId = flow?.emergencyAccountId ?? '';
        if (
          !flow ||
          !['LOGIN', 'REAUTH'].includes(flow.kind) ||
          flow.browserHash !== digest(browserToken) ||
          flow.consumedAt ||
          flow.expiresAt.getTime() <= Date.now()
        )
          throw new Error('CHALLENGE_EXPIRED_OR_REPLAYED');
        await tx.$queryRaw`SELECT "id" FROM "EmergencyAccount" WHERE "id" = ${accountId} FOR UPDATE`;
        const account = await tx.emergencyAccount.findUnique({ where: { id: accountId } });
        const credential = await tx.emergencyCredential.findUnique({
          where: { credentialId: response.id },
        });
        if (
          !account ||
          account.status === 'DISABLED' ||
          account.credentialVersion !== flow.credentialVersion ||
          !credential ||
          credential.emergencyAccountId !== account.id ||
          credential.revokedAt
        )
          throw new Error('CREDENTIAL_REVOKED_OR_CHANGED');
        const verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: flow.challenge,
          expectedOrigin: origin,
          expectedRPID: new URL(origin).hostname,
          requireUserVerification: true,
          credential: {
            id: credential.credentialId,
            publicKey: new Uint8Array(credential.publicKey),
            counter: Number(credential.counter),
          },
        });
        if (
          !verification.verified ||
          verification.authenticationInfo.credentialBackedUp ||
          verification.authenticationInfo.credentialDeviceType !== 'singleDevice'
        )
          throw new Error('INDEPENDENT_KEY_VERIFICATION_FAILED');
        const claimed = await tx.emergencyChallenge.updateMany({
          where: { id: flow.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error('CHALLENGE_REPLAYED');
        await tx.emergencyCredential.update({
          where: { id: credential.id },
          data: { counter: verification.authenticationInfo.newCounter },
        });
        await tx.emergencyAccount.update({
          where: { id: account.id },
          data: {
            status: 'ACTIVE',
            verifiedAt: new Date(),
            lastUsedAt: new Date(),
            verifiedCredentialVersion: account.credentialVersion,
            verifiedOrigin: origin,
          },
        });
        const readyCount = await tx.emergencyAccount.count({
          where: {
            status: 'ACTIVE',
            verifiedOrigin: origin,
            verifiedAt: { gte: new Date(Date.now() - 90 * 86400000) },
            verifiedCredentialVersion: { equals: tx.emergencyAccount.fields.credentialVersion },
            credentials: { some: { revokedAt: null, deviceType: 'singleDevice', backedUp: false } },
          },
        });
        if (readyCount >= 2)
          await tx.authenticationPolicy.updateMany({
            where: { id: 'default', recoveryDegradedAt: { not: null } },
            data: { recoveryDegradedAt: null },
          });
        let expiresAt = new Date(Date.now() + 3600000);
        if (flow.kind === 'REAUTH') {
          const previous = await tx.emergencySession.findUnique({ where: { id: flow.sessionId! } });
          if (
            !previous ||
            previous.revokedAt ||
            previous.emergencyAccountId !== account.id ||
            previous.expiresAt.getTime() <= Date.now() ||
            Date.now() - previous.lastActivityAt.getTime() >= 900000
          )
            throw new Error('SESSION_EXPIRED');
          expiresAt = previous.expiresAt; // Reauthentication never extends the absolute cap.
          await tx.emergencySession.update({
            where: { id: previous.id },
            data: {
              tokenHash: digest(token),
              authenticatedAt: new Date(),
              lastActivityAt: new Date(),
            },
          });
        } else {
          await tx.emergencySession.create({
            data: {
              tokenHash: digest(token),
              emergencyAccountId: account.id,
              credentialVersion: account.credentialVersion,
              expiresAt,
            },
          });
        }
        await securityEvent(
          tx,
          flow.kind === 'REAUTH'
            ? 'auth.emergency.reauthenticated'
            : 'auth.emergency.login.success',
          account.id,
          {
            method: 'WEBAUTHN',
            credentialFingerprint: digest(credential.credentialId).slice(0, 12),
          }
        );
        return { token, expiresAt };
      },
      { timeout: 15000 }
    );
  } catch {
    await recordEmergencyFailure(accountId, 'WEBAUTHN_VERIFICATION_FAILED');
    throw new Error(
      'Emergency sign-in failed. Request a new challenge, verify the account and use an active security key.'
    );
  }
}

/** Compatibility bridge issues only a recovery cookie. Never a normal User session. */
export async function legacyEmergencyLogin(email: string, password: string, ip: string) {
  const policy = await getAuthenticationPolicy();
  const normalized = email.trim().toLowerCase();
  try {
    if (
      !(await consumeAuthRateLimit('emergency:legacy:ip', ip, 10, 300000)).allowed ||
      !(await consumeAuthRateLimit('emergency:global', 'instance', 300, 300000)).allowed ||
      policy.legacyEmergencyEmail !== normalized
    )
      throw new Error('denied');
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (
      !user ||
      user.role !== 'ADMIN' ||
      user.status !== 'ACTIVE' ||
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    )
      throw new Error('denied');
    const token = secret();
    const expiresAt = new Date(Date.now() + 3600000);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(210012002::bigint)`;
      await tx.$queryRaw`SELECT "id" FROM "AuthenticationPolicy" WHERE "id" = 'default' FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      const currentPolicy = await tx.authenticationPolicy.findUniqueOrThrow({
        where: { id: 'default' },
      });
      if (
        !current ||
        current.status !== 'ACTIVE' ||
        current.role !== 'ADMIN' ||
        current.passwordHash !== user.passwordHash ||
        current.tokenVersion !== user.tokenVersion ||
        currentPolicy.legacyEmergencyEmail !== normalized
      )
        throw new Error('denied');
      await tx.emergencySession.create({
        data: {
          tokenHash: digest(token),
          legacyUserId: user.id,
          credentialVersion: user.tokenVersion,
          expiresAt,
        },
      });
      await securityEvent(tx, 'auth.emergency.login.success', user.id, {
        method: 'LEGACY_PASSWORD',
        scope: 'RECOVERY_ONLY',
      });
    });
    return { token, expiresAt };
  } catch {
    await recordEmergencyFailure('', 'LEGACY_PASSWORD_REJECTED');
    throw new Error('Emergency sign-in failed.');
  }
}

export async function deliberateEmergencyActivity(token: string) {
  const session = await getEmergencySession(token);
  if (!session) throw new Error('Emergency session expired.');
  // Atomic predicate prevents a delayed activity request reviving an expired session.
  const updated = await prisma.emergencySession.updateMany({
    where: {
      id: session.id,
      revokedAt: null,
      tokenHash: digest(token),
      expiresAt: { gt: new Date() },
      lastActivityAt: { gt: new Date(Date.now() - 900000) },
    },
    data: { lastActivityAt: new Date() },
  });
  if (updated.count !== 1) throw new Error('Emergency session expired.');
}

export async function revokeEmergencySession(token: string) {
  const session = await getEmergencySession(token);
  if (!session) return;
  await prisma.$transaction(async tx => {
    const result = await tx.emergencySession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count)
      await securityEvent(
        tx,
        'auth.emergency.session.revoked',
        session.emergencyAccountId ?? session.legacyUserId!,
        { reason: 'logout' }
      );
  });
}
