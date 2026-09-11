'use server';

import { createHash, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit, simulateWork } from '@/lib/password-reset';
import {
  PASSWORD_TRANSPORT_MAX_CODE_UNITS,
  validatePasswordStrength,
} from '@/lib/passwords';
import { authPrivacyDigest } from '@/lib/auth-abuse';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export type SetPasswordState = {
  error?: string | null;
};

const schema = z
  .object({
    token: z.string().min(32).max(512),
    password: z.string().min(1).max(PASSWORD_TRANSPORT_MAX_CODE_UNITS),
    confirmPassword: z.string().min(1).max(PASSWORD_TRANSPORT_MAX_CODE_UNITS),
  })
  .strict();

function secretTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

async function auditInviteFailure(params: {
  reason: string;
  ip: string;
  userId?: string | null;
}) {
  const ipHash = await authPrivacyDigest('audit:invite:ip', params.ip);
  try {
    await logAudit({
      action: 'INVITE_FAILED',
      entityType: 'USER',
      entityId: params.userId || 'unknown',
      actorId: null,
      source: 'AUTH',
      details: { reason: params.reason, ipHash },
    });
  } catch (error) {
    logger.warn('auth.invite.audit_failed', {
      component: 'set-password',
      reason: params.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function setPassword(
  _previousState: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const startTime = Date.now();
  const parsed = schema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    await simulateWork(startTime);
    return { error: 'Invalid or expired invitation. Request a new invite and try again.' };
  }

  const { token, password, confirmPassword } = parsed.data;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const headerStore = await headers();
  const ip = getClientIp(headerStore);

  try {
    await checkRateLimit(tokenHash, ip, 'INVITE_ACTIVATION');
  } catch (error) {
    if (isAppError(error) && error.code === 'RATE_LIMIT_EXCEEDED') {
      await auditInviteFailure({ reason: 'RATE_LIMITED', ip });
      await simulateWork(startTime);
      return { error: 'Too many activation attempts. Please try again later.' };
    }
    logger.error('auth.invite.rate_limit_failed', {
      component: 'set-password',
      error: error instanceof Error ? error.message : String(error),
    });
    await simulateWork(startTime);
    return { error: 'Unable to activate the account right now. Please try again.' };
  }

  const record = await prisma.userToken.findFirst({
    where: {
      tokenHash,
      type: 'INVITE',
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, userId: true, identifier: true, generation: true },
  });

  if (!record) {
    await auditInviteFailure({ reason: 'INVALID_OR_EXPIRED_TOKEN', ip });
    await simulateWork(startTime);
    return { error: 'Invalid or expired invitation. Request a new invite and try again.' };
  }

  const user = await prisma.user.findFirst({
    where: record.userId ? { id: record.userId } : { email: record.identifier },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      invitationGeneration: true,
    },
  });

  if (!user || user.status !== 'INVITED') {
    await auditInviteFailure({
      reason: !user ? 'USER_NOT_FOUND' : user.status === 'DISABLED' ? 'USER_DISABLED' : 'ALREADY_ACTIVE',
      ip,
      userId: user?.id,
    });
    await simulateWork(startTime);
    return {
      error:
        user?.status === 'ACTIVE'
          ? 'This invitation has already been completed. Sign in instead.'
          : 'Invalid or expired invitation. Request a new invite and try again.',
    };
  }

  if (
    record.userId &&
    typeof record.generation === 'number' &&
    record.generation !== user.invitationGeneration
  ) {
    await auditInviteFailure({ reason: 'STALE_GENERATION', ip, userId: user.id });
    await simulateWork(startTime);
    return { error: 'Invalid or expired invitation. Request a new invite and try again.' };
  }

  if (!secretTextEqual(password, confirmPassword)) {
    return { error: 'Passwords do not match.' };
  }

  const passwordError = validatePasswordStrength(password, {
    email: user.email,
    displayName: user.name,
  });
  if (passwordError) return { error: passwordError };

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  try {
    await prisma.$transaction(async tx => {
      const claimed = await tx.userToken.updateMany({
        where: {
          id: record.id,
          tokenHash,
          type: 'INVITE',
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new Error('INVITE_TOKEN_ALREADY_USED');

      const activated = await tx.user.updateMany({
        where: {
          id: user.id,
          status: 'INVITED',
          ...(record.userId && typeof record.generation === 'number'
            ? { invitationGeneration: record.generation }
            : {}),
        },
        data: {
          passwordHash,
          status: 'ACTIVE',
          tokenVersion: { increment: 1 },
          invitedAt: null,
          deactivatedAt: null,
        },
      });
      if (activated.count !== 1) throw new Error('INVITE_USER_STATE_CHANGED');

      await tx.userToken.updateMany({
        where: {
          OR: [{ userId: user.id }, { identifier: user.email }],
          type: 'INVITE',
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'INVITE_TOKEN_ALREADY_USED' ||
        error.message === 'INVITE_USER_STATE_CHANGED')
    ) {
      await simulateWork(startTime);
      return { error: 'Invalid or expired invitation. Request a new invite and try again.' };
    }
    logger.error('auth.invite.activation_failed', {
      component: 'set-password',
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Unable to activate the account right now. Please try again.' };
  }

  await logAudit({
    action: 'user.active',
    entityType: 'USER',
    entityId: user.id,
    actorId: user.id,
    source: 'AUTH',
    details: { method: 'invite' },
  });

  redirect('/login?password=1');
}
