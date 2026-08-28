import { randomBytes, createHash } from 'crypto';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { validatePasswordStrength } from '@/lib/passwords';
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS_PER_WINDOW = 5;

// Define simple result type locally to avoid import issues
type PasswordResetResult = {
  success: boolean;
  message: string;
};

/**
 * Initiates the password reset flow.
 * SECURE: Always returns a generic success message to prevent enumeration.
 */
export async function initiatePasswordReset(
  email: string,
  ipAddress?: string
): Promise<PasswordResetResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const startTime = Date.now();

  try {
    // 1. Rate Limit Check (Audit Log based)
    await checkRateLimit(normalizedEmail, ipAddress);

    // 2. User Lookup
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // 3. Timing Mitigation & User Validation
    if (!user || user.status === 'DISABLED') {
      await simulateWork(startTime);
      // Log attempt as failed/invalid but use same action to mask existence
      // SECURITY: Log even invalid attempts to AuditLog to prevent DoS via unmetered requests
      await logAttempt(normalizedEmail, 'PASSWORD_RESET_INITIATED', ipAddress, undefined);

      logger.debug('[PasswordReset] Request for unknown/disabled user', {
        component: 'password-reset',
      });
      return {
        success: true,
        message:
          'If an account exists with this email, you will receive password reset instructions.',
      };
    }

    // 4. Generate Token
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate old tokens
    await prisma.userToken.deleteMany({
      where: {
        identifier: normalizedEmail,
        type: 'PASSWORD_RESET',
        usedAt: null,
      },
    });

    // Store new token
    await prisma.userToken.create({
      data: {
        identifier: normalizedEmail,
        type: 'PASSWORD_RESET',
        tokenHash,
        expiresAt: expires,
      },
    });

    // 5. Send notification - try email first, fallback to SMS
    const { getEmailConfig, getSMSConfig } = await import('./notification-providers');
    const { getAppUrl } = await import('@/lib/app-url');
    const appUrl = await getAppUrl();
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    let notificationSent = false;

    // Try email first
    const emailConfig = await getEmailConfig();
    if (emailConfig?.enabled) {
      try {
        const { sendEmail } = await import('@/lib/email');
        const { getPasswordResetEmailTemplate } =
          await import('@/lib/password-reset-email-template');

        const emailTemplate = getPasswordResetEmailTemplate({
          userName: user.name || 'User',
          resetLink,
          expiryMinutes: 60,
        });

        await sendEmail({
          to: user.email,
          subject: emailTemplate.subject,
          text: emailTemplate.text,
          html: emailTemplate.html,
        });
        notificationSent = true;
      } catch (e) {
        const err = e as Error;
        logger.warn('[PasswordReset] Email sending failed, will try SMS fallback', {
          component: 'password-reset',
          error: err.message,
        });
      }
    }

    // Fallback to SMS if email failed/disabled and user has SMS enabled
    if (!notificationSent && user.phoneNumber && user.smsNotificationsEnabled) {
      const smsConfig = await getSMSConfig();
      if (smsConfig?.enabled) {
        try {
          const { sendSMS } = await import('@/lib/sms');
          await sendSMS({
            to: user.phoneNumber,
            message: `Reset your password: ${resetLink}`,
          });
          notificationSent = true;
        } catch (e) {
          logger.warn('[PasswordReset] SMS sending failed', {
            component: 'password-reset',
          });
        }
      }
    }

    if (!notificationSent) {
      logger.warn('[PasswordReset] No notification channel available', {
        component: 'password-reset',
      });
    }

    // Log successful initiation
    await logAttempt(normalizedEmail, 'PASSWORD_RESET_INITIATED', ipAddress, user.id);

    return {
      success: true,
      message:
        'If an account exists with this email, you will receive password reset instructions.',
    };
  } catch (error) {
    logger.error('password.reset.initiate.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, message: 'An internal error occurred.' };
  }
}

