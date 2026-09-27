import 'server-only';

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { parseUserAgent } from '@/lib/active-sessions';
import type { ResponderSessionPolicy } from '@/lib/pwa-session-policy';

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_DEVICE_PREFIX = 'session:';
const SESSION_PLATFORM_PREFIX = 'session:';
const REVOKED_PLATFORM_PREFIX = 'session:REVOKED:';
const MAX_SESSION_RECORD_AGE_MS = 100 * 24 * 60 * 60 * 1000;
const MAX_POSSIBLE_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const TOMBSTONE_SAFETY_BUFFER_MS = 24 * 60 * 60 * 1000;

/** Activity touch throttle — configurable, default 2 minutes. */
function activityThrottleMs(): number {
  const v = Number.parseInt(process.env.SESSION_ACTIVITY_THROTTLE_MS ?? '120000', 10);
  return Number.isFinite(v) && v >= 0 ? v : 120_000;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegisteredSessionPolicy = ResponderSessionPolicy | 'OIDC';

/**
 * ACTIVE   — exists, not revoked, not expired.
 * REVOKED  — explicitly revoked (stored in platform prefix).
 * EXPIRED  — past expiresAt; computed at read time, not stored.
 */
export type RegisteredSessionState = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export type RegisteredSession = {
  id: string;
  displayId: string;
  policy: RegisteredSessionPolicy;
  state: RegisteredSessionState;
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  createdAt: string;
  lastActive: string;
  expiresAt: string | null;
  isCurrent: boolean;
};

export type RegisteredSessionPage = {
  sessions: RegisteredSession[];
  nextCursor: string | null;
};

// ─── Metadata (v2; v1 read-compatible) ───────────────────────────────────────

type SessionMetadata = {
  v: 1 | 2;
  digest: string;
  expiresAt: string | null;
  userAgent?: string | null;
};

// ─── Two-tier activity throttle cache ────────────────────────────────────────
//
// Process-local pre-filter: if we already issued a DB touch for this session
// within half the throttle window, skip the DB call entirely.
// The DB-level conditional (WHERE lastUsed < cutoff) remains the distributed
// source of truth — this cache merely suppresses redundant writes on hot
// same-instance sessions without affecting cross-instance correctness.

const localTouchCache = new Map<string, number>();
const localUaRecorded = new Set<string>();

function isLocallyThrottled(sessionId: string, throttleMs: number): boolean {
  const last = localTouchCache.get(sessionId);
  if (last === undefined) return false;
  // Use half the throttle as the local fast-path window.
  return Date.now() - last < throttleMs / 2;
}

function markLocallyTouched(sessionId: string, userAgentRecorded = false): void {
  localTouchCache.set(sessionId, Date.now());
  if (userAgentRecorded) {
    localUaRecorded.add(sessionId);
  }
  // Prevent unbounded growth: evict oldest entries when cache grows large.
  if (localTouchCache.size > 10_000) {
    const oldest = localTouchCache.keys().next().value;
    if (oldest !== undefined) {
      localTouchCache.delete(oldest);
      localUaRecorded.delete(oldest);
    }
  }
}

export function resetLocalTouchCacheForTesting(): void {
  localTouchCache.clear();
  localUaRecorded.clear();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sessionDeviceId(sessionId: string) {
  return `${SESSION_DEVICE_PREFIX}${sessionId}`;
}

function digestSessionId(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('hex');
}

/**
 * Safe display identifier derived from a non-reversible SHA-256 fingerprint.
 * Formatted as an 8-character uppercase hex string to prevent collision while
 * never leaking the secret token/JTI to clients.
 * Example: "81A7F2C9"
 */
export function sessionDisplayId(sessionId: string): string {
  return digestSessionId(sessionId).slice(-8).toUpperCase();
}

/** Legacy alias for backward compatibility with 4-char suffix consumers */
export function sessionDisplaySuffix(sessionId: string): string {
  return sessionDisplayId(sessionId);
}

function activePlatform(policy: RegisteredSessionPolicy) {
  return `${SESSION_PLATFORM_PREFIX}${policy}`;
}

function revokedPlatform(policy: RegisteredSessionPolicy) {
  return `${REVOKED_PLATFORM_PREFIX}${policy}`;
}

function policyFromPlatform(platform: string): RegisteredSessionPolicy | null {
  const value = platform.startsWith(REVOKED_PLATFORM_PREFIX)
    ? platform.slice(REVOKED_PLATFORM_PREFIX.length)
    : platform.startsWith(SESSION_PLATFORM_PREFIX)
      ? platform.slice(SESSION_PLATFORM_PREFIX.length)
      : '';
  return value === 'STANDARD' || value === 'TRUSTED_PWA' || value === 'OIDC' ? value : null;
}

function isRevokedPlatform(platform: string) {
  return platform.startsWith(REVOKED_PLATFORM_PREFIX);
}

function metadataValue(
  sessionId: string,
  expiresAtSeconds?: number | null,
  userAgent?: string | null
): string {
  const metadata: SessionMetadata = {
    v: 2,
    digest: digestSessionId(sessionId),
    expiresAt:
      typeof expiresAtSeconds === 'number' && Number.isFinite(expiresAtSeconds)
        ? new Date(expiresAtSeconds * 1000).toISOString()
        : null,
    userAgent: userAgent ? userAgent.slice(0, 500) : null,
  };
  return JSON.stringify(metadata);
}

function parseMetadata(value: string): SessionMetadata | null {
  try {
    const parsed = JSON.parse(value) as Partial<SessionMetadata>;
    if ((parsed.v !== 1 && parsed.v !== 2) || typeof parsed.digest !== 'string') return null;
    return {
      v: parsed.v,
      digest: parsed.digest,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
      userAgent: parsed.v === 2 && typeof parsed.userAgent === 'string' ? parsed.userAgent : null,
    };
  } catch {
    return null;
  }
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

const activeSessionWhere = (userId: string): Prisma.UserDeviceWhereInput => ({
  userId,
  platform: { startsWith: SESSION_PLATFORM_PREFIX },
  NOT: { platform: { startsWith: REVOKED_PLATFORM_PREFIX } },
});

// ─── Keyset Cursor helpers (stable createdAt DESC, id DESC) ───────────────────

export type SessionCursor = { createdAt: Date; id: string };

export function encodeCursor(createdAtIso: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAtIso, id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): SessionCursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !parsed.id) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

// ─── Sentinel return values ───────────────────────────────────────────────────

/**
 * Three-valued result for registry lookup:
 *  'allowed'     — session exists and is active.
 *  'denied'      — session is explicitly revoked or invalid; reject request.
 *  'unavailable' — registry DB could not be reached.
 */
export type RegistryCheckResult = 'allowed' | 'denied' | 'unavailable';

/**
 * Lightweight check to verify a specific session is ACTIVE in the registry.
 * Fails closed: returns false if revoked, not found, or if DB is unreachable.
 * Used by long-lived SSE connections on each authorization recheck interval.
 */
export async function isSessionActive(userId: string, sessionId: string): Promise<boolean> {
  if (!userId || !sessionId) return false;
  try {
    const row = await prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId, deviceId: sessionDeviceId(sessionId) } },
      select: { platform: true, token: true },
    });
    if (!row || isRevokedPlatform(row.platform)) return false;
    const policy = policyFromPlatform(row.platform);
    const metadata = parseMetadata(row.token);
    if (!policy || !metadata || metadata.digest !== digestSessionId(sessionId)) return false;
    if (isExpired(metadata.expiresAt)) return false;
    return true;
  } catch {
    return false; // Fail closed
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Idempotently registers a session and checks its revocation status.
 *
 * For first-time registration (e.g. existing sessions after a deploy), stores
 * the userAgent immediately so the UI shows meaningful metadata.
 *
 * Expiry Synchronization: If a renewed JWT with an extended expiration is presented,
 * the stored metadata.expiresAt is updated reliably so tombstone cleanup never prematurely deletes
 * still-valid sessions.
 */
export async function ensureRegisteredSession(input: {
  sessionId: string;
  userId: string;
  policy: RegisteredSessionPolicy;
  expiresAtSeconds?: number | null;
  userAgent?: string | null;
}): Promise<RegistryCheckResult> {
  if (!input.sessionId || !input.userId) return 'denied';
  const deviceId = sessionDeviceId(input.sessionId);

  try {
    const existing = await prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: input.userId, deviceId } },
      select: { platform: true, token: true },
    });

    if (existing) {
      if (isRevokedPlatform(existing.platform)) return 'denied';
      const policy = policyFromPlatform(existing.platform);
      const metadata = parseMetadata(existing.token);
      if (!policy || !metadata || metadata.digest !== digestSessionId(input.sessionId)) {
        return 'denied';
      }

      // Synchronize expiry metadata if token was extended/renewed.
      // Must be awaited and fail-closed so stale expiry does not permit premature tombstone deletion.
      if (typeof input.expiresAtSeconds === 'number') {
        const newExpiryIso = new Date(input.expiresAtSeconds * 1000).toISOString();
        if (!metadata.expiresAt || new Date(newExpiryIso) > new Date(metadata.expiresAt)) {
          try {
            await prisma.userDevice.update({
              where: { userId_deviceId: { userId: input.userId, deviceId } },
              data: {
                token: metadataValue(
                  input.sessionId,
                  input.expiresAtSeconds,
                  input.userAgent ?? metadata.userAgent
                ),
              },
            });
          } catch (err) {
            logger.warn('session_registry.sync_expiry_failed', {
              component: 'session-registry',
              userId: input.userId,
              error: err,
            });
            return 'unavailable';
          }
        }
      }

      return 'allowed';
    }

    // Not found — create the registration.
    try {
      await prisma.userDevice.create({
        data: {
          userId: input.userId,
          deviceId,
          token: metadataValue(input.sessionId, input.expiresAtSeconds, input.userAgent),
          platform: activePlatform(input.policy),
          lastUsed: new Date(),
          ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 500) } : {}),
        },
      });
      return 'allowed';
    } catch (error) {
      const isP2002 =
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
        (error instanceof Error && (error as Error & { code?: string }).code === 'P2002');
      if (!isP2002) {
        throw error; // propagate to outer catch → 'unavailable'
      }
      // Concurrent creation race — re-read result.
      const raced = await prisma.userDevice.findUnique({
        where: { userId_deviceId: { userId: input.userId, deviceId } },
        select: { platform: true, token: true },
      });
      if (!raced || isRevokedPlatform(raced.platform)) return 'denied';
      const metadata = parseMetadata(raced.token);
      return policyFromPlatform(raced.platform) &&
        metadata &&
        metadata.digest === digestSessionId(input.sessionId)
        ? 'allowed'
        : 'denied';
    }
  } catch (error) {
    logger.warn('session_registry.ensure_failed', {
      component: 'session-registry',
      userId: input.userId,
      error,
    });
    return 'unavailable';
  }
}

