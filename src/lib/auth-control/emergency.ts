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
import { verifyEmergencyPassword } from './emergency-password';
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

type EmergencyThrottleScope = 'options-network' | 'options-account' | 'verification' | 'legacy';

/** Exact shared counters, at most three durable audit samples per scope/window.
 * Already-denied traffic cannot amplify into one event/audit/alert per request.
 * Scope is an internal enum, never an attacker-controlled account or network value.
 */
export async function recordEmergencyThrottle(scope: EmergencyThrottleScope) {
  const windowMs = 300000;
  const bucket = Math.floor(Date.now() / windowMs);
  await prisma.$transaction(async tx => {
    const aggregate = await tx.authenticationFailureWindow.upsert({
      where: { id: `throttled-emergency:${scope}:${bucket}` },
      create: {
        id: `throttled-emergency:${scope}:${bucket}`,
        expiresAt: new Date((bucket + 2) * windowMs),
      },
      update: { count: { increment: 1 } },
    });
    if (![1, 100, 1000].includes(aggregate.count)) return;
    await securityEvent(
      tx,
      'auth.emergency.requests.throttled',
      '',
      {
        scope,
        rejectedRequests: aggregate.count,
        windowStartedAt: bucket * windowMs,
        aggregateAnonymousFailure: true,
      },
      'blocked'
    );
  });
}

export async function emergencyLoginOptions(accountId: string, ip: string, reauthToken?: string) {
  // Per-network admission bounds indexed lookups. Unknown identifiers never consume
  // a real account's ceremony budget or an in-progress ceremony's verification budget.
  if (!(await consumeAuthRateLimit('emergency:options:ip', ip, 30, 300000)).allowed) {
    await recordEmergencyThrottle('options-network');
    throw new Error('Too many attempts from this network. Try again shortly.');
  }
  const account = await prisma.emergencyAccount.findUnique({
    where: { id: accountId },
    include: { credentials: { where: { revokedAt: null } } },
  });
  if (
    !account ||
    account.authenticationMethod !== 'WEBAUTHN' ||
    account.status === 'DISABLED' ||
    account.credentials.length === 0
  ) {
    await recordEmergencyFailure(accountId, 'ACCOUNT_OR_CREDENTIAL_UNAVAILABLE');
    throw new Error('Emergency authentication unavailable. Check the account identifier and key.');
  }
  const session = reauthToken ? await getEmergencySession(reauthToken) : null;
  if (reauthToken && (!session || session.emergencyAccountId !== account.id))
    throw new Error('Reauthentication must use the current emergency identity.');
  const budget = session
    ? await consumeAuthRateLimit('emergency:reauth:session', session.id, 10, 300000)
    : await consumeAuthRateLimit('emergency:options:account', account.id, 20, 300000);
  if (!budget.allowed) {
    await recordEmergencyThrottle('options-account');
    throw new Error(
      'Too many attempts for this recovery identity. Use another custodian or retry shortly.'
    );
  }
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
  let throttled = false;
  try {
    // The unguessable browser capability reserves completion independently of
    // anonymous traffic. Recheck every predicate under the transaction below.
    const pending = await prisma.emergencyChallenge.findUnique({ where: { id: challengeId } });
    const ownsCeremony =
      pending &&
      ['LOGIN', 'REAUTH'].includes(pending.kind) &&
      pending.browserHash === digest(browserToken) &&
      !pending.consumedAt &&
      pending.expiresAt.getTime() > Date.now();
    if (!ownsCeremony) {
      throttled = !(await consumeAuthRateLimit('emergency:verify:invalid:ip', ip, 30, 300000))
        .allowed;
      throw new Error('CHALLENGE_EXPIRED_OR_REPLAYED');
    }
    accountId = pending.emergencyAccountId;
    if (!(await consumeAuthRateLimit('emergency:verify:ceremony', pending.id, 3, 300000)).allowed) {
      throttled = true;
      throw new Error('RATE_LIMITED');
    }
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
          account.authenticationMethod !== 'WEBAUTHN' ||
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
            OR: [
              { authenticationMethod: 'PASSWORD', passwordHash: { not: null } },
              {
                authenticationMethod: 'WEBAUTHN',
                credentials: {
                  some: { revokedAt: null, deviceType: 'singleDevice', backedUp: false },
                },
              },
            ],
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
    if (throttled) await recordEmergencyThrottle('verification');
    else await recordEmergencyFailure(accountId, 'WEBAUTHN_VERIFICATION_FAILED');
    throw new Error(
      'Emergency sign-in failed. Request a new challenge, verify the account and use an active security key.'
    );
  }
}

