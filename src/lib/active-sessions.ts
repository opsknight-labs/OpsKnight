// NOTE: recordSessionHeartbeat() and getUserActiveSessions() have been retired.
// Session tracking is now handled exclusively by the JTI-based session registry
// (src/lib/session-registry.ts). parseUserAgent() is kept as it is consumed by
// the registry for display metadata.

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

/**
 * @deprecated Legacy audit-derived session shape. Retained only for existing
 * test compatibility. Use RegisteredSession from session-registry instead.
 */
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
