import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resolveEffectiveAgentStatus,
  getExecutionProgress,
  getExecutionDateRange,
  getUnknownOutcomeWhere,
  getSuccessRate,
  HEARTBEAT_FRESHNESS_MS,
  ACTIVE_EXECUTION_STATUSES,
} from '@/lib/runbooks/presentation/contracts';
import {
  getRunbookDatabaseNow,
  getRunbookFleetSummary,
  getRunbookExecutionSummary,
  getRunbookHealthSummary,
  getRunbookNavigationSummary,
} from '@/lib/runbooks/presentation/summaries';
import { GET as optionsRouteHandler } from '@/app/api/runbooks/options/route';
import { CAPABILITIES } from '@/lib/authorization';

const { mockPrisma, mockAssertCapability } = vi.hoisted(() => {
  const mockPrisma = {
    $queryRaw: vi.fn(),
    service: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    runbook: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    runbookAgent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    runbookAgentPool: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    runbookExecution: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    runbookStepAttempt: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    runbookSecret: {
      count: vi.fn(),
    },
  };
  return {
    mockPrisma,
    mockAssertCapability: vi.fn().mockResolvedValue({ id: 'usr-1', role: 'ADMIN' }),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
}));

describe('Runbook Presentation Contracts & Helpers', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  describe('resolveEffectiveAgentStatus', () => {
    it('returns ONLINE when heartbeat is fresh', () => {
      const recent = new Date(now.getTime() - (HEARTBEAT_FRESHNESS_MS - 5000));
      expect(resolveEffectiveAgentStatus({ status: 'ONLINE', lastHeartbeatAt: recent }, now)).toBe('ONLINE');
    });

    it('returns OFFLINE when ONLINE heartbeat has lapsed', () => {
      const stale = new Date(now.getTime() - (HEARTBEAT_FRESHNESS_MS + 5000));
      expect(resolveEffectiveAgentStatus({ status: 'ONLINE', lastHeartbeatAt: stale }, now)).toBe('OFFLINE');
    });

    it('returns OFFLINE when ONLINE heartbeat is null', () => {
      expect(resolveEffectiveAgentStatus({ status: 'ONLINE', lastHeartbeatAt: null }, now)).toBe('OFFLINE');
    });

    it('returns DEGRADED when DEGRADED heartbeat is fresh', () => {
      const recent = new Date(now.getTime() - 10000);
      expect(resolveEffectiveAgentStatus({ status: 'DEGRADED', lastHeartbeatAt: recent }, now)).toBe('DEGRADED');
    });

    it('returns OFFLINE when DEGRADED heartbeat has lapsed', () => {
      const stale = new Date(now.getTime() - (HEARTBEAT_FRESHNESS_MS + 10000));
      expect(resolveEffectiveAgentStatus({ status: 'DEGRADED', lastHeartbeatAt: stale }, now)).toBe('OFFLINE');
    });

    it('preserves OFFLINE status regardless of heartbeat', () => {
      expect(resolveEffectiveAgentStatus({ status: 'OFFLINE', lastHeartbeatAt: now }, now)).toBe('OFFLINE');
    });

    it('preserves ENROLLING and REVOKED statuses regardless of heartbeat', () => {
      expect(resolveEffectiveAgentStatus({ status: 'ENROLLING', lastHeartbeatAt: null }, now)).toBe('ENROLLING');
      expect(resolveEffectiveAgentStatus({ status: 'REVOKED', lastHeartbeatAt: null }, now)).toBe('REVOKED');
    });
  });

  describe('getExecutionProgress', () => {
    it('calculates total, completed steps and identifies failure step', () => {
      const steps = [
        { status: 'SUCCEEDED', stepKey: 'step-1' },
        { status: 'SKIPPED', stepKey: 'step-2' },
        { status: 'FAILED', stepKey: 'step-3' },
        { status: 'PENDING', stepKey: 'step-4' },
      ];
      const progress = getExecutionProgress(steps);
      expect(progress.totalSteps).toBe(4);
      expect(progress.completedSteps).toBe(2);
      expect(progress.failedStepName).toBe('step-3');
    });

    it('identifies UNKNOWN step status as a failure', () => {
      const steps = [
        { status: 'SUCCEEDED', stepKey: 'step-1' },
        { status: 'UNKNOWN', stepKey: 'step-unresolved' },
      ];
      const progress = getExecutionProgress(steps);
      expect(progress.totalSteps).toBe(2);
      expect(progress.completedSteps).toBe(1);
      expect(progress.failedStepName).toBe('step-unresolved');
    });

    it('returns null failedStepName when all succeed or are pending', () => {
      const steps = [
        { status: 'SUCCEEDED', stepKey: 'step-1' },
        { status: 'RUNNING', stepKey: 'step-2' },
      ];
      const progress = getExecutionProgress(steps);
      expect(progress.failedStepName).toBeNull();
    });
  });

  describe('getExecutionDateRange', () => {
    it('resolves relative timeRange presets', () => {
      const range1h = getExecutionDateRange({ timeRange: '1h' }, 'UTC', now);
      expect(range1h.gte?.getTime()).toBe(now.getTime() - 3600000);
      expect(range1h.lt).toBeUndefined();

      const range24h = getExecutionDateRange({ timeRange: '24h' }, 'UTC', now);
      expect(range24h.gte?.getTime()).toBe(now.getTime() - 86400000);

      const range7d = getExecutionDateRange({ timeRange: '7d' }, 'UTC', now);
      expect(range7d.gte?.getTime()).toBe(now.getTime() - 7 * 86400000);
    });

    it('resolves valid date keys with time zone', () => {
      const range = getExecutionDateRange({ from: '2026-10-01', to: '2026-10-05' }, 'UTC', now);
      expect(range.gte).toBeInstanceOf(Date);
      expect(range.lt).toBeInstanceOf(Date);
      expect(range.gte!.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(range.lt!.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    });

    it('ignores invalid date keys safely', () => {
      const range = getExecutionDateRange({ from: 'invalid-date', to: '2026-13-45' }, 'UTC', now);
      expect(range.gte).toBeUndefined();
      expect(range.lt).toBeUndefined();
    });
  });

  describe('getUnknownOutcomeWhere', () => {
    it('targets both step UNKNOWN and step attempt UNKNOWN', () => {
      const where = getUnknownOutcomeWhere();
      expect(where).toEqual({
        steps: {
          some: {
            OR: [
              { status: 'UNKNOWN' },
              { attempts: { some: { status: 'UNKNOWN' } } },
            ],
          },
        },
      });
    });
  });

  describe('getSuccessRate', () => {
    it('calculates correct success percentage across eligible states', () => {
      const states = [
        { status: 'SUCCEEDED', _count: { id: 8 } },
        { status: 'FAILED', _count: { id: 1 } },
        { status: 'TIMED_OUT', _count: { id: 1 } },
        { status: 'RUNNING', _count: { id: 5 } }, // Non-eligible terminal state
      ];
      const result = getSuccessRate(states);
      expect(result.total).toBe(10);
      expect(result.percent).toBe(80);
    });

    it('returns null percent when total eligible executions is 0', () => {
      const result = getSuccessRate([]);
      expect(result.total).toBe(0);
      expect(result.percent).toBeNull();
    });
  });

  describe('ACTIVE_EXECUTION_STATUSES', () => {
    it('includes active execution states and excludes completed ones', () => {
      expect(ACTIVE_EXECUTION_STATUSES).toContain('RUNNING');
      expect(ACTIVE_EXECUTION_STATUSES).toContain('WAITING_APPROVAL');
      expect(ACTIVE_EXECUTION_STATUSES).not.toContain('SUCCEEDED');
      expect(ACTIVE_EXECUTION_STATUSES).not.toContain('FAILED');
      expect(ACTIVE_EXECUTION_STATUSES).not.toContain('TIMED_OUT');
      expect(ACTIVE_EXECUTION_STATUSES).not.toContain('CANCELED');
    });
  });
});

describe('Runbook Presentation Summaries', () => {
  const dbNow = new Date('2026-10-07T12:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ now: dbNow }]);
  });

  it('getRunbookDatabaseNow returns clock from db query', async () => {
    const now = await getRunbookDatabaseNow();
    expect(now).toEqual(dbNow);
  });

  it('getRunbookFleetSummary returns aggregated whole-fleet stats', async () => {
    const mockFleet = {
      enrolled: 10,
      online: 8,
      degraded: 1,
      offline: 1,
      enrolling: 0,
      unhealthy: 2,
      spoolDepth: 0,
      deadLetterDepth: 0,
      activeJobs: 3,
    };
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ now: dbNow }])
      .mockResolvedValueOnce([mockFleet]);

    const summary = await getRunbookFleetSummary();
    expect(summary).toEqual(mockFleet);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('getRunbookExecutionSummary aggregates counts and success rate', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ now: dbNow }]);
    mockPrisma.runbookExecution.count
      .mockResolvedValueOnce(3) // active (RUNNING + WAITING_APPROVAL)
      .mockResolvedValueOnce(2) // running
      .mockResolvedValueOnce(1) // waiting approval
      .mockResolvedValueOnce(15); // last24h
    mockPrisma.runbookExecution.groupBy.mockResolvedValueOnce([
      { status: 'SUCCEEDED', _count: { id: 18 } },
      { status: 'FAILED', _count: { id: 2 } },
    ]);

    const summary = await getRunbookExecutionSummary();
    expect(summary.active).toBe(3);
    expect(summary.running).toBe(2);
    expect(summary.waitingApproval).toBe(1);
    expect(summary.last24h).toBe(15);
    expect(summary.successRate).toEqual({ total: 20, percent: 90 });
  });

  it('getRunbookHealthSummary evaluates DEGRADED when unhealthy agents exist', async () => {
    const mockFleet = {
      enrolled: 5,
      online: 3,
      degraded: 1,
      offline: 1,
      enrolling: 0,
      unhealthy: 2,
      spoolDepth: 0,
      deadLetterDepth: 0,
      activeJobs: 1,
    };
    mockPrisma.$queryRaw.mockImplementation(async (strings: unknown) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (sql.includes('SELECT NOW()')) return [{ now: dbNow }];
      if (sql.includes('RunbookAgent')) return [mockFleet];
      return [{ count: 0 }];
    });
    mockPrisma.runbookStepAttempt.count
      .mockResolvedValueOnce(0) // unknown
      .mockResolvedValueOnce(0); // expiredLeases
    mockPrisma.runbookStepAttempt.findFirst.mockResolvedValueOnce(null); // oldestPending

    const health = await getRunbookHealthSummary();
    expect(health.health).toBe('DEGRADED');
    expect(health.fleet.unhealthy).toBe(2);
  });

  it('getRunbookHealthSummary evaluates HEALTHY when no defects exist and fleet is enrolled', async () => {
    const mockFleet = {
      enrolled: 5,
      online: 5,
      degraded: 0,
      offline: 0,
      enrolling: 0,
      unhealthy: 0,
      spoolDepth: 0,
      deadLetterDepth: 0,
      activeJobs: 0,
    };
    mockPrisma.$queryRaw.mockImplementation(async (strings: unknown) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (sql.includes('SELECT NOW()')) return [{ now: dbNow }];
      if (sql.includes('RunbookAgent')) return [mockFleet];
      return [{ count: 0 }];
    });
    mockPrisma.runbookStepAttempt.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    mockPrisma.runbookStepAttempt.findFirst.mockResolvedValueOnce(null);

    const health = await getRunbookHealthSummary();
    expect(health.health).toBe('HEALTHY');
  });

  it('getRunbookHealthSummary evaluates UNKNOWN when zero agents are enrolled', async () => {
    const mockFleet = {
      enrolled: 0,
      online: 0,
      degraded: 0,
      offline: 0,
      enrolling: 0,
      unhealthy: 0,
      spoolDepth: 0,
      deadLetterDepth: 0,
      activeJobs: 0,
    };
    mockPrisma.$queryRaw.mockImplementation(async (strings: unknown) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (sql.includes('SELECT NOW()')) return [{ now: dbNow }];
      if (sql.includes('RunbookAgent')) return [mockFleet];
      return [{ count: 0 }];
    });
    mockPrisma.runbookStepAttempt.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    mockPrisma.runbookStepAttempt.findFirst.mockResolvedValueOnce(null);

    const health = await getRunbookHealthSummary();
    expect(health.health).toBe('UNKNOWN');
  });

  it('getRunbookNavigationSummary provides resilient fallback on error', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB unreachable'));

    const nav = await getRunbookNavigationSummary();
    expect(nav).toEqual({ health: 'UNKNOWN' });
  });
});

