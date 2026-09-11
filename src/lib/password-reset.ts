import { createHash, randomBytes, randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { emitAuditEvent } from '@/lib/audit';
import { AppError, isAppError } from '@/lib/errors';
import { validatePasswordStrength } from '@/lib/passwords';
import { authPrivacyDigest, consumeAuthRateLimit } from '@/lib/auth-abuse';
import { acquireAdvisoryLock } from '@/lib/db-locks';

const GENERIC_RESET_MESSAGE =
  'If an account exists with this email, you will receive password reset instructions.';
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_ISSUE_ATTEMPTS = 4;
const COMPLETION_WINDOW_MS = 15 * 60 * 1000;
const INIT_IDENTIFIER_WINDOW_MS = 60 * 60 * 1000;
const INIT_IP_WINDOW_MS = 15 * 60 * 1000;
const DUMMY_BCRYPT_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxrmVAffROEdXLahEtFJZ1e3dHy';

export type PasswordResetResult = { success: boolean; message: string };
export type PasswordResetCompletionResult = {
  success: boolean;
  message?: string;
  error?: string;
  code?: 'INVALID_TOKEN' | 'WEAK_PASSWORD' | 'RATE_LIMITED' | 'INTERNAL';
};

export type IssuedPasswordResetToken = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

function isSerializationConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2034');
}

/**
 * Stable signed 64-bit advisory-lock key scoped to one user's reset-token
 * issuance. This prevents two replicas from simultaneously leaving different
 * live reset tokens for the same account.
 */
function passwordResetIssuanceLockKey(userId: string): bigint {
  const first64Bits = createHash('sha256')
    .update(`opsknight:password-reset:${userId}`)
    .digest('hex')
    .slice(0, 16);
  return BigInt.asIntN(64, BigInt(`0x${first64Bits}`));
}

/**
 * Authoritative reset-token issuance primitive used by self-service and admin
 * flows. Issuance is serialized per user across replicas, prior live tokens are
 * revoked (not silently deleted), and only a SHA-256 digest is persisted.
 */
export async function issuePasswordResetToken(params: {
  userId: string;
  email: string;
  ttlMs?: number;
  metadata?: Prisma.InputJsonObject;
}): Promise<IssuedPasswordResetToken> {
  const ttlMs = params.ttlMs ?? RESET_TOKEN_TTL_MS;

  for (let attempt = 1; attempt <= RESET_ISSUE_ATTEMPTS; attempt += 1) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + ttlMs);
    const now = new Date();

    try {
      await prisma.$transaction(
        async tx => {
          await acquireAdvisoryLock(tx, passwordResetIssuanceLockKey(params.userId));

          await tx.userToken.updateMany({
            where: {
              type: 'PASSWORD_RESET',
              usedAt: null,
              revokedAt: null,
              OR: [
                { userId: params.userId },
                { identifier: params.userId },
                { identifier: params.email.toLowerCase() },
              ],
            },
            data: { revokedAt: now },
          });

          await tx.userToken.create({
            data: {
              identifier: params.userId,
              userId: params.userId,
              type: 'PASSWORD_RESET',
              tokenHash,
              expiresAt,
              ...(params.metadata ? { metadata: params.metadata } : {}),
            },
          });
        },
        // The per-user advisory lock is the serialization primitive here.
        // READ COMMITTED lets a waiter observe the preceding lock holder's
        // committed token before revoking it; SERIALIZABLE can capture a stale
        // snapshot while waiting and turn a safe burst into P2034 retry storms.
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );

      return { token, tokenHash, expiresAt };
    } catch (error) {
      if (isSerializationConflict(error) && attempt < RESET_ISSUE_ATTEMPTS) continue;
      throw error;
    }
  }

  throw new Error('Unable to issue password reset token safely');
}

