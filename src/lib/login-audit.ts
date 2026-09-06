/**
 * Login Audit Logging Module
 *
 * Provides comprehensive audit logging for all authentication events.
 * Logs to both the application logger and database for compliance.
 */

import { logger } from '@/lib/logger';
import { emitAuditEvent } from '@/lib/audit';
import prisma from '@/lib/prisma';

export type LoginEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_BLOCKED'
  | 'LOGOUT'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'SESSION_EXPIRED'
  | 'SESSION_EXTENDED';

export type FailureReason =
  | 'INVALID_CREDENTIALS'
  | 'USER_NOT_FOUND'
  | 'USER_DISABLED'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'INVALID_EMAIL_FORMAT'
  | 'SSO_FAILED'
  | 'SESSION_REVOKED'
  | null;

export interface LoginAuditData {
  email: string;
  ip: string;
  userAgent: string;
  eventType: LoginEventType;
  success: boolean;
  failureReason?: FailureReason;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a login-related event for audit purposes
 */
export async function logLoginEvent(data: LoginAuditData): Promise<void> {
  const timestamp = new Date();

  // Always log to application logger
  const logData = {
    component: 'login-audit',
    timestamp: timestamp.toISOString(),
    email: data.email,
    ip: data.ip,
    userAgent: truncateUserAgent(data.userAgent),
    eventType: data.eventType,
    success: data.success,
    failureReason: data.failureReason || null,
    userId: data.userId || null,
    ...data.metadata,
  };

  if (data.success) {
    logger.info(`[LoginAudit] ${data.eventType}`, logData);
  } else {
    logger.warn(`[LoginAudit] ${data.eventType}`, logData);
  }

  // Also store in database for compliance and reporting
  // Using the existing AuditLog model with entityType: AUTH_SESSION
  try {
    await emitAuditEvent({
      action: data.eventType,
      source: 'AUTH',
      target: { type: 'USER', id: data.userId ?? data.email },
      actor: data.userId
        ? { type: 'USER', id: data.userId, email: data.email }
        : { type: 'SYSTEM' },
      occurredAt: timestamp,
      targetEmail: data.email,
      ip: data.ip,
      metadata: {
        userAgent: truncateUserAgent(data.userAgent),
        success: data.success,
        failureReason: data.failureReason || null,
        ...data.metadata,
      },
    });
  } catch (error) {
    // Don't fail the login flow if audit logging fails
    logger.error('[LoginAudit] Failed to write audit log to database', {
      component: 'login-audit',
      error: error instanceof Error ? error.message : 'Unknown error',
      eventType: data.eventType,
      email: data.email,
    });
  }
}

/**
 * Log successful login
 */
export async function logLoginSuccess(
  email: string,
  userId: string,
  ip: string,
  userAgent: string,
  provider: 'credentials' | 'oidc' = 'credentials'
): Promise<void> {
  await logLoginEvent({
    email,
    ip,
    userAgent,
    eventType: 'LOGIN_SUCCESS',
    success: true,
    userId,
    metadata: { provider },
  });
}

/**
 * Log failed login attempt
 */
export async function logLoginFailed(
  email: string,
  ip: string,
  userAgent: string,
  reason: FailureReason,
  attemptCount?: number
): Promise<void> {
  await logLoginEvent({
    email,
    ip,
    userAgent,
    eventType: 'LOGIN_FAILED',
    success: false,
    failureReason: reason,
    metadata: attemptCount !== undefined ? { attemptCount } : undefined,
  });
}

/**
 * Log blocked login (rate limit or lockout)
 */
export async function logLoginBlocked(
  email: string,
  ip: string,
  userAgent: string,
  reason: 'ACCOUNT_LOCKED' | 'RATE_LIMITED',
  lockoutDurationMs?: number
): Promise<void> {
  await logLoginEvent({
    email,
    ip,
    userAgent,
    eventType: 'LOGIN_BLOCKED',
    success: false,
    failureReason: reason,
    metadata: lockoutDurationMs !== undefined ? { lockoutDurationMs } : undefined,
  });
}

/**
 * Log logout event
 */
export async function logLogout(
  email: string,
  userId: string,
  ip: string,
  userAgent: string
): Promise<void> {
  await logLoginEvent({
    email,
    ip,
    userAgent,
    eventType: 'LOGOUT',
    success: true,
    userId,
  });
}

/**
 * Log password reset request
 */
export async function logPasswordResetRequested(
  email: string,
  ip: string,
  userAgent: string
): Promise<void> {
  await logLoginEvent({
    email,
    ip,
    userAgent,
    eventType: 'PASSWORD_RESET_REQUESTED',
    success: true,
  });
}

/**
 * Log password reset completion
 */
export async function logPasswordResetCompleted(
  email: string,
  userId: string,
  ip: string,
  userAgent: string
): Promise<void> {
  await logLoginEvent({
    email,
    ip,
    userAgent,
    eventType: 'PASSWORD_RESET_COMPLETED',
    success: true,
    userId,
  });
}

/**
 * Truncate user agent string for storage (max 500 chars)
 */
function truncateUserAgent(userAgent: string): string {
  if (!userAgent) return 'Unknown';
  return userAgent.length > 500 ? userAgent.substring(0, 500) + '...' : userAgent;
}

/**
 * Get login history for a user (for security page)
 */
export async function getLoginHistory(
  userId: string,
  limit: number = 10
): Promise<
  Array<{
    timestamp: Date;
    eventType: string;
    ip: string;
    userAgent: string;
    success: boolean;
  }>
> {
  const logs = await prisma.auditLog.findMany({
    where: {
      actorId: userId,
      entityType: 'USER', // Using USER instead of AUTH_SESSION
      action: {
        in: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'LOGOUT'],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      createdAt: true,
      action: true,
      details: true,
    },
  });

  return logs.map(log => ({
    timestamp: log.createdAt,
    eventType: log.action,
    ip: ((log.details as Record<string, unknown>)?.ip as string) || 'Unknown',
    userAgent: ((log.details as Record<string, unknown>)?.userAgent as string) || 'Unknown',
    success:
      ((log.details as Record<string, unknown>)?.success as boolean) ??
      log.action === 'LOGIN_SUCCESS',
  }));
}

/**
 * Count failed login attempts for security alerts
 */
export async function countRecentFailedAttempts(
  email: string,
  hoursBack: number = 24
): Promise<number> {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  const count = await prisma.auditLog.count({
    where: {
      entityType: 'USER', // Using USER instead of AUTH_SESSION
      entityId: email,
      action: {
        in: ['LOGIN_FAILED', 'LOGIN_BLOCKED'],
      },
      createdAt: { gte: since },
    },
  });

  return count;
}
