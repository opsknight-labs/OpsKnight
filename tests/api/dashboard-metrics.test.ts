import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ actor: vi.fn(), generation: vi.fn(), metrics: vi.fn() }));
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: mocks.generation,
}));
vi.mock('@/lib/dashboard/dashboard-realtime-metrics', () => ({
  getDashboardRealtimeMetrics: mocks.metrics,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { GET } from '@/app/api/dashboard/metrics/route';

describe('GET /api/dashboard/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamIds: ['team-1'],
    });
    mocks.generation.mockResolvedValue('42');
    mocks.metrics.mockResolvedValue({ open: 2, acknowledged: 1, active: 3 });
  });

  it('derives authorization and generation server-side for allowed filters', async () => {
    const response = await GET(
      new Request('http://localhost/api/dashboard/metrics?service=service-a&assignee=unassigned')
    );
    expect(response.status).toBe(200);
    expect(mocks.metrics).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ service: 'service-a', assignee: '' }),
      '42'
    );
  });

  it('rejects unknown, duplicate, and malformed filters before querying', async () => {
    await expect(
      GET(new Request('http://localhost/api/dashboard/metrics?userId=admin'))
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      GET(new Request('http://localhost/api/dashboard/metrics?service=a&service=b'))
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      GET(new Request('http://localhost/api/dashboard/metrics?urgency=CRITICAL'))
    ).resolves.toMatchObject({ status: 400 });
    expect(mocks.metrics).not.toHaveBeenCalled();
  });
});