export async function checkRateLimit(
  email: string,
  ip?: string,
  action: string = 'PASSWORD_RESET_INITIATED'
) {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

  // Check by Email using new Indexed Column
  const emailCount = await prisma.auditLog.count({
    where: {
      action,
      targetEmail: email, // Direct indexed column lookup
      createdAt: { gt: windowStart },
    },
  });

  if (emailCount >= MAX_ATTEMPTS_PER_WINDOW) {
    throw new AppError({
      code: 'RATE_LIMIT_EXCEEDED',
      userMessage: 'Too many requests. Please try again later.',
      details: { scope: 'email', action },
    });
  }

  // Check by IP using new Indexed Column
  if (ip) {
    const ipCount = await prisma.auditLog.count({
      where: {
        action,
        ip: ip, // Direct indexed column lookup
        createdAt: { gt: windowStart },
      },
    });

    if (ipCount >= MAX_ATTEMPTS_PER_WINDOW * 2) {
      throw new AppError({
        code: 'RATE_LIMIT_EXCEEDED',
        userMessage: 'Too many requests from this IP.',
        details: { scope: 'ip', action },
      });
    }
  }
}

async function logAttempt(
  email: string,
  action: string,
  ip: string | undefined,
  userId: string | undefined = undefined
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType: 'USER',
        entityId: userId || 'unknown',
        actorId: userId,
        targetEmail: email, // Populate optimized column
        ip: ip, // Populate optimized column
        details: { targetEmail: email, ip }, // Keep JSON for potential extra data
      },
    });
  } catch (e) {
    logger.error('password.reset.audit.error', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function simulateWork(startTime: number) {
  const dummy = '$2a$10$abcdefghijklmnopqrstuv';
  try {
    await bcrypt.compare('dummy-password', dummy);
  } catch {}

  const elapsed = Date.now() - startTime;
  const minTime = 300;
  if (elapsed < minTime) {
    await new Promise(resolve => setTimeout(resolve, minTime - elapsed));
  }
}

// Keep completePasswordReset minimal as well or import if needed
// For now, I'll include the basic version to ensure file completeness
export async function completePasswordReset(
  token: string,
  password: string,
  ip?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  // Basic implementation needed to satisfy export if used elsewhere
  // Assuming completePasswordReset wasn't the cause of initiation crash.
  // Re-implementing a safe version.

  try {
    if (!token) return { success: false, error: 'Invalid token' };

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await prisma.userToken.findFirst({
      where: { tokenHash, type: 'PASSWORD_RESET', usedAt: null },
    });

    if (!record || record.expiresAt < new Date()) {
      return { success: false, error: 'Invalid or expired token' };
    }

    // Validate the token before the replacement password. Besides preserving the
    // reset API contract, this prevents used/expired tokens from returning
    // password-policy details instead of the canonical token error.
    const strengthError = validatePasswordStrength(password || '');
    if (strengthError) {
      return { success: false, error: strengthError };
    }

    const user = await prisma.user.findUnique({ where: { email: record.identifier } });
    if (!user) return { success: false, error: 'User not found' };

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await prisma.$transaction(async tx => {
      const updatedToken = await tx.userToken.updateMany({
        where: {
          tokenHash,
          type: 'PASSWORD_RESET',
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (updatedToken.count === 0) {
        throw new Error('TOKEN_EXPIRED_OR_USED');
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      });

      return true;
    });

    if (!result) {
      return { success: false, error: 'Invalid or expired token' };
    }

    // Log session revocation for observability
    logger.info('[PasswordReset] Password updated, sessions revoked', {
      component: 'password-reset',
      userId: user.id,
      email: user.email,
    });

    return { success: true, message: 'Password reset successfully' };
  } catch (e: any) {
    if (e?.message === 'TOKEN_EXPIRED_OR_USED') {
      return { success: false, error: 'Invalid or expired token' };
    }
    logger.error('password.reset.complete.error', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { success: false, error: 'Internal error' };
  }
}
