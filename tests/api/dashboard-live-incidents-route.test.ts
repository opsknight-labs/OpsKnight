import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  actor: vi.fn(),
  generation: vi.fn(),
  feed: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: mocks.generation,
}));
vi.mock('@/lib/dashboard/live-incidents', () => ({ getLiveIncidentFeed: mocks.feed }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { GET } from '@/app/api/dashboard/live-incidents/route';

const url = (query = '') => new Request(`http://localhost/api/dashboard/live-incidents${query}`);

describe('GET /api/dashboard/live-incidents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.actor.mockResolvedValue({ id: 'user-1', role: 'USER', teamIds: ['t'] });
    mocks.generation.mockResolvedValue('7');
    mocks.feed.mockResolvedValue({ filter: 'active', incidents: [], total: 0 });
  });

  it('serves the authorization-scoped feed with no-store caching', async () => {
    const response = await GET(url('?filter=mine&limit=20'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.feed).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'mine', {
      limit: 20,
      generation: '7',
    });
  });

  it('defaults to the active filter', async () => {
    await GET(url());
    expect(mocks.feed).toHaveBeenCalledWith(expect.anything(), 'active', expect.anything());
  });

  it('rejects unauthenticated, unknown, duplicate and out-of-range parameters', async () => {
    mocks.session.mockResolvedValueOnce(null);
    await expect(GET(url())).resolves.toMatchObject({ status: 401 });
    await expect(GET(url('?filter=ACTIVE'))).resolves.toMatchObject({ status: 400 });
    await expect(GET(url('?filter=mine&filter=active'))).resolves.toMatchObject({ status: 400 });
    await expect(GET(url('?limit=1000'))).resolves.toMatchObject({ status: 400 });
    await expect(GET(url('?userId=admin'))).resolves.toMatchObject({ status: 400 });
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it('fails closed without leaking internals', async () => {
    mocks.feed.mockRejectedValueOnce(new Error('db exploded: password=hunter2'));
    const response = await GET(url());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('hunter2');
  });
});
