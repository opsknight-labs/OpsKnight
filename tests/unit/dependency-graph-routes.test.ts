import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, resetAt: Date.now() + 60000, count: 1 }),
}));

const identities: Record<string, { role: string; scopes: string[] }> = {
  'reader-user': { role: 'USER', scopes: ['services:read'] },
  'reader-stakeholder': { role: 'STAKEHOLDER', scopes: ['services:read'] },
  'incidents-only': { role: 'ADMIN', scopes: ['incidents:read'] },
  'writer-user': { role: 'USER', scopes: ['services:read', 'services:write'] },
  'writer-admin': { role: 'ADMIN', scopes: ['services:read', 'services:write', 'admin:manage'] },
};
vi.mock('@/lib/api-v2/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-v2/auth')>();
  return {
    ...actual,
    authenticateV2Request: vi.fn().mockImplementation(async (req: NextRequest) => {
      const who = identities[req.headers.get('authorization')?.replace('Bearer ', '') ?? ''];
      const apiKey = { id: 'key_1', scopes: who.scopes };
      return { apiKey, actor: { id: 'usr_1', role: who.role, status: 'ACTIVE', teamIds: ['team_1'], apiKey } };
    }),
  };
});

const lib = vi.hoisted(() => ({
  getGraphAt: vi.fn(),
  diffGraph: vi.fn(),
  findSinglePointsOfFailure: vi.fn(),
  simulateFailure: vi.fn(),
  ingestEdgeStats: vi.fn(),
}));
vi.mock('@/lib/intelligence/dependencies/insights/service', () => lib);
vi.mock('@/lib/intelligence/dependencies/insights/edge-stats', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/intelligence/dependencies/insights/edge-stats')>()),
  ingestEdgeStats: lib.ingestEdgeStats,
}));

const call = async (
  handler: (req: NextRequest, ctx: { params: Promise<object> }) => Promise<Response>,
  who: string,
  url: string,
  body?: unknown
) =>
  handler(
    new NextRequest(`http://localhost/api/v2/dependency-graph/${url}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${who}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({}) }
  );

beforeEach(() => vi.clearAllMocks());

describe('dependency-graph read routes', () => {
  const at = '2026-11-20T00:00:00Z';
  it('rejects a key without services:read before touching any data', async () => {
    const { GET } = await import('@/app/api/v2/dependency-graph/at/route');
    expect((await call(GET, 'incidents-only', `at?at=${at}`)).status).toBe(403);
    const diff = await import('@/app/api/v2/dependency-graph/diff/route');
    expect((await call(diff.GET, 'incidents-only', `diff?since=${at}`)).status).toBe(403);
    const spof = await import('@/app/api/v2/dependency-graph/spof/route');
    expect((await call(spof.GET, 'incidents-only', 'spof')).status).toBe(403);
    expect(lib.getGraphAt).not.toHaveBeenCalled();
    expect(lib.diffGraph).not.toHaveBeenCalled();
    expect(lib.findSinglePointsOfFailure).not.toHaveBeenCalled();
  });

  it('hands the caller identity to the library, which does the scoping', async () => {
    lib.getGraphAt.mockResolvedValue({ services: [] });
    const { GET } = await import('@/app/api/v2/dependency-graph/at/route');
    expect((await call(GET, 'reader-stakeholder', `at?at=${at}&focus=svc:a`)).status).toBe(200);
    expect(lib.getGraphAt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'usr_1', role: 'STAKEHOLDER' }),
      new Date(at),
      { focus: 'svc:a', hops: 2 }
    );
  });

  it('validates input strictly', async () => {
    const { GET } = await import('@/app/api/v2/dependency-graph/at/route');
    expect((await call(GET, 'reader-user', 'at?at=yesterday')).status).toBe(400);
    expect((await call(GET, 'reader-user', `at?at=${at}&extra=1`)).status).toBe(400);
    const sim = await import('@/app/api/v2/dependency-graph/simulate/route');
    expect((await call(sim.POST, 'reader-user', 'simulate', { serviceIds: [] })).status).toBe(400);
  });
});

describe('dependency-graph edge-stats ingestion', () => {
  const body = {
    source: 'collector',
    stats: [
      {
        upstreamServiceId: 'a',
        downstreamServiceId: 'b',
        windowStart: '2026-11-24T00:00:00Z',
        windowSeconds: 60,
        requestCount: 10,
        errorCount: 1,
      },
    ],
  };
  it('needs services:write and operations access', async () => {
    const { POST } = await import('@/app/api/v2/dependency-graph/edge-stats/route');
    expect((await call(POST, 'reader-user', 'edge-stats', body)).status).toBe(403);
    expect((await call(POST, 'writer-user', 'edge-stats', body)).status).toBe(403);
    expect(lib.ingestEdgeStats).not.toHaveBeenCalled();
    lib.ingestEdgeStats.mockResolvedValue({ accepted: 1, rejected: [] });
    expect((await call(POST, 'writer-admin', 'edge-stats', body)).status).toBe(200);
  });

  it('rejects impossible counts', async () => {
    const { POST } = await import('@/app/api/v2/dependency-graph/edge-stats/route');
    const bad = { ...body, stats: [{ ...body.stats[0], errorCount: 99 }] };
    expect((await call(POST, 'writer-admin', 'edge-stats', bad)).status).toBe(400);
  });
});