/** Compatibility bridge issues only a recovery cookie. Never a normal User session. */
export async function legacyEmergencyLogin(email: string, password: string, ip: string) {
  const policy = await getAuthenticationPolicy();
  const normalized = email.trim().toLowerCase();
  let throttled = false;
  try {
    throttled = !(await consumeAuthRateLimit('emergency:legacy:ip', ip, 10, 300000)).allowed;
    if (throttled || policy.legacyEmergencyEmail !== normalized) throw new Error('denied');
    throttled = !(await consumeAuthRateLimit('emergency:legacy:account', normalized, 100, 300000))
      .allowed;
    if (throttled) throw new Error('denied');
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
    if (throttled) await recordEmergencyThrottle('legacy');
    else await recordEmergencyFailure('', 'LEGACY_PASSWORD_REJECTED');
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

export async function passwordEmergencyLogin(
  accountId: string,
  password: string,
  ip: string,
  reauthToken?: string
) {
  let throttled = false;
  try {
    if (!(await consumeAuthRateLimit('emergency:password:network', ip, 30, 300000)).allowed) {
      throttled = true;
      throw new Error('THROTTLED');
    }
    const previous = reauthToken !== undefined ? await getEmergencySession(reauthToken) : null;
    if (reauthToken !== undefined && (!previous || previous.emergencyAccountId !== accountId))
      throw new Error('SESSION_INVALID');
    const account = await prisma.emergencyAccount.findUnique({ where: { id: accountId } });
    if (
      account &&
      !(
        await consumeAuthRateLimit(
          previous ? 'emergency:password:reauth' : 'emergency:password:account',
          previous?.id ?? accountId,
          previous ? 10 : 20,
          300000
        )
      ).allowed
    ) {
      throttled = true;
      throw new Error('THROTTLED');
    }
    // Unknown identifiers cannot spend the capacity reserved for real identities.
    // PostgreSQL coordinates this probe budget across IPs and application replicas.
    if (
      (!account || account.authenticationMethod !== 'PASSWORD' || !account.passwordHash) &&
      !(await consumeAuthRateLimit('emergency:password:unknown', 'instance', 10, 1000)).allowed
    ) {
      throttled = true;
      throw new Error('THROTTLED');
    }
    const valid = await verifyEmergencyPassword(
      password,
      account?.authenticationMethod === 'PASSWORD' ? account.passwordHash : null,
      account ? { identity: account.id, reauthentication: Boolean(previous) } : undefined
    );
    if (
      !account ||
      !valid ||
      account.status === 'DISABLED' ||
      account.authenticationMethod !== 'PASSWORD'
    )
      throw new Error('INVALID_CREDENTIAL');
    const origin = await recoveryOrigin();
    const token = secret();
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(210012002::bigint)`;
      await tx.$queryRaw`SELECT id FROM "EmergencyAccount" WHERE id = ${account.id} FOR UPDATE`;
      const current = await tx.emergencyAccount.findUniqueOrThrow({ where: { id: account.id } });
      if (
        current.status === 'DISABLED' ||
        current.authenticationMethod !== 'PASSWORD' ||
        current.credentialVersion !== account.credentialVersion ||
        current.passwordHash !== account.passwordHash
      )
        throw new Error('CREDENTIAL_CHANGED');
      let expiresAt = new Date(Date.now() + 3600000);
      if (previous) {
        const session = await tx.emergencySession.findUniqueOrThrow({ where: { id: previous.id } });
        if (
          session.revokedAt ||
          session.tokenHash !== digest(reauthToken!) ||
          session.credentialVersion !== current.credentialVersion ||
          session.expiresAt.getTime() <= Date.now() ||
          Date.now() - session.lastActivityAt.getTime() >= 900000
        )
          throw new Error('SESSION_EXPIRED');
        expiresAt = session.expiresAt;
        await tx.emergencySession.update({
          where: { id: session.id },
          data: {
            tokenHash: digest(token),
            authenticatedAt: new Date(),
            lastActivityAt: new Date(),
          },
        });
      } else
        await tx.emergencySession.create({
          data: {
            emergencyAccountId: current.id,
            credentialVersion: current.credentialVersion,
            tokenHash: digest(token),
            expiresAt,
          },
        });
      await tx.emergencyAccount.update({
        where: { id: current.id },
        data: {
          status: 'ACTIVE',
          verifiedAt: new Date(),
          lastUsedAt: new Date(),
          verifiedCredentialVersion: current.credentialVersion,
          verifiedOrigin: origin,
        },
      });
      const { emergencyReadiness } = await import('./emergency-management');
      if ((await emergencyReadiness(tx)).length >= 2)
        await tx.authenticationPolicy.updateMany({
          where: { id: 'default', recoveryDegradedAt: { not: null } },
          data: { recoveryDegradedAt: null },
        });
      await securityEvent(
        tx,
        previous ? 'auth.emergency.reauthenticated' : 'auth.emergency.login.success',
        current.id,
        { method: 'PASSWORD' }
      );
      return { token, expiresAt };
    });
  } catch {
    if (throttled) await recordEmergencyThrottle('verification');
    else await recordEmergencyFailure('', 'PASSWORD_VERIFICATION_FAILED');
    throw new Error(
      'Emergency sign-in failed. Verify your recovery credentials or use another custodian.'
    );
  }
}
