import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getServerSession } from 'next-auth';
import { clearMetricsCache, GET } from '@/app/api/metrics/route';
import prisma from '@/lib/prisma';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    backgroundJob: {
      groupBy: vi.fn(),
    },
    incident: {
      count: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
  },
}));

describe('API Route - Prometheus Metrics (/api/metrics)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMetricsCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 401 when unauthenticated and no valid Bearer token provided', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const req = new Request('http://localhost:3000/api/metrics');

    const res = await GET(req);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toBe('Unauthorized');
  });

  it('allows access with valid PROMETHEUS_SCRAPE_TOKEN Bearer header', async () => {
    process.env.PROMETHEUS_SCRAPE_TOKEN = 'secret-scrape-token-123';

    vi.mocked(prisma.backgroundJob.groupBy).mockResolvedValue([
      { status: 'PENDING', _count: { id: 5 } },
      { status: 'PROCESSING', _count: { id: 2 } },
    ] as unknown as Awaited<ReturnType<typeof prisma.backgroundJob.groupBy>>);
    vi.mocked(prisma.incident.count).mockResolvedValue(3);
    vi.mocked(prisma.user.count).mockResolvedValue(10);

    const req = new Request('http://localhost:3000/api/metrics', {
      headers: {
        authorization: 'Bearer secret-scrape-token-123',
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; version=0.0.4; charset=utf-8');

    const text = await res.text();
    expect(text).toContain('opsknight_build_info');
    expect(text).toContain('opsknight_active_incidents 3');
    expect(text).toContain('opsknight_active_users 10');
    expect(text).toContain('opsknight_job_queue{status="pending"} 5');
    expect(text).toContain('opsknight_job_queue{status="processing"} 2');
  });

  it('allows access with authenticated user session', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'admin@example.com', role: 'ADMIN' },
    });

    vi.mocked(prisma.backgroundJob.groupBy).mockResolvedValue([]);
    vi.mocked(prisma.incident.count).mockResolvedValue(0);
    vi.mocked(prisma.user.count).mockResolvedValue(1);

    const req = new Request('http://localhost:3000/api/metrics');

    const res = await GET(req);
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toContain('opsknight_active_incidents 0');
    expect(text).toContain('opsknight_active_users 1');
  });
});
