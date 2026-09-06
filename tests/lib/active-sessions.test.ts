import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseUserAgent, getUserActiveSessions } from '@/lib/active-sessions';

describe('active-sessions: parseUserAgent', () => {
  it('correctly detects Microsoft Edge on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Microsoft Edge');
    expect(result.os).toBe('Windows');
    expect(result.deviceType).toBe('desktop');
    expect(result.isMobile).toBe(false);
  });

  it('correctly detects Google Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Google Chrome');
    expect(result.os).toBe('macOS');
    expect(result.deviceType).toBe('desktop');
    expect(result.isMobile).toBe(false);
  });

  it('correctly detects Apple Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Apple Safari');
    expect(result.os).toBe('iOS');
    expect(result.deviceType).toBe('mobile');
    expect(result.isMobile).toBe(true);
  });

  it('correctly detects Mozilla Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
    const result = parseUserAgent(ua);
    expect(result.browser).toBe('Mozilla Firefox');
    expect(result.os).toBe('Linux');
    expect(result.deviceType).toBe('desktop');
    expect(result.isMobile).toBe(false);
  });

  it('gracefully handles missing or empty userAgent', () => {
    const result = parseUserAgent(null);
    expect(result.browser).toBe('Web Browser');
    expect(result.deviceType).toBe('desktop');
  });
});

const mocks = vi.hoisted(() => ({
  auditLogFindFirst: vi.fn(),
  auditLogFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    auditLog: {
      findFirst: mocks.auditLogFindFirst,
      findMany: mocks.auditLogFindMany,
    },
  },
}));

describe('active-sessions: getUserActiveSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditLogFindFirst.mockResolvedValue(null);
  });

  it('collapses multiple IP logs from the same browser/OS into exactly ONE session and marks only one current device', async () => {
    const chromeMacUA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
    const edgeWinUA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0';

    // Simulated logs: 4 distinct IPs from Chrome on Mac over time, and 3 distinct IPs from Edge on Windows
    mocks.auditLogFindMany.mockResolvedValue([
      {
        id: 'log-1',
        action: 'SESSION_HEARTBEAT',
        ip: '106.51.250.126',
        details: { metadata: { userAgent: chromeMacUA } },
        createdAt: new Date('2026-09-03T00:00:00Z'),
      },
      {
        id: 'log-2',
        action: 'SESSION_HEARTBEAT',
        ip: '2401:4900:883a:a614::1',
        details: { metadata: { userAgent: chromeMacUA } },
        createdAt: new Date('2026-09-02T23:00:00Z'),
      },
      {
        id: 'log-3',
        action: 'LOGIN_SUCCESS',
        ip: '127.0.0.1',
        details: { metadata: { userAgent: chromeMacUA } },
        createdAt: new Date('2026-09-02T22:00:00Z'),
      },
      {
        id: 'log-4',
        action: 'SESSION_HEARTBEAT',
        ip: '106.51.250.126',
        details: { metadata: { userAgent: edgeWinUA } },
        createdAt: new Date('2026-09-02T20:00:00Z'),
      },
      {
        id: 'log-5',
        action: 'SESSION_HEARTBEAT',
        ip: '223.185.135.171',
        details: { metadata: { userAgent: edgeWinUA } },
        createdAt: new Date('2026-09-01T15:00:00Z'),
      },
    ]);

    const sessions = await getUserActiveSessions({
      userId: 'user-1',
      currentIp: '106.51.250.126',
      currentUserAgent: chromeMacUA,
      tokenVersion: 0,
    });

    // Despite 5 audit logs with multiple IPs, there should be exactly 2 distinct device sessions
    expect(sessions).toHaveLength(2);

    // Chrome on Mac should be the first session and the ONLY one with isCurrent = true
    const chromeSession = sessions.find(s => s.browser === 'Google Chrome');
    expect(chromeSession).toBeDefined();
    expect(chromeSession?.os).toBe('macOS');
    expect(chromeSession?.isCurrent).toBe(true);

    // Edge on Windows should be the second session and have isCurrent = false
    const edgeSession = sessions.find(s => s.browser === 'Microsoft Edge');
    expect(edgeSession).toBeDefined();
    expect(edgeSession?.os).toBe('Windows');
    expect(edgeSession?.isCurrent).toBe(false);
    expect(edgeSession?.ip).toBe('106.51.250.126'); // Latest IP from log-4

    // Exactly one session in the list has isCurrent === true
    const currentSessions = sessions.filter(s => s.isCurrent);
    expect(currentSessions).toHaveLength(1);
  });
});
