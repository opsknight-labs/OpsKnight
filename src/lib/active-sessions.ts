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
const HEARTBEAT_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes

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
  const cacheKey = `${userId}:${parsed.browser}:${parsed.os}:${ip}`;
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

  // Determine cutoff date: either the last session revocation or 30 days ago (max session lifetime)
  let cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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

  // Group events by client identity (Browser + OS + IP or UserAgent)
  const sessionMap = new Map<string, ActiveSession>();

  for (const log of sessionLogs) {
    const details = (log.details as Record<string, unknown>) || {};
    const metadata = (details.metadata as Record<string, unknown>) || {};
    const ua = (metadata.userAgent as string) || (details.userAgent as string) || '';
    const parsed = parseUserAgent(ua);
    const ip = log.ip || (details.ip as string) || 'Unknown IP';

    // Unique identity key per physical client
    const key = `${parsed.browser}:${parsed.os}:${ip}`;

    const isCurrent =
      Boolean(currentUserAgent) &&
      parsed.browser === currentParsed.browser &&
      parsed.os === currentParsed.os;

    if (!sessionMap.has(key)) {
      sessionMap.set(key, {
        id: log.id,
        browser: parsed.browser,
        os: parsed.os,
        deviceType: parsed.deviceType,
        ip,
        isCurrent,
        lastActive: log.createdAt.toISOString(),
        tokenVersion,
      });
    }
  }

  // Always ensure current device is present in the list
  const currentKey = `${currentParsed.browser}:${currentParsed.os}:${currentIp || '127.0.0.1'}`;
  let hasCurrent = false;

  for (const session of sessionMap.values()) {
    if (session.isCurrent) {
      hasCurrent = true;
      break;
    }
  }

  if (!hasCurrent) {
    sessionMap.set(currentKey, {
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

  // Sort sessions: Current device first, then by lastActive descending
  const sessions = Array.from(sessionMap.values()).sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
  });

  return sessions;
}
