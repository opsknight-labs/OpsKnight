import 'server-only';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { validatePasswordStrength } from '@/lib/passwords';
import { lockControlActor, type ControlActor } from './actor';
import { securityEvent } from './security-events';
import { resetAuthOptionsCache } from '@/lib/auth';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
import { recoveryOrigin } from './origin';
import { resolveAuthPublicOrigin } from '@/lib/auth-public-origin';

/** Explicit recovery operation; no automatic fallback and no ordinary reset token. */
export async function restorePasswordAccess(
  actor: ControlActor,
  adminUserId: string,
  password: string,
  expectedVersion: number,
  confirmation: string,
  scope: 'ADMIN_ONLY' | 'INSTANCE' = 'ADMIN_ONLY'
) {
  // A normally signed-in administrator may restore password access only for their own
  // account (for example while their SSO session outlives an IdP outage). Restoring another
  // administrator would let one admin take over another's identity, so that stays limited
  // to independent emergency recovery. Freshness, session validity and current permissions
  // are enforced by lockControlActor below.
  if (actor.kind === 'admin' && actor.id !== adminUserId)
    throw new Error(
      'You can restore password access only for your own account. Use an emergency recovery session to restore another administrator.'
    );
  if (
    confirmation !==
    (scope === 'INSTANCE' ? 'RESTORE INSTANCE PASSWORD ACCESS' : 'RESTORE PASSWORD ACCESS')
  )
    throw new Error('Confirm the exact scope of password recovery.');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } });
  if (user.role !== 'ADMIN' || user.status !== 'ACTIVE')
    throw new Error('Select an existing active administrator.');
  if (actor.kind === 'legacy' && actor.id !== adminUserId)
    throw new Error('Legacy recovery can restore only its original administrator.');
  const error = validatePasswordStrength(password, { email: user.email, displayName: user.name });
  if (error) throw new Error(error);
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    if (policy.version !== expectedVersion)
      throw new Error('Policy changed. Reload the recovery console.');
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${adminUserId} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: adminUserId } });
    if (
      current.role !== 'ADMIN' ||
      current.status !== 'ACTIVE' ||
      current.tokenVersion !== user.tokenVersion
    )
      throw new Error('Administrator security state changed.');
    const restored = await tx.authenticationPolicy.update({
      where: { id: 'default' },
      data: {
        mode: scope === 'INSTANCE' ? 'PASSWORD_ONLY' : policy.mode,
        version: { increment: 1 },
        passwordSessionMinVersion: policy.version + 1,
        oidcSessionMinVersion:
          scope === 'INSTANCE' ? policy.version + 1 : policy.oidcSessionMinVersion,
        enforcedAt: scope === 'INSTANCE' ? null : policy.enforcedAt,
        passwordRecoveryUserId: scope === 'ADMIN_ONLY' ? current.id : null,
        passwordRecoveryExpiresAt: scope === 'ADMIN_ONLY' ? new Date(Date.now() + 3600000) : null,
        legacyEmergencyEmail: null,
      },
    });
    await tx.user.update({
      where: { id: current.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await tx.userToken.updateMany({
      where: {
        OR: [{ userId: current.id }, { identifier: current.email }],
        type: { in: ['PASSWORD_RESET', 'INVITE'] },
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await tx.emergencySession.updateMany({
      where: { legacyUserId: { not: null }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await securityEvent(tx, 'auth.recovery.password.restored', actor.id, {
      adminUserId,
      originalUserPreserved: true,
      mode: restored.mode,
      policyVersion: restored.version,
      ordinaryPasswordLoginEnabled: true,
      recoveryScope: scope,
      otherLocalPasswordsEnabled: scope === 'INSTANCE',
      initiatedBy: actor.kind === 'admin' ? 'administrator-self-service' : actor.kind,
    });
    return { mode: restored.mode, version: restored.version };
  });
  invalidateSessionSecurityProjection(adminUserId);
  resetAuthOptionsCache();
  return result;
}

/** A deployment pin grants recovery-origin trust, never arbitrary Host-header trust. */
export async function repairCanonicalOrigin(actor: ControlActor, expectedVersion: number) {
  if (actor.kind !== 'emergency' || !process.env.AUTH_RECOVERY_ORIGIN)
    throw new Error(
      'Independent emergency access and a deployment-managed recovery origin pin are required.'
    );
  const origin = await recoveryOrigin();
  const resolution = resolveAuthPublicOrigin({ dbAppUrl: origin });
  if (resolution.conflicts.length || resolution.origin !== origin)
    throw new Error(
      'First align NEXTAUTH_URL and NEXT_PUBLIC_APP_URL with the pinned recovery origin and restart all web replicas.'
    );
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    if (policy.version !== expectedVersion) throw new Error('Policy changed. Reload recovery.');
    await tx.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', appUrl: origin },
      update: { appUrl: origin },
    });
    await tx.authenticationPolicy.update({
      where: { id: 'default' },
      data: { version: { increment: 1 } },
    });
    await securityEvent(tx, 'auth.recovery.origin.repaired', actor.id, {
      origin,
      policyPreserved: policy.mode,
    });
  });
  resetAuthOptionsCache();
  return { origin };
}
