/**
 * Login Security Module
 *
 * Provides rate limiting, brute force protection, and audit logging for the login system.
 * This module tracks failed login attempts and implements progressive lockout.
 */

import { logger } from '@/lib/logger';

// In-memory store for failed attempts (use Redis in production for distributed systems)
interface AttemptRecord {
  count: number;
  lastAttempt: number;
  lockedUntil: number | null;
}

const attemptStore = new Map<string, AttemptRecord>();

// Configuration
const LOGIN_SECURITY_CONFIG = {
  // Maximum failed attempts before initial lockout
  MAX_ATTEMPTS: 5,
  // Base lockout duration in ms (1 minute)
  BASE_LOCKOUT_MS: 60 * 1000,
  // Multiplier for progressive lockout (1m, 5m, 15m, 60m)
  LOCKOUT_MULTIPLIERS: [1, 5, 15, 60],
  // Window to count attempts (15 minutes)
  ATTEMPT_WINDOW_MS: 15 * 60 * 1000,
  // Time after which attempts are reset if no new attempts
  RESET_AFTER_MS: 60 * 60 * 1000, // 1 hour
};

/**
 * Normalize IP address (handle IPv6 subnets)
 */
function normalizeIp(ip: string): string {
  if (ip.includes(':')) {
    // Simple/Naive IPv6 /64 normalization
    // Take first 4 segments: 2001:db8:abcd:0012:...
    const segments = ip.split(':');
    if (segments.length >= 4) {
      return segments.slice(0, 4).join(':') + '::/64';
    }
  }
  return ip;
}

/**
 * Generates a unique key for tracking attempts
 */
function getAttemptKey(email: string, ip: string): string {
  return `login:${email.toLowerCase()}:${normalizeIp(ip)}`;
}

/**
 * Gets the current lockout multiplier based on consecutive lockouts
 */
function getLockoutMultiplier(lockoutCount: number): number {
  const idx = Math.min(lockoutCount, LOGIN_SECURITY_CONFIG.LOCKOUT_MULTIPLIERS.length - 1);
  return LOGIN_SECURITY_CONFIG.LOCKOUT_MULTIPLIERS[idx];
}

/**
 * Check if a login attempt is allowed
 */
export function checkLoginAttempt(
  email: string,
  ip: string
): {
  allowed: boolean;
  remainingAttempts: number;
  lockedUntil: Date | null;
  lockoutDurationMs: number | null;
} {
  const key = getAttemptKey(email, ip);
  const record = attemptStore.get(key);
  const now = Date.now();

  // No record = first attempt, allowed
  if (!record) {
    return {
      allowed: true,
      remainingAttempts: LOGIN_SECURITY_CONFIG.MAX_ATTEMPTS,
      lockedUntil: null,
      lockoutDurationMs: null,
    };
  }

  // Check if still locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingMs = record.lockedUntil - now;
    logger.warn('[LoginSecurity] Login attempt blocked - account locked', {
      component: 'login-security',
      email,
      ip,
      lockedUntil: new Date(record.lockedUntil).toISOString(),
      remainingMs,
    });
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: new Date(record.lockedUntil),
      lockoutDurationMs: remainingMs,
    };
  }

  // Check if record should be reset (no attempts in RESET_AFTER_MS)
  if (now - record.lastAttempt > LOGIN_SECURITY_CONFIG.RESET_AFTER_MS) {
    attemptStore.delete(key);
    return {
      allowed: true,
      remainingAttempts: LOGIN_SECURITY_CONFIG.MAX_ATTEMPTS,
      lockedUntil: null,
      lockoutDurationMs: null,
    };
  }

  // Check remaining attempts
  const remaining = LOGIN_SECURITY_CONFIG.MAX_ATTEMPTS - record.count;
  return {
    allowed: remaining > 0,
    remainingAttempts: Math.max(0, remaining),
    lockedUntil: null,
    lockoutDurationMs: null,
  };
}

/**
 * Record a failed login attempt
 */