describe('/api/runbooks/options route handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires RUNBOOK_READ_ALL capability', async () => {
    mockAssertCapability.mockRejectedValueOnce(new Error('Forbidden'));
    const req = new NextRequest('http://localhost/api/runbooks/options?kind=pool');

    await expect(optionsRouteHandler(req)).rejects.toThrow('Forbidden');
    expect(mockAssertCapability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_READ_ALL);
  });

  it('rejects invalid kind with 400 JSON error', async () => {
    const req = new NextRequest('http://localhost/api/runbooks/options?kind=invalid');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid search');
  });

  it('fetches pools bounded to 30 options', async () => {
    mockPrisma.runbookAgentPool.findMany.mockResolvedValueOnce([
      { id: 'pool-1', name: 'US-East Production' },
      { id: 'pool-2', name: 'EU-West Staging' },
    ]);

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=pool&q=prod');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([
      { value: 'pool-1', label: 'US-East Production' },
      { value: 'pool-2', label: 'EU-West Staging' },
    ]);
    expect(mockPrisma.runbookAgentPool.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 30,
        where: {
          OR: [{ name: { contains: 'prod', mode: 'insensitive' } }],
        },
      })
    );
  });

  it('fetches services bounded to 30 options', async () => {
    mockPrisma.service.findMany.mockResolvedValueOnce([
      { id: 'srv-1', name: 'Payment API' },
    ]);

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=service&q=payment');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([{ value: 'srv-1', label: 'Payment API' }]);
  });

  it('fetches runbooks bounded to 30 options', async () => {
    mockPrisma.runbook.findMany.mockResolvedValueOnce([
      { id: 'rb-1', name: 'Restart Service' },
    ]);

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=runbook&q=restart');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([{ value: 'rb-1', label: 'Restart Service' }]);
  });

  it('fetches unrevoked agents bounded to 30 options', async () => {
    mockPrisma.runbookAgent.findMany.mockResolvedValueOnce([
      { id: 'ag-1', name: 'worker-01' },
    ]);

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=agent&q=worker');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([{ value: 'ag-1', label: 'worker-01' }]);
    expect(mockPrisma.runbookAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'REVOKED' } }),
        take: 30,
      })
    );
  });

  it('requires RUNBOOK_SECRET_MANAGE and bounds targets to 15 agents + 15 pools', async () => {
    mockPrisma.runbookAgent.findMany.mockResolvedValueOnce([
      { id: 'ag-1', name: 'agent-alpha' },
    ]);
    mockPrisma.runbookAgentPool.findMany.mockResolvedValueOnce([
      { id: 'pool-1', name: 'pool-beta' },
    ]);

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=target&q=alpha');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockAssertCapability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
    expect(mockPrisma.runbookAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15 }));
    expect(mockPrisma.runbookAgentPool.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15 }));
    expect(body.options).toEqual([
      { value: 'pool:pool-1', label: 'Pool · pool-beta' },
      { value: 'agent:ag-1', label: 'Agent · agent-alpha' },
    ]);
  });

  it('resolves selected item if not present in search results', async () => {
    mockPrisma.service.findMany.mockResolvedValueOnce([
      { id: 'srv-1', name: 'Auth API' },
    ]);
    mockPrisma.service.findUnique.mockResolvedValueOnce({
      id: 'srv-99',
      name: 'Old Service Out Of View',
    });

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=service&q=auth&selected=srv-99');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([
      { value: 'srv-99', label: 'Old Service Out Of View' },
      { value: 'srv-1', label: 'Auth API' },
    ]);
  });

  it('fetches historical agents including revoked agents with indicator', async () => {
    mockPrisma.runbookAgent.findMany.mockResolvedValueOnce([
      { id: 'ag-1', name: 'worker-01', status: 'ONLINE' },
      { id: 'ag-2', name: 'decommissioned-02', status: 'REVOKED' },
    ]);

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=agent-history&q=decom');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([
      { value: 'ag-1', label: 'worker-01' },
      { value: 'ag-2', label: 'decommissioned-02 (revoked)' },
    ]);
  });

  it('resolves selected pool if not present in search results', async () => {
    mockPrisma.runbookAgentPool.findMany.mockResolvedValueOnce([
      { id: 'pool-1', name: 'US-East Production' },
    ]);
    mockPrisma.runbookAgentPool.findUnique.mockResolvedValueOnce({
      id: 'pool-99',
      name: 'EU-Central Legacy',
    });

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=pool&q=prod&selected=pool-99');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([
      { value: 'pool-99', label: 'EU-Central Legacy' },
      { value: 'pool-1', label: 'US-East Production' },
    ]);
    expect(mockPrisma.runbookAgentPool.findUnique).toHaveBeenCalledWith({
      where: { id: 'pool-99' },
      select: { id: true, name: true },
    });
  });

  it('resolves selected agent if not present in search results', async () => {
    mockPrisma.runbookAgent.findMany.mockResolvedValueOnce([
      { id: 'ag-1', name: 'worker-01', status: 'ONLINE' },
    ]);
    mockPrisma.runbookAgent.findUnique.mockResolvedValueOnce({
      id: 'ag-99',
      name: 'worker-99',
      status: 'REVOKED',
    });

    const req = new NextRequest('http://localhost/api/runbooks/options?kind=agent-history&q=worker&selected=ag-99');
    const res = await optionsRouteHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toEqual([
      { value: 'ag-99', label: 'worker-99 (revoked)' },
      { value: 'ag-1', label: 'worker-01' },
    ]);
  });
});
