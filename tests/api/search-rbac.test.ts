import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/search/route';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([]),
  userFindMany: vi.fn().mockResolvedValue([]),
  policyFindMany: vi.fn().mockResolvedValue([]),
  userFindUnique: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { email: 'user@example.com' } }),
}));

vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 }),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findMany: mocks.findMany },
    service: { findMany: mocks.findMany },
    team: { findMany: mocks.findMany },
    user: { findUnique: mocks.userFindUnique, findMany: mocks.userFindMany },
    escalationPolicy: { findMany: mocks.policyFindMany },
    postmortem: { findMany: mocks.findMany },
    onCallSchedule: { findMany: mocks.findMany },
    runbook: { findMany: mocks.findMany },
    businessService: { findMany: mocks.findMany },
  },
}));
vi.mock('@/lib/business-services/health', () => ({
  getHealthSnapshot: vi.fn().mockResolvedValue({
    health: new Map([['bs-1', { status: 'DEGRADED' }]]),
  }),
}));

describe('global search RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.userFindMany.mockResolvedValue([]);
    mocks.policyFindMany.mockResolvedValue([]);
  });

  it('adds team and assignee scope for regular users', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [{ teamId: 'team-1' }],
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=database'));

    expect(response.status).toBe(200);
    const incidentQuery = mocks.findMany.mock.calls[0][0];
    expect(incidentQuery.where.AND[0]).toEqual({
      OR: [
        { assigneeId: 'user-1' },
        { watchers: { some: { userId: 'user-1' } } },
        {
          AND: [
            { visibility: 'PUBLIC' },
            {
              OR: [{ teamId: { in: ['team-1'] } }, { service: { teamId: { in: ['team-1'] } } }],
            },
          ],
        },
      ],
    });
    const serviceQuery = mocks.findMany.mock.calls[1][0];
    expect(serviceQuery.where.AND[0]).toEqual({ teamId: { in: ['team-1'] } });
  });

  it('rejects invited actors before any resource search executes', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'invited-1',
      role: 'USER',
      status: 'INVITED',
      teamMemberships: [{ teamId: 'team-1' }],
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=database'));

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('preserves global search for responders', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'responder-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamMemberships: [],
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=database'));

    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where.AND[0]).toEqual({});
  });

  it('redacts restricted automation-source incidents for actors without sensitive read', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'auditor-1',
      role: 'AUDITOR',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    mocks.findMany.mockImplementation(async (args?: { select?: { urgency?: unknown } }) =>
      args?.select?.urgency
        ? [
            {
              id: 'inc-1',
              title: 'secret payload',
              status: 'OPEN',
              urgency: 'HIGH',
              automationSourceRestricted: true,
              automationTraces: [],
              automationDecision: null,
              service: { id: 's1', name: 'API' },
            },
          ]
        : []
    );

    const response = await GET(new NextRequest('http://localhost/api/search?q=secret'));
    const body = await response.json();
    const results = body.data?.results ?? body.results;

    expect(results[0].title).toBe('Restricted alert content');
    expect(results[0]).not.toHaveProperty('priority');
    expect(JSON.stringify(results)).not.toContain('secret payload');
    const textMatch = mocks.findMany.mock.calls[0][0].where.AND[1].OR[0].AND[0];
    expect(textMatch).toEqual({
      automationSourceRestricted: false,
      automationDecision: { is: null },
      automationTraces: { none: {} },
    });
  });

  it('keeps an older incident whose title is exactly the query when newer ones fill the limit', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'responder-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    const incident = (id: string, title: string) => ({
      id,
      title,
      status: 'OPEN',
      urgency: 'LOW',
      automationSourceRestricted: false,
      automationTraces: [],
      automationDecision: null,
      service: null,
    });
    const newer = Array.from({ length: 8 }, (_, n) => incident(`new-${n}`, `failover note ${n}`));
    mocks.findMany.mockImplementation(
      async (args?: { where?: unknown; select?: { urgency?: unknown } }) => {
        if (!args?.select?.urgency) return [];
        // The exact-title query adds a third AND clause to the access scope and restricted-source filter.
        const exactQuery = (args.where as { AND: unknown[] }).AND.length === 3;
        return exactQuery ? [incident('old-exact', 'failover')] : newer;
      }
    );

    const response = await GET(new NextRequest('http://localhost/api/search?q=failover'));
    const body = await response.json();
    const results: Array<{ id: string; type: string }> = (
      body.data?.results ?? body.results
    ).filter((result: { type: string }) => result.type === 'incident');

    expect(results).toHaveLength(8);
    expect(results[0].id).toBe('old-exact');
  });

  it('requires every word of a multi-word query instead of any of them', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'responder-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamMemberships: [],
    });

    await GET(new NextRequest('http://localhost/api/search?q=payment%20timeout'));

    const contains = (word: string) => ({ contains: word, mode: 'insensitive' });
    const incidentWhere = mocks.findMany.mock.calls[0][0].where;
    expect(incidentWhere.AND[1].OR[0].AND[1]).toEqual({
      AND: [
        { OR: [{ title: contains('payment') }, { description: contains('payment') }] },
        { OR: [{ title: contains('timeout') }, { description: contains('timeout') }] },
      ],
    });
    const serviceWhere = mocks.findMany.mock.calls[1][0].where;
    expect(serviceWhere.AND[1]).toEqual({
      AND: [
        { OR: [{ name: contains('payment') }, { description: contains('payment') }] },
        { OR: [{ name: contains('timeout') }, { description: contains('timeout') }] },
      ],
    });
  });

  it('answers 503 with Retry-After when the rate-limit store is down, and 429 only when limited', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'responder-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    const { checkRateLimit } = await import('@/lib/rate-limit');

    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      count: 31,
      unavailable: true,
    });
    const down = await GET(new NextRequest('http://localhost/api/search?q=database'));
    expect(down.status).toBe(503);
    expect(down.headers.get('Retry-After')).toBe('5');

    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 20_000,
      count: 31,
    });
    const limited = await GET(new NextRequest('http://localhost/api/search?q=database'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['AUDITOR', true],
    ['USER', true],
    ['RESPONDER', false],
    ['ADMIN', false],
  ])('%s postmortem search is restricted to published rows: %s', async (role, publishedOnly) => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'u-1',
      role,
      status: 'ACTIVE',
      teamMemberships: [],
    });

    await GET(new NextRequest('http://localhost/api/search?q=database'));

    const query = mocks.findMany.mock.calls
      .map(([args]) => args)
      .find(args => JSON.stringify(args?.where).includes('rootCause'));
    expect(query).toBeDefined();
    expect(JSON.stringify(query.where.AND)).toEqual(
      publishedOnly
        ? expect.stringContaining('"status":"PUBLISHED"')
        : expect.not.stringContaining('"status":"PUBLISHED"')
    );
  });

  it.each([
    ['USER', false],
    ['RESPONDER', true],
    ['AUDITOR', true],
    ['ADMIN', true],
  ])('%s user and policy search matches the pages it can open: %s', async (role, canOpen) => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'u-1',
      role,
      status: 'ACTIVE',
      teamMemberships: [{ teamId: 'team-1' }],
    });

    await GET(new NextRequest('http://localhost/api/search?q=alice'));

    expect(mocks.userFindMany).toHaveBeenCalledTimes(canOpen ? 1 : 0);
    expect(mocks.policyFindMany).toHaveBeenCalledTimes(canOpen ? 1 : 0);
  });

  it('returns limited, scoped schedule and runbook matches', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamMemberships: [],
    });
    mocks.findMany.mockImplementation(async (args?: { select?: Record<string, unknown> }) => {
      if (args?.select?.timeZone) return [{ id: 'sch-1', name: 'Primary', timeZone: 'UTC' }];
      if (JSON.stringify(args).includes('archivedAt'))
        return [{ id: 'rb-1', name: 'Restart DB', description: '' }];
      return [];
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=primary'));
    const body = await response.json();
    const results = body.data?.results ?? body.results;

    expect(results).toEqual([
      expect.objectContaining({ type: 'schedule', id: 'sch-1', href: '/schedules/sch-1' }),
      expect.objectContaining({ type: 'runbook', id: 'rb-1', href: '/runbooks/rb-1' }),
    ]);
    for (const [args] of mocks.findMany.mock.calls) {
      expect(args.take).toBeLessThanOrEqual(8);
      expect(args.select).toBeDefined();
    }
  });

  it("finds business services in the actor's read scope, with their health", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [{ teamId: 'team-1' }],
    });
    mocks.findMany.mockImplementation(async (args?: { select?: Record<string, unknown> }) =>
      args?.select?.criticality ? [{ id: 'bs-1', name: 'Checkout', criticality: 'TIER_0' }] : []
    );
    const response = await GET(new NextRequest('http://localhost/api/search?q=checkout'));
    const body = await response.json();
    const results = body.data?.results ?? body.results;
    expect(results).toEqual([
      expect.objectContaining({
        type: 'businessService',
        id: 'bs-1',
        href: '/services/business/bs-1',
        status: 'DEGRADED',
        subtitle: 'Business service - Tier 0 - Degraded',
      }),
    ]);
    const query = mocks.findMany.mock.calls.find(([args]) => args?.select?.criticality)![0];
    // The business-service read rule, not an unscoped query.
    expect(JSON.stringify(query.where.AND[0])).toContain('team-1');
  });
});
