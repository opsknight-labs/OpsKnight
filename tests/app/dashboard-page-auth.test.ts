import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dashboard from '@/app/(app)/page';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { redirect } from 'next/navigation';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT: ${url}`);
    (error as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock('@/lib/request-actor-context', () => ({
  getRequestActorContext: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('@/lib/dashboard/dashboard-operational-snapshot', () => ({
  getDashboardOperationalSnapshot: vi.fn().mockResolvedValue({
    previewIncidents: [],
    recentIncidents: [],
    criticalFocus: [],
    myQueue: [],
    myQueueCount: 0,
    slaBreachAlerts: [],
    serviceLoads: [],
    currentShifts: [],
    totalInRange: 0,
    resolvedInRange: 0,
    effectiveStart: new Date(),
    effectiveEnd: new Date(),
    asOf: new Date().toISOString(),
    activeCount: 0,
    criticalCount: 0,
    metrics: {
      open: 0,
      acknowledged: 0,
      resolved: 0,
      critical: 0,
      mediumUrgency: 0,
      lowUrgency: 0,
      active: 0,
      isClipped: false,
      retentionDays: 30,
      snoozed: 0,
      suppressed: 0,
      unassigned: 0,
    },
  }),
}));

vi.mock('@/lib/access-context', () => ({
  resolveAccessContext: vi.fn().mockResolvedValue({
    canCreateIncidents: true,
  }),
}));

describe('Dashboard Page Auth Boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login?error=SessionExpired when request actor context is null (never throws generic error)', async () => {
    vi.mocked(getRequestActorContext).mockResolvedValue(null);

    await expect(Dashboard({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT: /login?error=SessionExpired'
    );

    expect(redirect).toHaveBeenCalledWith('/login?error=SessionExpired');
  });

  it('renders successfully without throwing when request actor context is active', async () => {
    vi.mocked(getRequestActorContext).mockResolvedValue({
      session: {
        user: { id: 'user-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
        expires: new Date(Date.now() + 3600000).toISOString(),
      },
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        avatarUrl: null,
        gender: null,
        timeZone: 'UTC',
        tokenVersion: 1,
      },
      actor: {
        id: 'user-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamIds: [],
      },
    });

    const jsx = await Dashboard({ searchParams: Promise.resolve({}) });
    expect(jsx).toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