/**
 * Updates a session's `lastUsed` with a two-tier distributed throttle.
 *
 * Tier 1 — Process-local fast-path: if this instance already issued a DB write
 * for this session within half the throttle window, skip the DB call entirely.
 *
 * Tier 2 — DB-conditional write: WHERE lastUsed < now - throttleMs ensures
 * multi-instance correctness without any shared state beyond the database.
 *
 * Always non-throwing / fail-open — errors are logged and swallowed so an
 * activity write failure never aborts an authenticated request.
 */
export async function touchSessionActivity(input: {
  userId: string;
  sessionId: string;
  userAgent?: string | null;
  throttleMs?: number;
}): Promise<void> {
  if (!input.userId || !input.sessionId) return;
  const throttle = input.throttleMs ?? activityThrottleMs();

  const hasUa = typeof input.userAgent === 'string' && input.userAgent.trim().length > 0;
  const cleanUa = hasUa ? input.userAgent!.slice(0, 500) : null;
  const needsUaEnrichment = cleanUa !== null && !localUaRecorded.has(input.sessionId);

  // Tier 1: local fast-path — skip DB entirely if recently touched by this instance,
  // UNLESS this request provides a userAgent that has not yet been recorded for this session.
  if (!needsUaEnrichment && isLocallyThrottled(input.sessionId, throttle)) return;

  try {
    const cutoff = new Date(Date.now() - throttle);
    // When cleanUa is provided, allow enriching the record if userAgent is missing (null),
    // even if lastUsed was set very recently (e.g. during initial JWT decode).
    const updated = await prisma.userDevice.updateMany({
      where: {
        ...activeSessionWhere(input.userId),
        deviceId: sessionDeviceId(input.sessionId),
        ...(cleanUa
          ? {
              OR: [{ lastUsed: { lt: cutoff } }, { userAgent: null }],
            }
          : {
              lastUsed: { lt: cutoff },
            }),
      },
      data: {
        lastUsed: new Date(),
        ...(cleanUa ? { userAgent: cleanUa } : {}),
      },
    });

    // Mark locally touched if we updated rows or if userAgent was already confirmed
    if (updated.count > 0 || cleanUa !== null) {
      markLocallyTouched(input.sessionId, cleanUa !== null);
    }
  } catch (error) {
    logger.warn('session_registry.touch_failed', {
      component: 'session-registry',
      userId: input.userId,
      error,
    });
  }
}

