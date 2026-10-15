import 'server-only';
import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { getAuthOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/rbac';
import { evaluateAuthenticationPolicy } from '@/lib/authentication-policy-evaluator';
import { CAPABILITIES } from '@/lib/authorization';
import { getEmergencySession, EMERGENCY_COOKIE, digest } from './emergency';

export type ControlActor =
  | {
      kind: 'admin';
      id: string;
      tokenVersion: number;
      authenticatedAt: number;
      sessionId?: string;
      method?: 'credentials' | 'oidc';
      issuedUnderPolicyVersion?: number;
    }
  | {
      kind: 'emergency' | 'legacy';
      id: string;
      sessionId: string;
      credentialVersion: number;
      authenticatedAt: number;
      sessionTokenHash: string;
    };

export const FRESH_AUTHENTICATION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function getControlActor(fresh = false): Promise<ControlActor> {
  const emergencyToken = (await cookies()).get(EMERGENCY_COOKIE)?.value;
  if (emergencyToken) {
    const session = await getEmergencySession(emergencyToken);
    if (session) {
      if (fresh && Date.now() - session.authenticatedAt.getTime() > FRESH_AUTHENTICATION_MAX_AGE_MS)
        throw new Error('Verify your emergency credential again before this operation.');
      return {
        kind: session.emergencyAccountId ? 'emergency' : 'legacy',
        id: session.emergencyAccountId ?? session.legacyUserId!,
        sessionId: session.id,
        credentialVersion: session.credentialVersion,
        authenticatedAt: session.authenticatedAt.getTime(),
        sessionTokenHash: digest(emergencyToken),
      };
    }
    // A stale recovery cookie must not override a separately authenticated admin.
  }
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes(CAPABILITIES.ADMIN_MANAGE))
    throw new Error('Administrator access required.');
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.id || session.authenticationMethod === 'legacy-emergency')
    throw new Error('Administrator sign-in required.');
  if (
    fresh &&
    (!session.authenticatedAt ||
      session.authenticatedAt > Date.now() + 30000 ||
      Date.now() - session.authenticatedAt > FRESH_AUTHENTICATION_MAX_AGE_MS)
  )
    throw new Error('Sign in again before this operation.');
  if (session.sessionId) {
    const { touchAuthenticatedSession } = await import('@/lib/session-registry');
    await touchAuthenticatedSession({ userId: session.user.id, sessionId: session.sessionId });
  }
  return {
    kind: 'admin',
    id: session.user.id,
    tokenVersion: session.user.tokenVersion ?? 0,
    authenticatedAt: session.authenticatedAt ?? 0,
    sessionId: session.sessionId,
    method: session.authenticationMethod ?? 'credentials',
    issuedUnderPolicyVersion: session.issuedUnderPolicyVersion,
  };
}

/** Common writer fence, followed by locking the principal's actual security row. */
export async function lockControlActor(
  tx: Prisma.TransactionClient,
  actor: ControlActor,
  fresh = true
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(210012002::bigint)`;
  await tx.$queryRaw`SELECT "id" FROM "AuthenticationPolicy" WHERE "id" = 'default' FOR UPDATE`;
  const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
  if (
    evaluateAuthenticationPolicy(policy, 'PASSWORD_WRITE').reason ===
    'INVALID_AUTHENTICATION_POLICY'
  )
    throw new Error(
      'Authentication policy is invalid. Restore the authoritative policy before making security changes.'
    );
  if (actor.kind === 'admin') {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.id } });
    if (
      !user ||
      user.role !== 'ADMIN' ||
      user.status !== 'ACTIVE' ||
      user.tokenVersion !== actor.tokenVersion
    )
      throw new Error('Administrator permissions changed. Sign in again.');
    if (
      actor.method !== 'oidc' &&
      policy.passwordRecoveryUserId &&
      policy.passwordRecoveryUserId !== user.id
    )
      throw new Error('Password recovery is restricted to the selected administrator.');
    if (
      !evaluateAuthenticationPolicy(
        policy,
        'SESSION',
        { id: user.id, email: user.email },
        { method: actor.method ?? 'credentials', policyVersion: actor.issuedUnderPolicyVersion }
      ).allowed
    )
      throw new Error('Administrator sign-in method was revoked by policy.');
    if (
      fresh &&
      (actor.authenticatedAt > Date.now() + 30000 ||
        Date.now() - actor.authenticatedAt > FRESH_AUTHENTICATION_MAX_AGE_MS)
    )
      throw new Error('Fresh administrator sign-in required.');
    if (actor.sessionId) {
      const deviceId = `session:${actor.sessionId}`;
      await tx.$queryRaw`SELECT "id" FROM "UserDevice" WHERE "userId" = ${actor.id} AND "deviceId" = ${deviceId} FOR UPDATE`;
      const registered = await tx.userDevice.findUnique({
        where: { userId_deviceId: { userId: actor.id, deviceId } },
      });
      if (!registered || registered.platform.startsWith('session:REVOKED:'))
        throw new Error('Administrator session was revoked.');
    }
  } else {
    await tx.$queryRaw`SELECT "id" FROM "EmergencySession" WHERE "id" = ${actor.sessionId} FOR UPDATE`;
    const session = await tx.emergencySession.findUnique({ where: { id: actor.sessionId } });
    if (
      !session ||
      session.tokenHash !== actor.sessionTokenHash ||
      session.credentialVersion !== actor.credentialVersion ||
      (actor.kind === 'emergency'
        ? session.emergencyAccountId !== actor.id
        : session.legacyUserId !== actor.id) ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      Date.now() - session.lastActivityAt.getTime() >= 900000 ||
      (fresh && Date.now() - session.authenticatedAt.getTime() > FRESH_AUTHENTICATION_MAX_AGE_MS)
    )
      throw new Error('Emergency session expired. Verify your credential again.');
    if (actor.kind === 'emergency') {
      await tx.$queryRaw`SELECT "id" FROM "EmergencyAccount" WHERE "id" = ${actor.id} FOR UPDATE`;
      const account = await tx.emergencyAccount.findUnique({ where: { id: actor.id } });
      if (
        !account ||
        account.status !== 'ACTIVE' ||
        account.credentialVersion !== actor.credentialVersion
      )
        throw new Error('Emergency credentials changed or were revoked.');
    } else {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actor.id } });
      if (
        !user ||
        user.role !== 'ADMIN' ||
        user.status !== 'ACTIVE' ||
        user.tokenVersion !== actor.credentialVersion ||
        policy.legacyEmergencyEmail !== user.email.toLowerCase()
      )
        throw new Error('Legacy emergency access was revoked.');
    }
  }
}
