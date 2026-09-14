import 'server-only';

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { parseUserAgent } from '@/lib/active-sessions';
import type { ResponderSessionPolicy } from '@/lib/pwa-session-policy';

const SESSION_DEVICE_PREFIX = 'session:';
const SESSION_PLATFORM_PREFIX = 'session:';
const REVOKED_PLATFORM_PREFIX = 'session:REVOKED:';
const MAX_SESSION_RECORD_AGE_MS = 100 * 24 * 60 * 60 * 1000;
const MAX_REVOKED_RECORD_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type RegisteredSessionPolicy = ResponderSessionPolicy | 'OIDC';
export type RegisteredSessionState = 'ACTIVE' | 'REVOKED';

export type RegisteredSession = {
  id: string;
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

type SessionMetadata = {
  v: 1;
  digest: string;
  expiresAt: string | null;
};

function sessionDeviceId(sessionId: string) {
  return `${SESSION_DEVICE_PREFIX}${sessionId}`;
}
function digestSessionId(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('hex');
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
function metadataValue(sessionId: string, expiresAtSeconds?: number | null): string {
  const metadata: SessionMetadata = {
    v: 1,
    digest: digestSessionId(sessionId),
    expiresAt:
      typeof expiresAtSeconds === 'number' && Number.isFinite(expiresAtSeconds)
        ? new Date(expiresAtSeconds * 1000).toISOString()
        : null,
  };
  return JSON.stringify(metadata);
}
function parseMetadata(value: string): SessionMetadata | null {
  try {
    const parsed = JSON.parse(value) as Partial<SessionMetadata>;
    if (parsed.v !== 1 || typeof parsed.digest !== 'string') return null;
    return {
      v: 1,
      digest: parsed.digest,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    };
  } catch {
    return null;
  }
}

const activeSessionWhere = (userId: string): Prisma.UserDeviceWhereInput => ({
  userId,
  platform: { startsWith: SESSION_PLATFORM_PREFIX },
  NOT: { platform: { startsWith: REVOKED_PLATFORM_PREFIX } },
});

/**
 * Extended credential sessions register lazily on first authenticated decode.
 * This provides a durable per-JTI revocation fence without coupling Push rows to
 * authentication lifetime or introducing a second token format.
 */
export async function ensureRegisteredSession(input: {
  sessionId: string;
  userId: string;
  policy: RegisteredSessionPolicy;
  expiresAtSeconds?: number | null;
}): Promise<boolean> {
  if (!input.sessionId || !input.userId) return false;
  const deviceId = sessionDeviceId(input.sessionId);
  const existing = await prisma.userDevice.findUnique({
    where: { userId_deviceId: { userId: input.userId, deviceId } },
    select: { platform: true, token: true },
  });

  if (existing) {
    if (isRevokedPlatform(existing.platform)) return false;
    const policy = policyFromPlatform(existing.platform);
    const metadata = parseMetadata(existing.token);
    return Boolean(
      policy && metadata && metadata.digest === digestSessionId(input.sessionId)
    );
  }

  try {
    await prisma.userDevice.create({
      data: {
        userId: input.userId,
        deviceId,
        token: metadataValue(input.sessionId, input.expiresAtSeconds),
        platform: activePlatform(input.policy),
        lastUsed: new Date(),
      },
    });
    return true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const raced = await prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: input.userId, deviceId } },
      select: { platform: true, token: true },
    });
    if (!raced || isRevokedPlatform(raced.platform)) return false;
    const metadata = parseMetadata(raced.token);
    return Boolean(
      policyFromPlatform(raced.platform) &&
        metadata &&
        metadata.digest === digestSessionId(input.sessionId)
    );
  }
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
    where: {
      userId: input.userId,
      deviceId,
      platform: activePlatform('STANDARD'),
    },
    data: { platform: activePlatform('TRUSTED_PWA'), lastUsed: new Date() },
  });
  return updated.count === 1;
}