/**
 * Canonical centralized session activity touch for authenticated requests.
 *
 * Tier 1 — Process-local debounce: absorbs burst request storms (parallel assets,
 * XHR calls) without issuing redundant database roundtrips.
 *
 * Tier 2 — Distributed DB-conditional write: WHERE lastUsed < now - throttleMs ensures
 * multiple web replicas update lastUsed atomically without conflicting or drifting.
 *
 * Fail-open / non-throwing: errors are logged and swallowed so an activity write
 * failure never degrades user experience or request latency.
 */
export async function touchAuthenticatedSession(input: {
  userId: string;
  sessionId: string;
  userAgent?: string | null;
  throttleMs?: number;
}): Promise<void> {
  return touchSessionActivity(input);
}

/**
 * @deprecated Use `touchAuthenticatedSession`. Retained for backward compatibility.
 */
export async function recordRegisteredSessionActivity(input: {
  userId: string;
  sessionId: string;
  userAgent?: string | null;
}): Promise<void> {
  return touchSessionActivity(input);
}

export async function promoteRegisteredSessionPolicy(input: {
  userId: string;
  sessionId: string;
  policy: ResponderSessionPolicy;
}): Promise<boolean> {
  if (input.policy !== 'TRUSTED_PWA') return true;
  const deviceId = sessionDeviceId(input.sessionId);
  const existing = await prisma.userDevice.findUnique({
    where: { userId_deviceId: { userId: input.userId, deviceId } },
    select: { platform: true },
  });
  if (!existing || isRevokedPlatform(existing.platform)) return false;
  if (existing.platform === activePlatform('TRUSTED_PWA')) return true;
  if (existing.platform !== activePlatform('STANDARD')) return false;
  const updated = await prisma.userDevice.updateMany({
    where: { userId: input.userId, deviceId, platform: activePlatform('STANDARD') },
    data: { platform: activePlatform('TRUSTED_PWA'), lastUsed: new Date() },
  });
  return updated.count === 1;
}