async function auditRecoveryEvent(params: {
  action: string;
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  tokenHash?: string | null;
  outcome?: string;
}) {
  try {
    const [identifierHash, ipHash] = await Promise.all([
      params.email
        ? authPrivacyDigest('audit:recovery:email', params.email)
        : Promise.resolve(null),
      params.ip ? authPrivacyDigest('audit:recovery:ip', params.ip) : Promise.resolve(null),
    ]);
    await emitAuditEvent({
      action: params.action,
      source: 'AUTH',
      target: { type: 'USER', id: params.userId ?? null },
      actor: { type: 'SYSTEM' },
      metadata: {
        identifierHash,
        ipHash,
        tokenHash: params.tokenHash ?? null,
        outcome: params.outcome ?? null,
      },
    });
  } catch (error) {
    logger.error('password.reset.audit.error', {
      component: 'password-reset',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Shared auth rate-limit contract for invite/admin/recovery callers. Consumers
 * can safely branch on AppError code instead of parsing exception messages.
 */
export async function checkRateLimit(
  identifier: string,
  ip?: string,
  action: string = 'PASSWORD_RESET_INITIATED'
) {
  const [identifierRate, ipRate] = await Promise.all([
    identifier === 'unknown'
      ? Promise.resolve({ allowed: true })
      : consumeAuthRateLimit(
          `${action.toLowerCase()}:identifier`,
          identifier,
          5,
          INIT_IDENTIFIER_WINDOW_MS
        ),
    ip
      ? consumeAuthRateLimit(`${action.toLowerCase()}:ip`, ip, 20, INIT_IP_WINDOW_MS)
      : Promise.resolve({ allowed: true }),
  ]);

  if (!identifierRate.allowed || !ipRate.allowed) {
    throw new AppError({
      code: 'RATE_LIMIT_EXCEEDED',
      userMessage: 'Too many requests',
      retryable: true,
    });
  }
}

export async function simulateWork(startTime: number) {
  try {
    await bcrypt.compare('opsknight-timing-padding', DUMMY_BCRYPT_HASH);
  } catch {
    // Timing padding only.
  }
  const targetMs = randomInt(400, 501);
  const elapsed = Date.now() - startTime;
  if (elapsed < targetMs) await new Promise(resolve => setTimeout(resolve, targetMs - elapsed));
}

export async function initiatePasswordReset(
  email: string,
  ipAddress?: string
): Promise<PasswordResetResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const startTime = Date.now();

  try {
    try {
      await checkRateLimit(normalizedEmail, ipAddress);
    } catch (error) {
      if (!isAppError(error) || error.code !== 'RATE_LIMIT_EXCEEDED') throw error;
      await auditRecoveryEvent({
        action: 'auth.password_reset.rate_limited',
        email: normalizedEmail,
        ip: ipAddress,
        outcome: 'rate_limited',
      });
      await simulateWork(startTime);
      return { success: true, message: GENERIC_RESET_MESSAGE };
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        phoneNumber: true,
        smsNotificationsEnabled: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      await auditRecoveryEvent({
        action: 'auth.password_reset.requested',
        email: normalizedEmail,
        ip: ipAddress,
        outcome: 'accepted_generic',
      });
      await simulateWork(startTime);
      return { success: true, message: GENERIC_RESET_MESSAGE };
    }

    const { token, tokenHash, expiresAt } = await issuePasswordResetToken({
      userId: user.id,
      email: user.email,
    });

    const { getEmailConfig, getSMSConfig } = await import('./notification-providers');
    const { getAppUrl } = await import('@/lib/app-url');
    const { enqueueCentralNotification } = await import('@/lib/notification-control-plane');
    const appUrl = (await getAppUrl()).replace(/\/$/, '');
    const resetLink = `${appUrl}/reset-password#token=${encodeURIComponent(token)}`;
    const emailConfig = await getEmailConfig();

    if (emailConfig?.enabled) {
      const { getPasswordResetEmailTemplate } = await import(
        '@/lib/password-reset-email-template'
      );
      const template = getPasswordResetEmailTemplate({
        userName: user.name || 'User',
        resetLink,
        expiryMinutes: RESET_TOKEN_TTL_MS / 60_000,
      });
      await enqueueCentralNotification(
        {
          category: 'SECURITY',
          channel: 'EMAIL',
          recipientType: 'USER',
          recipientId: user.id,
          recipientAddress: user.email,
          userId: user.id,
          templateKey: 'password-reset',
          sourceType: 'USER',
          sourceId: user.id,
          eventKey: tokenHash,
          displayMessage: 'Password reset instructions',
          expiresAt,
          priority: 0,
          payload: {
            kind: 'EMAIL',
            to: user.email,
            subject: template.subject,
            text: template.text,
            html: template.html,
          },
        },
        { dispatchImmediately: false }
      );
    } else if (user.phoneNumber && user.smsNotificationsEnabled) {
      const smsConfig = await getSMSConfig();
      if (smsConfig?.enabled) {
        await enqueueCentralNotification(
          {
            category: 'SECURITY',
            channel: 'SMS',
            recipientType: 'USER',
            recipientId: user.id,
            recipientAddress: user.phoneNumber,
            userId: user.id,
            templateKey: 'password-reset-sms',
            sourceType: 'USER',
            sourceId: user.id,
            eventKey: tokenHash,
            displayMessage: 'Password reset instructions',
            expiresAt,
            priority: 0,
            payload: {
              kind: 'SMS',
              to: user.phoneNumber,
              message: `Reset your OpsKnight password: ${resetLink}`,
            },
          },
          { dispatchImmediately: false }
        );
      }
    }

    await auditRecoveryEvent({
      action: 'auth.password_reset.requested',
      userId: user.id,
      email: normalizedEmail,
      ip: ipAddress,
      tokenHash,
      outcome: 'accepted',
    });
    await simulateWork(startTime);
    return { success: true, message: GENERIC_RESET_MESSAGE };
  } catch (error) {
    logger.error('password.reset.initiate.error', {
      component: 'password-reset',
      error: error instanceof Error ? error.message : String(error),
    });
    await simulateWork(startTime);
    return { success: true, message: GENERIC_RESET_MESSAGE };
  }
}

export async function completePasswordReset(
  token: string,
  password: string,
  ip?: string
): Promise<PasswordResetCompletionResult> {
  if (!token || token.length > 512) {
    return {
      success: false,
      code: 'INVALID_TOKEN',
      error: 'Invalid or expired reset link.',
    };
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  try {
    const [tokenRate, ipRate] = await Promise.all([
      consumeAuthRateLimit('password-reset:complete:token', tokenHash, 5, COMPLETION_WINDOW_MS),
      ip
        ? consumeAuthRateLimit('password-reset:complete:ip', ip, 20, COMPLETION_WINDOW_MS)
        : Promise.resolve({ allowed: true }),
    ]);

    if (!tokenRate.allowed || !ipRate.allowed) {
      await auditRecoveryEvent({
        action: 'auth.password_reset.rate_limited',
        ip,
        tokenHash,
        outcome: 'completion_rate_limited',
      });
      return {
        success: false,
        code: 'RATE_LIMITED',
        error: 'Too many reset attempts. Request a new link or try again later.',
      };
    }

    const record = await prisma.userToken.findFirst({
      where: {
        tokenHash,
        type: 'PASSWORD_RESET',
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true, identifier: true },
    });
    if (!record) {
      await auditRecoveryEvent({
        action: 'auth.password_reset.token_invalid',
        ip,
        tokenHash,
        outcome: 'invalid_or_expired',
      });
      return {
        success: false,
        code: 'INVALID_TOKEN',
        error: 'Invalid or expired reset link.',
      };
    }

    const user = await prisma.user.findFirst({
      where: record.userId ? { id: record.userId } : { email: record.identifier },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        phoneNumber: true,
        smsNotificationsEnabled: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      return {
        success: false,
        code: 'INVALID_TOKEN',
        error: 'Invalid or expired reset link.',
      };
    }

    const passwordError = validatePasswordStrength(password || '', {
      email: user.email,
      displayName: user.name,
    });
    if (passwordError) {
      return { success: false, code: 'WEAK_PASSWORD', error: passwordError };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    await prisma.$transaction(async tx => {
      const claimed = await tx.userToken.updateMany({
        where: {
          id: record.id,
          tokenHash,
          type: 'PASSWORD_RESET',
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new Error('RESET_TOKEN_ALREADY_USED');

      const updated = await tx.user.updateMany({
        where: { id: user.id, status: 'ACTIVE' },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error('RESET_USER_STATE_CHANGED');

      await tx.userToken.updateMany({
        where: {
          type: 'PASSWORD_RESET',
          usedAt: null,
          revokedAt: null,
          OR: [{ userId: user.id }, { identifier: user.email }],
        },
        data: { revokedAt: now },
      });
    });

    await auditRecoveryEvent({
      action: 'auth.password_reset.completed',
      userId: user.id,
      email: user.email,
      ip,
      tokenHash,
      outcome: 'completed',
    });

    try {
      const { getEmailConfig, getSMSConfig } = await import('./notification-providers');
      const { enqueueCentralNotification } = await import('@/lib/notification-control-plane');
      const emailConfig = await getEmailConfig();

      if (emailConfig?.enabled) {
        await enqueueCentralNotification(
          {
            category: 'SECURITY',
            channel: 'EMAIL',
            recipientType: 'USER',
            recipientId: user.id,
            recipientAddress: user.email,
            userId: user.id,
            templateKey: 'password-changed',
            sourceType: 'USER',
            sourceId: user.id,
            eventKey: `password-changed:${tokenHash}`,
            displayMessage: 'Password changed',
            priority: 0,
            payload: {
              kind: 'EMAIL',
              to: user.email,
              subject: 'Your OpsKnight password was changed',
              text: `Your OpsKnight password was changed at ${now.toISOString()}. If this was not you, contact your administrator immediately.`,
            },
          },
          { dispatchImmediately: false }
        );
      } else if (user.phoneNumber && user.smsNotificationsEnabled) {
        const smsConfig = await getSMSConfig();
        if (smsConfig?.enabled) {
          await enqueueCentralNotification(
            {
              category: 'SECURITY',
              channel: 'SMS',
              recipientType: 'USER',
              recipientId: user.id,
              recipientAddress: user.phoneNumber,
              userId: user.id,
              templateKey: 'password-changed-sms',
              sourceType: 'USER',
              sourceId: user.id,
              eventKey: `password-changed:${tokenHash}`,
              displayMessage: 'Password changed',
              priority: 0,
              payload: {
                kind: 'SMS',
                to: user.phoneNumber,
                message: `Your OpsKnight password was changed at ${now.toISOString()}. If this was not you, contact your administrator immediately.`,
              },
            },
            { dispatchImmediately: false }
          );
        }
      }
    } catch (error) {
      logger.warn('auth.password_reset.notification_failed', {
        component: 'password-reset',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('auth.password_reset.session_revoked', {
      component: 'password-reset',
      userId: user.id,
    });
    return { success: true, message: 'Password reset successfully.' };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'RESET_TOKEN_ALREADY_USED' || error.message === 'RESET_USER_STATE_CHANGED')
    ) {
      return {
        success: false,
        code: 'INVALID_TOKEN',
        error: 'Invalid or expired reset link.',
      };
    }
    logger.error('password.reset.complete.error', {
      component: 'password-reset',
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, code: 'INTERNAL', error: 'Unable to reset password.' };
  }
}
