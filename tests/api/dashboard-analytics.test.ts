import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAnalytics: vi.fn(), getActor: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { email: 'user@example.com' } }) }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.getActor }));
vi.mock('@/lib/dashboard/dashboard-analytics-cache', () => ({
  DashboardAnalyticsUnavailableError: class DashboardAnalyticsUnavailableError extends Error {},
  getDashboardAnalytics: mocks.getAnalytics,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { GET } from '@/app/api/dashboard/analytics/route';

describe('GET /api/dashboard/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActor.mockResolvedValue({ id: 'user-1', role: 'USER', status: 'ACTIVE', teamIds: ['team-1'] });
    mocks.getAnalytics.mockResolvedValue({ mtta: 5, freshness: 'fresh' });
  });

  it('derives authorization server-side and accepts only dashboard filters', async () => {
    const response = await GET(new Request('http://localhost/api/dashboard/analytics?range=30&service=svc-1'));
    expect(response.status).toBe(200);
    expect(mocks.getAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', teamIds: ['team-1'] }),
      expect.objectContaining({ rangeDays: 30, serviceId: 'svc-1' })
    );
  });

  it('rejects client-supplied authorization scope', async () => {
    const response = await GET(new Request('http://localhost/api/dashboard/analytics?range=30&userId=admin'));
    expect(response.status).toBe(400);
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.getAnalytics).not.toHaveBeenCalled();
  });

  it('rejects invalid and duplicate filters', async () => {
    await expect(GET(new Request('http://localhost/api/dashboard/analytics?range=0'))).resolves.toMatchObject({ status: 400 });
    await expect(GET(new Request('http://localhost/api/dashboard/analytics?range=7&range=30'))).resolves.toMatchObject({ status: 400 });
  });
});
