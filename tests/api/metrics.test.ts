import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getServerSession } from 'next-auth';
import { clearMetricsCache, collectWithTimeout, GET } from '@/app/api/metrics/route';
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
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
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
    vi.mocked(prisma.$transaction).mockImplementation(
      async operation => (operation as (tx: typeof prisma) => Promise<unknown>)(prisma) as never
    );
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('bounds a hung collector without waiting for its database promise', async () => {
    const hung = new Promise<never>(() => {});
    await expect(collectWithTimeout('hung', 5, () => hung)).rejects.toThrow(
      'Metrics collector timed out: hung'
    );
    await expect(collectWithTimeout('hung', 5, () => hung)).rejects.toThrow(
      'Metrics collector still running: hung'
    );
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

  it('exports receipt lifecycle counts without recipient or provider-event labels', async () => {
    process.env.PROMETHEUS_SCRAPE_TOKEN = 'receipt-metric-test';
    vi.mocked(prisma.$queryRaw).mockImplementation((async (query: unknown) => {
      if (JSON.stringify(query).includes('NotificationProviderFeedback'))
        return [{ pending: BigInt(7), retried: BigInt(3), quarantined: BigInt(2) }];
      return [];
    }) as never);
    const response = await GET(
      new Request('http://localhost/api/metrics', {
        headers: { authorization: 'Bearer receipt-metric-test' },
      })
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('opsknight_provider_feedback_pending 7');
    expect(body).toContain('opsknight_provider_feedback_retried 3');
    expect(body).toContain('opsknight_provider_feedback_quarantined 2');
    expect(body).not.toMatch(/opsknight_provider_feedback_\w+\{/);
  });
  it('omits receipt gauges when their collector fails instead of reporting a false zero', async () => {
    process.env.PROMETHEUS_SCRAPE_TOKEN = 'receipt-metric-test';
    vi.mocked(prisma.$queryRaw).mockImplementation((async (query: unknown) => {
      if (JSON.stringify(query).includes('NotificationProviderFeedback'))
        throw new Error('receipt collector unavailable');
      return [];
    }) as never);
    const response = await GET(
      new Request('http://localhost/api/metrics', {
        headers: { authorization: 'Bearer receipt-metric-test' },
      })
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toMatch(/opsknight_provider_feedback_pending \d/);
    expect(Number(body.match(/opsknight_metrics_collection_errors (\d+)/)?.[1])).toBeGreaterThan(0);
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

  it('exports durable legacy SLA fallback usage without high-cardinality labels', async () => {
    process.env.PROMETHEUS_SCRAPE_TOKEN = 'secret-scrape-token-123';
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: BigInt(7), lastSeenAt: new Date(Date.now() - 5_000) }])
      .mockResolvedValueOnce([{ count: BigInt(2), lastSeenAt: new Date(Date.now() - 3_000) }]);
    vi.mocked(prisma.backgroundJob.groupBy).mockResolvedValue([]);
    vi.mocked(prisma.incident.count).mockResolvedValue(0);
    vi.mocked(prisma.user.count).mockResolvedValue(1);

    const response = await GET(
      new Request('http://localhost:3000/api/metrics', {
        headers: { authorization: 'Bearer secret-scrape-token-123' },
      })
    );
    const text = await response.text();

    expect(text).toContain('opsknight_incident_sla_legacy_captures 7');
    const lastSeenLine = text
      .split('\n')
      .find(line =>
        line.startsWith('opsknight_incident_sla_legacy_capture_last_seen_age_seconds ')
      );
    expect(Number(lastSeenLine?.split(' ').at(1))).toBeGreaterThanOrEqual(5);
    expect(Number(lastSeenLine?.split(' ').at(1))).toBeLessThan(10);
    expect(text).toContain('opsknight_incident_sla_legacy_ack_mutations_total 2');
    const mutationLastSeenLine = text
      .split('\n')
      .find(line =>
        line.startsWith('opsknight_incident_sla_legacy_ack_mutation_last_seen_age_seconds ')
      );
    expect(Number(mutationLastSeenLine?.split(' ').at(1))).toBeGreaterThanOrEqual(3);
    expect(Number(mutationLastSeenLine?.split(' ').at(1))).toBeLessThan(10);
  });
});
