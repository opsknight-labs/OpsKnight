import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/reports/metrics/route';

const mocks = vi.hoisted(() => ({
  calculateActorSLAMetrics: vi.fn(),
  serializeSlaMetrics: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { email: 'admin@example.com' } }),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/rbac', () => ({
  assertCanReadServiceMetrics: vi.fn().mockResolvedValue({ role: 'ADMIN' }),
  getCurrentAuthorizationActor: vi.fn().mockResolvedValue({
    id: 'admin-1',
    role: 'ADMIN',
    status: 'ACTIVE',
    teamIds: [],
  }),
}));
vi.mock('@/lib/authorization', () => ({
  CAPABILITIES: { INCIDENT_SENSITIVE_READ: 'incident.sensitive.read' },
  hasCapability: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/actor-metrics', () => ({
  calculateActorSLAMetrics: mocks.calculateActorSLAMetrics,
}));
vi.mock('@/lib/sla', () => ({ serializeSlaMetrics: mocks.serializeSlaMetrics }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('GET /api/reports/metrics response contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculateActorSLAMetrics.mockResolvedValue({ dataSource: 'live' });
    mocks.serializeSlaMetrics.mockReturnValue({ mtta: 12, mttr: 34 });
  });

  it('keeps metrics directly under data while adding canonical response metadata', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/reports/metrics?window=7&serviceId=svc-1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ mtta: 12, mttr: 34 });
    expect(body.data.data).toBeUndefined();
    expect(body.meta).toMatchObject({ dataState: 'available', source: 'live' });
    expect(body.filters).toMatchObject({ windowDays: 7, serviceId: 'svc-1' });
    expect(body).toMatchObject({ success: true, dataState: 'available' });
    expect(body.requestId).toBeTypeOf('string');
    expect(body.timestamp).toBeTypeOf('string');
    expect(mocks.calculateActorSLAMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1' }),
      expect.objectContaining({ serviceId: 'svc-1', windowDays: 7 })
    );
  });
});
