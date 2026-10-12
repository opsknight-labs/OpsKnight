import 'server-only';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { validatePasswordStrength } from '@/lib/passwords';
import { lockControlActor, type ControlActor } from './actor';
import { securityEvent } from './security-events';
import { resetAuthOptionsCache } from '@/lib/auth';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';

/** Explicit recovery operation; no automatic fallback and no ordinary reset token. */
export async function restorePasswordAccess(
  actor: ControlActor,
  adminUserId: string,
  password: string,
  expectedVersion: number,
  confirmation: string
) {
  if (actor.kind === 'admin') throw new Error('Use an independent emergency session for recovery.');
  if (confirmation !== 'RESTORE PASSWORD ACCESS')
    throw new Error('Confirm that this deliberately enables ordinary password login.');
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
        mode: 'PASSWORD_ONLY',
        version: { increment: 1 },
        passwordSessionMinVersion: policy.version + 1,
        oidcSessionMinVersion: policy.version + 1,
        enforcedAt: null,
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
    });
    return { mode: restored.mode, version: restored.version };
  });
  invalidateSessionSecurityProjection(adminUserId);
  resetAuthOptionsCache();
  return result;
}