export function recordFailedAttempt(
  email: string,
  ip: string
): {
  attemptCount: number;
  locked: boolean;
  lockedUntil: Date | null;
  lockoutDurationMs: number | null;
} {
  const key = getAttemptKey(email, ip);
  const now = Date.now();
  let record = attemptStore.get(key);

  if (!record) {
    record = {
      count: 0,
      lastAttempt: now,
      lockedUntil: null,
    };
  }

  // If lockout has expired, reset count but keep history for progressive lockouts
  if (record.lockedUntil && now >= record.lockedUntil) {
    record.lockedUntil = null;
  }

  // Increment attempt count
  record.count++;
  record.lastAttempt = now;

  // Check if should lock out
  if (record.count >= LOGIN_SECURITY_CONFIG.MAX_ATTEMPTS) {
    // Calculate lockout count (how many times we've locked this key)
    const lockoutCount = Math.floor(record.count / LOGIN_SECURITY_CONFIG.MAX_ATTEMPTS);
    const multiplier = getLockoutMultiplier(lockoutCount - 1);
    const lockoutDuration = LOGIN_SECURITY_CONFIG.BASE_LOCKOUT_MS * multiplier;
    record.lockedUntil = now + lockoutDuration;

    logger.warn('[LoginSecurity] Account locked due to failed attempts', {
      component: 'login-security',
      email,
      ip,
      attemptCount: record.count,
      lockoutCount,
      lockoutDurationMs: lockoutDuration,
      lockedUntil: new Date(record.lockedUntil).toISOString(),
    });

    attemptStore.set(key, record);

    return {
      attemptCount: record.count,
      locked: true,
      lockedUntil: new Date(record.lockedUntil),
      lockoutDurationMs: lockoutDuration,
    };
  }

  attemptStore.set(key, record);

  logger.debug('[LoginSecurity] Failed attempt recorded', {
    component: 'login-security',
    email,
    ip,
    attemptCount: record.count,
    remainingAttempts: LOGIN_SECURITY_CONFIG.MAX_ATTEMPTS - record.count,
  });

  return {
    attemptCount: record.count,
    locked: false,
    lockedUntil: null,
    lockoutDurationMs: null,
  };
}

/**
 * Reset attempts on successful login
 */
export function resetLoginAttempts(email: string, ip: string): void {
  const key = getAttemptKey(email, ip);
  attemptStore.delete(key);

  logger.debug('[LoginSecurity] Login attempts reset on successful login', {
    component: 'login-security',
    email,
    ip,
  });
}

/**
 * Get the current attempt count for display purposes
 */
export function getAttemptCount(email: string, ip: string): number {
  const key = getAttemptKey(email, ip);
  const record = attemptStore.get(key);
  return record?.count ?? 0;
}

/**
 * Check if CAPTCHA should be shown (after 3 failed attempts)
 */
export function shouldShowCaptcha(email: string, ip: string): boolean {
  const count = getAttemptCount(email, ip);
  return count >= 3;
}

/**
 * Validate email format (server-side)
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;

  // Trim and lowercase
  const trimmed = email.trim().toLowerCase();

  // Basic length check
  if (trimmed.length < 5 || trimmed.length > 254) return false;

  // RFC 5322 compliant regex (simplified)
  const emailRegex =
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

  if (!emailRegex.test(trimmed)) return false;

  // Additional checks
  const [local, domain] = trimmed.split('@');

  // Local part checks
  if (!local || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;

  // Domain checks
  if (!domain || domain.length > 253) return false;
  if (domain.startsWith('-') || domain.endsWith('-') || domain.includes('..')) return false;

  // Must have at least one dot in domain
  if (!domain.includes('.')) return false;

  return true;
}

/**
 * Format lockout duration for display
 */
export function formatLockoutDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;

  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours !== 1 ? 's' : ''}`;
}

/**
 * Clean up expired records (should be called periodically)
 */
export function cleanupExpiredRecords(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, record] of attemptStore.entries()) {
    if (now - record.lastAttempt > LOGIN_SECURITY_CONFIG.RESET_AFTER_MS) {
      attemptStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug('[LoginSecurity] Cleaned up expired records', {
      component: 'login-security',
      cleanedCount: cleaned,
    });
  }

  return cleaned;
}

// Export config for reference
export const LOGIN_LIMITS = {
  MAX_ATTEMPTS: LOGIN_SECURITY_CONFIG.MAX_ATTEMPTS,
  LOCKOUT_DURATIONS: LOGIN_SECURITY_CONFIG.LOCKOUT_MULTIPLIERS.map(
    m => LOGIN_SECURITY_CONFIG.BASE_LOCKOUT_MS * m
  ),
};