export async function recordRegisteredSessionActivity(input: {
  userId: string;
  sessionId: string;
  userAgent?: string | null;
}): Promise<void> {
  if (!input.userId || !input.sessionId) return;
  await prisma.userDevice.updateMany({
    where: { ...activeSessionWhere(input.userId), deviceId: sessionDeviceId(input.sessionId) },
    data: {
      lastUsed: new Date(),
      ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 500) } : {}),
    },
  });
}

export async function listRegisteredSessions(
  userId: string,
  currentSessionId?: string | null
): Promise<RegisteredSession[]> {
  const now = Date.now();
  await prisma.userDevice.deleteMany({
    where: {
      userId,
      OR: [
        {
          platform: { startsWith: REVOKED_PLATFORM_PREFIX },
          lastUsed: { lt: new Date(now - MAX_REVOKED_RECORD_AGE_MS) },
        },
        {
          AND: [
            { platform: { startsWith: SESSION_PLATFORM_PREFIX } },
            { NOT: { platform: { startsWith: REVOKED_PLATFORM_PREFIX } } },
          ],
          lastUsed: { lt: new Date(now - MAX_SESSION_RECORD_AGE_MS) },
        },
      ],
    },
  });

  const rows = await prisma.userDevice.findMany({
    where: { userId, platform: { startsWith: SESSION_PLATFORM_PREFIX } },
    orderBy: [{ lastUsed: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    select: {
      deviceId: true,
      token: true,
      platform: true,
      userAgent: true,
      lastUsed: true,
      createdAt: true,
    },
  });

  return rows.flatMap(row => {
    const id = row.deviceId.startsWith(SESSION_DEVICE_PREFIX)
      ? row.deviceId.slice(SESSION_DEVICE_PREFIX.length)
      : '';
    const policy = policyFromPlatform(row.platform);
    const metadata = parseMetadata(row.token);
    if (!id || !policy || !metadata || metadata.digest !== digestSessionId(id)) return [];
    const device = parseUserAgent(row.userAgent);
    return [
      {
        id,
        policy,
        state: isRevokedPlatform(row.platform) ? 'REVOKED' : 'ACTIVE',
        browser: device.browser,
        os: device.os,
        deviceType: device.deviceType,
        createdAt: row.createdAt.toISOString(),
        lastActive: row.lastUsed.toISOString(),
        expiresAt: metadata.expiresAt,
        isCurrent: Boolean(currentSessionId && id === currentSessionId),
      } satisfies RegisteredSession,
    ];
  });
}

export async function revokeRegisteredSession(input: {
  userId: string;
  sessionId: string;
}): Promise<boolean> {
  const row = await prisma.userDevice.findUnique({
    where: {
      userId_deviceId: {
        userId: input.userId,
        deviceId: sessionDeviceId(input.sessionId),
      },
    },
    select: { platform: true },
  });
  const policy = row ? policyFromPlatform(row.platform) : null;
  if (!row || !policy || isRevokedPlatform(row.platform)) return false;
  const updated = await prisma.userDevice.updateMany({
    where: { userId: input.userId, deviceId: sessionDeviceId(input.sessionId), platform: row.platform },
    data: { platform: revokedPlatform(policy), lastUsed: new Date() },
  });
  return updated.count === 1;
}

export async function revokeAllRegisteredSessions(userId: string): Promise<number> {
  const active = await prisma.userDevice.findMany({
    where: activeSessionWhere(userId),
    select: { id: true, platform: true },
  });
  let revoked = 0;
  for (const row of active) {
    const policy = policyFromPlatform(row.platform);
    if (!policy) continue;
    const result = await prisma.userDevice.updateMany({
      where: { id: row.id, platform: row.platform },
      data: { platform: revokedPlatform(policy), lastUsed: new Date() },
    });
    revoked += result.count;
  }
  return revoked;
}
