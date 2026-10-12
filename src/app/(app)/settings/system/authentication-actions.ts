'use server';

import { z } from 'zod';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getAuthOptions, resetAuthOptionsCache } from '@/lib/auth';
import { getUserPermissions } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { logAudit } from '@/lib/audit';
import { securityEvent } from '@/lib/auth-control/security-events';
import { lockControlActor } from '@/lib/auth-control/actor';
import { activateOidcRevision } from '@/lib/auth-control/oidc-revisions';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';

const transitionSchema = z
  .object({
    mode: z.enum(['PASSWORD_ONLY', 'SSO_OPTIONAL', 'SSO_REQUIRED']),
    expectedVersion: z.number().int().positive(),
    confirmation: z.literal('CHANGE AUTHENTICATION POLICY'),
    currentPassword: z.string().max(256).optional(),
  })
  .strict();

export async function changeAuthenticationMode(input: unknown) {
  const parsed = transitionSchema.parse(input);
  const permissions = await getUserPermissions();
  if (!permissions.isAdmin || !permissions.capabilities.includes(CAPABILITIES.ADMIN_MANAGE))
    throw new Error('Administrator access required.');
  const session = await getServerSession(await getAuthOptions());
  if (
    !session?.user?.id ||
    !session.authenticatedAt ||
    !Number.isFinite(session.authenticatedAt) ||
    session.authenticatedAt > Date.now() + 30_000 ||
    Date.now() - session.authenticatedAt > 300_000
  ) {
    throw new Error('Sign in again before changing authentication policy (five-minute limit).');
  }
  if (!(await consumeAuthRateLimit('policy-change', session.user.id, 5, 300_000)).allowed) {
    throw new Error('Too many authentication policy changes. Try again later.');
  }
  if (parsed.mode === 'SSO_REQUIRED') {
    const current = await getAuthenticationPolicy();
    if (!current.activeRevisionId)
      throw new Error(
        'Stage and verify an OIDC provider and two independent emergency accounts before enforcement.'
      );
    return activateOidcRevision(
      {
        kind: 'admin',
        id: session.user.id,
        tokenVersion: session.user.tokenVersion ?? 0,
        authenticatedAt: session.authenticatedAt,
        sessionId: session.sessionId,
        method: session.authenticationMethod === 'oidc' ? 'oidc' : 'credentials',
        issuedUnderPolicyVersion: session.issuedUnderPolicyVersion,
      },
      current.activeRevisionId,
      parsed.expectedVersion,
      'SSO_REQUIRED',
      'ACTIVATE VERIFIED SSO'
    );
  }
  await getAuthenticationPolicy();
  const actor = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (
    !actor ||
    actor.role !== 'ADMIN' ||
    actor.status !== 'ACTIVE' ||
    actor.tokenVersion !== session.user.tokenVersion
  ) {
    throw new Error('Active administrator access required.');
  }
  if (
    parsed.mode === 'PASSWORD_ONLY' &&
    (!actor.passwordHash ||
      !parsed.currentPassword ||
      !(await bcrypt.compare(parsed.currentPassword, actor.passwordHash)))
  ) {
    throw new Error('Verify your current password before disabling SSO.');
  }
  const policy = await prisma.$transaction(async tx => {
    await lockControlActor(tx, {
      kind: 'admin',
      id: actor.id,
      tokenVersion: actor.tokenVersion,
      authenticatedAt: session.authenticatedAt!,
      sessionId: session.sessionId,
      method: session.authenticationMethod === 'oidc' ? 'oidc' : 'credentials',
      issuedUnderPolicyVersion: session.issuedUnderPolicyVersion,
    });
    const current = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
    if (
      !currentActor ||
      currentActor.role !== 'ADMIN' ||
      currentActor.status !== 'ACTIVE' ||
      currentActor.tokenVersion !== actor.tokenVersion ||
      currentActor.passwordHash !== actor.passwordHash
    ) {
      throw new Error('Administrator credentials or permissions changed. Sign in again.');
    }
    if (current.version !== parsed.expectedVersion)
      throw new Error('Authentication policy changed elsewhere. Reload before retrying.');
    const oidc = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
    if (parsed.mode === 'SSO_OPTIONAL' && !oidc?.enabled)
      throw new Error('Enable an OIDC provider before selecting SSO Optional.');
    if (current.mode === parsed.mode) return current;
    const updated = await tx.authenticationPolicy.updateMany({
      where: { id: 'default', version: parsed.expectedVersion },
      data: {
        mode: parsed.mode,
        passwordRecoveryUserId: null,
        passwordRecoveryExpiresAt: null,
        version: { increment: 1 },
        updatedBy: actor.id,
        oidcConfigVersion: oidc?.configVersion ?? null,
        enforcedAt: null,
        ...(parsed.mode === 'PASSWORD_ONLY'
          ? { oidcSessionMinVersion: current.version + 1, legacyEmergencyEmail: null }
          : {}),
      },
    });
    if (updated.count !== 1) throw new Error('Authentication policy changed elsewhere.');
    if (parsed.mode === 'PASSWORD_ONLY')
      await tx.emergencySession.updateMany({
        where: { legacyUserId: { not: null }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    const result = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    await logAudit(
      {
        action: 'auth.policy.changed',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'default',
        actorId: actor.id,
        source: 'UI',
        oldValue: { mode: current.mode, version: current.version },
        newValue: { mode: result.mode, version: result.version },
        details: {
          disallowedSessions: 'Rejected on next protected request',
          actorAuthenticationMethod: session.authenticationMethod ?? 'unknown',
        },
      },
      tx
    );
    await securityEvent(tx, 'auth.policy.mode.transition', actor.id, {
      oldMode: current.mode,
      mode: result.mode,
      version: result.version,
    });
    return result;
  });
  resetAuthOptionsCache();
  revalidatePath('/settings/system');
  return { mode: policy.mode, version: policy.version };
}
