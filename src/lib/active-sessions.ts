import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';

export interface ParsedDeviceInfo {
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  isMobile: boolean;
}

/**
 * Parses user agent string into human-friendly browser, OS, and device classification.
 */
export function parseUserAgent(userAgent?: string | null): ParsedDeviceInfo {
  if (!userAgent || typeof userAgent !== 'string') {
    return {
      browser: 'Web Browser',
      os: 'Unknown Device',
      deviceType: 'desktop',
      isMobile: false,
    };
  }

  const ua = userAgent;
  let browser = 'Web Browser';
  let os = 'Unknown OS';

  // 1. Detect Device Form Factor
  const isTablet = /iPad|tablet|(android(?!.*mobile))/i.test(ua);
  const isMobile =
    /Mobile|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|CriOS/i.test(ua) && !isTablet;
  const deviceType: 'desktop' | 'mobile' | 'tablet' = isTablet
    ? 'tablet'
    : isMobile
      ? 'mobile'
      : 'desktop';

  // 2. Detect Browser (Order matters: Edge/Opera/Brave before generic Chrome/Safari)
  if (/Edg(?:e|A|iOS)?\/([0-9.]+)/i.test(ua) || ua.includes('Edg/') || ua.includes('Edge/')) {
    browser = 'Microsoft Edge';
  } else if (/OPR\/|Opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/Brave/i.test(ua)) {
    browser = 'Brave';
  } else if (/Chrome\/|CriOS\//i.test(ua)) {
    browser = 'Google Chrome';
  } else if (/Firefox\/|FxiOS\//i.test(ua)) {
    browser = 'Mozilla Firefox';
  } else if (/Version\/.*Safari/i.test(ua) || (ua.includes('Safari') && !ua.includes('Chrome'))) {
    browser = 'Apple Safari';
  }

  // 3. Detect Operating System (iOS/iPadOS must be checked before Mac OS X since iPhone UA includes 'like Mac OS X')
  if (/iPhone|iPad|iPod/i.test(ua)) {
    os = isTablet ? 'iPadOS' : 'iOS';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS';
  } else if (/Windows NT 10.0/i.test(ua)) {
    os = 'Windows';
  } else if (/Windows/i.test(ua)) {
    os = 'Windows';
  } else if (/Android/i.test(ua)) {
    os = 'Android';
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  return { browser, os, deviceType, isMobile: isMobile || isTablet };
}

export interface ActiveSession {
  id: string;
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  ip: string;
  isCurrent: boolean;
  lastActive: string; // ISO string
  tokenVersion: number;
}

// In-memory throttle to avoid writing heartbeats too frequently
const heartbeatCache = new Map<string, number>();
const HEARTBEAT_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes (keeps open browser tabs firmly in Active Now)

/**
 * Records an active session heartbeat if throttled window has elapsed.
 */
export async function recordSessionHeartbeat({
  userId,
  userAgent,
  ip,
}: {
  userId: string;
  userAgent: string;
  ip: string;
}): Promise<void> {
  if (!userId) return;

  const parsed = parseUserAgent(userAgent);
  const cacheKey = `${userId}:${parsed.browser}:${parsed.os}:${parsed.deviceType}`;
  const now = Date.now();
  const lastHeartbeat = heartbeatCache.get(cacheKey) ?? 0;

  if (now - lastHeartbeat < HEARTBEAT_THROTTLE_MS) {
    return;
  }

  heartbeatCache.set(cacheKey, now);

  try {
    await emitAuditEvent({
      action: 'SESSION_HEARTBEAT',
      source: 'AUTH',
      target: { type: 'USER', id: userId },
      actor: { type: 'USER', id: userId },
      occurredAt: new Date(now),
      ip: ip || null,
      metadata: {
        userAgent: userAgent.slice(0, 500),
        browser: parsed.browser,
        os: parsed.os,
        deviceType: parsed.deviceType,
      },
    });
  } catch {
    // Non-critical, swallow error to prevent blocking request
  }
}

/**
 * Resolves all distinct active sessions for a user from their audit trail.
 */
export async function getUserActiveSessions({
  userId,
  currentIp,
  currentUserAgent,
  tokenVersion = 0,
}: {
  userId: string;
  currentIp?: string;
  currentUserAgent?: string;
  tokenVersion?: number;
}): Promise<ActiveSession[]> {
  const currentParsed = parseUserAgent(currentUserAgent);

  // Active session cutoff window: 14 days (stale/dormant devices drop off)
  const ACTIVE_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  let cutoffDate = new Date(Date.now() - ACTIVE_SESSION_MAX_AGE_MS);

  try {
    const lastRevocation = await prisma.auditLog.findFirst({
      where: {
        actorId: userId,
        action: 'session.revoked_all',
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (lastRevocation && lastRevocation.createdAt > cutoffDate) {
      cutoffDate = lastRevocation.createdAt;
    }
  } catch {
    // ignore
  }

  // Fetch all recent login and heartbeat events
  const sessionLogs = await prisma.auditLog.findMany({
    where: {
      OR: [{ actorId: userId }, { entityId: userId }],
      action: { in: ['LOGIN_SUCCESS', 'SESSION_HEARTBEAT'] },
      createdAt: { gte: cutoffDate },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      action: true,
      ip: true,
      details: true,
      createdAt: true,
    },
  });

  // Group events by distinct client device profile (Browser + OS + DeviceType).
  // Since sessionLogs are sorted descending by createdAt, the first entry encountered
  // is guaranteed to be the most recent activity and IP for that physical device.
  const deviceMap = new Map<string, ActiveSession>();

  for (const log of sessionLogs) {
    const details = (log.details as Record<string, unknown>) || {};
    const metadata = (details.metadata as Record<string, unknown>) || {};
    const ua = (metadata.userAgent as string) || (details.userAgent as string) || '';
    const parsed = parseUserAgent(ua);
    const ip = log.ip || (details.ip as string) || 'Unknown IP';

    // Grouping key per physical client device profile
    const deviceKey = `${parsed.browser}:${parsed.os}:${parsed.deviceType}`;

    if (!deviceMap.has(deviceKey)) {
      deviceMap.set(deviceKey, {
        id: log.id,
        browser: parsed.browser,
        os: parsed.os,
        deviceType: parsed.deviceType,
        ip,
        isCurrent: false, // will be explicitly set for the single current device below
        lastActive: log.createdAt.toISOString(),
        tokenVersion,
      });
    }
  }

  // Current client device key
  const currentDeviceKey = `${currentParsed.browser}:${currentParsed.os}:${currentParsed.deviceType}`;

  if (deviceMap.has(currentDeviceKey)) {
    const currentSession = deviceMap.get(currentDeviceKey)!;
    currentSession.isCurrent = true;
    currentSession.lastActive = new Date().toISOString();
    if (currentIp && currentIp !== '127.0.0.1' && currentIp !== 'Unknown IP') {
      currentSession.ip = currentIp;
    }
  } else {
    // Current device had no prior audit log within the window; register it as current
    deviceMap.set(currentDeviceKey, {
      id: 'current-session',
      browser: currentParsed.browser,
      os: currentParsed.os,
      deviceType: currentParsed.deviceType,
      ip: currentIp || '127.0.0.1',
      isCurrent: true,
      lastActive: new Date().toISOString(),
      tokenVersion,
    });
  }

  // Sort sessions: Single current device first, then other devices sorted by lastActive descending
  const sessions = Array.from(deviceMap.values()).sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
  });

  return sessions;
}