/**
 * Returns a stable cursor-paginated list of Signed-in Sessions.
 *
 * Ordered deterministically by `createdAt DESC, deviceId DESC` so that background
 * `lastUsed` activity updates do not shuffle sessions between pages or cause
 * duplicate/missed rows during pagination.
 *
 * Strictly lists ACTIVE sessions (not expired, not revoked).
 */
export async function listRegisteredSessions(
  userId: string,
  currentSessionId?: string | null,
  cursor?: string | null,
  limit = 50
): Promise<RegisteredSessionPage> {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const cursorObj = cursor ? decodeCursor(cursor) : null;

  // Keyset condition: (createdAt < cursor.createdAt) OR (createdAt == cursor.createdAt AND id < cursor.id)
  const where: Prisma.UserDeviceWhereInput = {
    userId,
    platform: { startsWith: SESSION_PLATFORM_PREFIX },
    NOT: { platform: { startsWith: REVOKED_PLATFORM_PREFIX } },
    ...(cursorObj
      ? {
          OR: [
            { createdAt: { lt: cursorObj.createdAt } },
            {
              createdAt: cursorObj.createdAt,
              id: { lt: cursorObj.id },
            },
          ],
        }
      : {}),
  };

  const rows = await prisma.userDevice.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: safeLimit + 1,
    select: {
      id: true,
      deviceId: true,
      token: true,
      platform: true,
      userAgent: true,
      lastUsed: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

  const sessions = pageRows.flatMap(row => {
    const jti = row.deviceId.startsWith(SESSION_DEVICE_PREFIX)
      ? row.deviceId.slice(SESSION_DEVICE_PREFIX.length)
      : '';
    const policy = policyFromPlatform(row.platform);
    const metadata = parseMetadata(row.token);
    if (!jti || !policy || !metadata || metadata.digest !== digestSessionId(jti)) return [];

    const revoked = isRevokedPlatform(row.platform);
    if (revoked || isExpired(metadata.expiresAt)) return [];

    const device = parseUserAgent(row.userAgent);
    return [
      {
        id: row.id, // Opaque public session handle (UserDevice.id) — secret JTI stays strictly server-side
        displayId: sessionDisplayId(jti),
        policy,
        state: 'ACTIVE',
        browser: device.browser,
        os: device.os,
        deviceType: device.deviceType,
        createdAt: row.createdAt.toISOString(),
        lastActive: row.lastUsed.toISOString(),
        expiresAt: metadata.expiresAt,
        isCurrent: Boolean(currentSessionId && jti === currentSessionId),
      } satisfies RegisteredSession,
    ];
  });

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow ? encodeCursor(lastRow.createdAt.toISOString(), lastRow.id) : null;

  return { sessions, nextCursor };
}

export type RevokeSessionResult = {
  revoked: boolean;
  isCurrent: boolean;
};

/**
 * Maintenance cleanup routine for expired and revoked session records.
 * Can be scheduled via recurring job or maintenance script rather than
 * running on every user listing request.
 *
 * Security property: Revoked tombstones MUST NOT be deleted while the underlying
 * JWT could still be cryptographically valid. Premature deletion allows a valid
 * JWT to be re-registered via ensureRegisteredSession(), resurrecting the revoked session.
 * A tombstone is only safe to delete once `expiresAt + TOMBSTONE_SAFETY_BUFFER_MS`
 * has passed (or after MAX_POSSIBLE_TOKEN_LIFETIME_MS if no explicit expiresAt was set).
 */
export async function cleanupExpiredSessions(userId?: string): Promise<number> {
  const now = Date.now();
  let deletedCount = 0;

  // 1. Clean up active sessions older than the absolute maximum session record lifetime (100 days)
  const activeCleanup = await prisma.userDevice.deleteMany({
    where: {
      ...(userId ? { userId } : {}),
      platform: { startsWith: SESSION_PLATFORM_PREFIX },
      NOT: { platform: { startsWith: REVOKED_PLATFORM_PREFIX } },
      createdAt: { lt: new Date(now - MAX_SESSION_RECORD_AGE_MS) },
    },
  });
  deletedCount += activeCleanup.count;

  // 2. Clean up revoked tombstones:
  // ONLY delete tombstones where the token is guaranteed to be cryptographically expired.
  const revokedCandidates = await prisma.userDevice.findMany({
    where: {
      ...(userId ? { userId } : {}),
      platform: { startsWith: REVOKED_PLATFORM_PREFIX },
    },
    select: { id: true, createdAt: true, token: true },
    take: 1000,
  });

  const safeTombstoneIds: string[] = [];
  for (const row of revokedCandidates) {
    const metadata = parseMetadata(row.token);
    if (metadata?.expiresAt) {
      const expiresAtMs = new Date(metadata.expiresAt).getTime();
      if (Number.isFinite(expiresAtMs) && now >= expiresAtMs + TOMBSTONE_SAFETY_BUFFER_MS) {
        safeTombstoneIds.push(row.id);
      }
    } else {
      // If no explicit expiresAt, retain until max system-wide token lifetime + safety buffer
      if (
        now - row.createdAt.getTime() >=
        MAX_POSSIBLE_TOKEN_LIFETIME_MS + TOMBSTONE_SAFETY_BUFFER_MS
      ) {
        safeTombstoneIds.push(row.id);
      }
    }
  }

  if (safeTombstoneIds.length > 0) {
    const tombstoneCleanup = await prisma.userDevice.deleteMany({
      where: { id: { in: safeTombstoneIds } },
    });
    deletedCount += tombstoneCleanup.count;
  }

  return deletedCount;
}

export async function revokeRegisteredSession(input: {
  userId: string;
  sessionId: string;
  currentJti?: string | null;
}): Promise<RevokeSessionResult> {
  // Authorize by userId and match either the public handle (row.id) or internal deviceId
  const row = await prisma.userDevice.findFirst({
    where: {
      userId: input.userId,
      OR: [{ id: input.sessionId }, { deviceId: sessionDeviceId(input.sessionId) }],
    },
    select: { id: true, deviceId: true, platform: true },
  });
  if (!row) return { revoked: false, isCurrent: false };

  const isCurrent = Boolean(input.currentJti && row.deviceId === sessionDeviceId(input.currentJti));

  const policy = policyFromPlatform(row.platform);
  if (!policy || isRevokedPlatform(row.platform)) {
    return { revoked: false, isCurrent };
  }

  // Single conditional update covering all active policies to prevent promotion races
  const activePlatforms = [
    activePlatform('STANDARD'),
    activePlatform('TRUSTED_PWA'),
    activePlatform('OIDC'),
  ];

  const updated = await prisma.userDevice.updateMany({
    where: {
      id: row.id,
      userId: input.userId,
      platform: { in: activePlatforms },
    },
    data: { platform: revokedPlatform(policy), lastUsed: new Date() },
  });
  return { revoked: updated.count === 1, isCurrent };
}

/**
 * Bulk-revokes all active sessions in a single atomic transaction.
 */
export async function revokeAllRegisteredSessions(userId: string): Promise<number> {
  const policies: RegisteredSessionPolicy[] = ['STANDARD', 'TRUSTED_PWA', 'OIDC'];
  const results = await prisma.$transaction(
    policies.map(policy =>
      prisma.userDevice.updateMany({
        where: { userId, platform: activePlatform(policy) },
        data: { platform: revokedPlatform(policy), lastUsed: new Date() },
      })
    )
  );
  return results.reduce((sum, r) => sum + r.count, 0);
}
