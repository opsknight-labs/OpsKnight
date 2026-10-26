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
    service: { findMany: vi.fn().mockResolvedValue([]) },
    team: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@/lib/dashboard/live-incidents', () => ({
  getLiveDashboardSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: vi.fn().mockResolvedValue('1'),
}));

vi.mock('@/lib/realtime-cache', () => ({
  getCachedDashboardMetrics: vi.fn().mockResolvedValue(null),
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
