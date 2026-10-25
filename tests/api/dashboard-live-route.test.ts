import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  actor: vi.fn(),
  generation: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGenerationAtLeast: mocks.generation,
}));
vi.mock('@/lib/dashboard/live-incidents', () => ({ getLiveDashboardSnapshot: mocks.snapshot }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { GET } from '@/app/api/dashboard/live/route';

const url = (query = '') => new Request(`http://localhost/api/dashboard/live${query}`);

describe('GET /api/dashboard/live', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.actor.mockResolvedValue({ id: 'user-1', role: 'USER', teamIds: ['t'] });
    mocks.generation.mockResolvedValue('7');
    mocks.snapshot.mockResolvedValue({ incidents: [], total: 0 });
  });

  it('serves the authorization-scoped snapshot with no-store caching', async () => {
    const response = await GET(
      url(
        '?scope=teams&sort=attention&view=mine&service=svc-1&team=t-1&status=OPEN&urgency=HIGH&assignment=unassigned&q=api&limit=20&after=6&ids=inc-2,inc-1'
      )
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.generation).toHaveBeenCalledWith('6');
    expect(mocks.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      {
        scope: 'teams',
        sort: 'attention',
        view: 'mine',
        serviceId: 'svc-1',
        teamId: 't-1',
        status: 'OPEN',
        urgency: 'HIGH',
        assignment: 'unassigned',
        search: 'api',
      },
      { limit: 20, generation: '7', pinIds: ['inc-2', 'inc-1'] }
    );
  });

  it('defaults to the all-active view', async () => {
    await GET(url());
    expect(mocks.generation).toHaveBeenCalledWith(null);
    expect(mocks.snapshot.mock.calls[0][1]).toMatchObject({
      scope: 'all',
      sort: 'newest',
      view: 'active',
      status: 'all',
    });
    expect(mocks.snapshot.mock.calls[0][2]).toMatchObject({ pinIds: undefined });
  });

  it('rejects unauthenticated, unknown, duplicate and malformed parameters', async () => {
    mocks.session.mockResolvedValueOnce(null);
    await expect(GET(url())).resolves.toMatchObject({ status: 401 });
    for (const query of [
      '?view=ACTIVE',
      '?status=RESOLVED',
      '?view=mine&view=active',
      '?limit=1000',
      '?userId=admin',
      '?service=a%3Bb',
      '?after=abc',
      '?scope=everyone',
      '?sort=random',
      '?ids=a,b,c,d,e,f',
      '?ids=a;b',
      '?ids=',
      `?q=${'x'.repeat(200)}`,
    ]) {
      await expect(GET(url(query))).resolves.toMatchObject({ status: 400 });
    }
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('fails closed without leaking internals', async () => {
    mocks.snapshot.mockRejectedValueOnce(new Error('db exploded: password=hunter2'));
    const response = await GET(url());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('hunter2');
  });
});
