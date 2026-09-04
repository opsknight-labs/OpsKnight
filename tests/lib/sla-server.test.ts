import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { calculateMultiServiceUptime, calculateSLAMetrics } from '@/lib/sla-server';
import { clearRetentionPolicyCache } from '@/lib/retention-policy';

// Local mock for this test file to ensure isolation
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    alert: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    incidentNote: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
    onCallShift: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    onCallOverride: {
      count: vi.fn().mockResolvedValue(0),
    },
    service: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    incidentEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    systemSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    sLADefinition: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

type PrismaMock = {
  incident: {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  alert: {
    count: ReturnType<typeof vi.fn>;
    groupBy?: ReturnType<typeof vi.fn>;
  };
  incidentNote: {
    groupBy: ReturnType<typeof vi.fn>;
  };
  onCallShift: {
    findMany: ReturnType<typeof vi.fn>;
  };
  onCallOverride: {
    count: ReturnType<typeof vi.fn>;
  };
  service: {
    findMany: ReturnType<typeof vi.fn>;
  };
  incidentEvent: {
    findMany: ReturnType<typeof vi.fn>;
  };
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  systemSettings: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  sLADefinition: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

const prismaMock = prisma as unknown as PrismaMock & {
  alert?: PrismaMock['alert'];
  incident?: PrismaMock['incident'] & { groupBy?: ReturnType<typeof vi.fn> };
  incidentNote?: PrismaMock['incidentNote'];
  $queryRaw: ReturnType<typeof vi.fn>;
  systemSettings?: PrismaMock['systemSettings'];
  sLADefinition?: PrismaMock['sLADefinition'];
};

describe('calculateMultiServiceUptime visibility', () => {
  it('applies the requested incident visibility to the uptime query', async () => {
    prismaMock.incident.findMany.mockResolvedValueOnce([]);

    await calculateMultiServiceUptime(
      ['service-public'],
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
      'PUBLIC'
    );

    expect(prismaMock.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visibility: 'PUBLIC' }),
      })
    );
  });

  it('composes an authenticated incident predicate with uptime dates', async () => {
    prismaMock.incident.findMany.mockResolvedValueOnce([]);
    const incidentWhere = { assigneeId: 'user-1' };

    await calculateMultiServiceUptime(
      ['service-1'],
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z'),
      { incidentWhere }
    );

    expect(prismaMock.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([incidentWhere]),
        }),
      })
    );
  });
});

// Initialize the new mock functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prismaMock as any).$executeRaw = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prismaMock as any).$queryRaw = vi.fn();

const setupBaseMocks = ({
  activeIncidents,
  recentIncidents,
  previousIncidents,
  heatmapIncidents,
  escalationEvents,
  resolved24hCount = 0,
}: {
  activeIncidents: Array<{
    id: string;
    status: string;
    urgency: string;
    assigneeId: string | null;
    serviceId: string;
  }>;
  recentIncidents: Array<{
    id: string;
    createdAt: Date;
    updatedAt: Date | null;
    status: string;
    urgency: string;
    assigneeId: string | null;
    serviceId: string;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    service: { targetAckMinutes: number; targetResolveMinutes: number };
  }>;
  previousIncidents: Array<{
    id: string;
    createdAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    urgency: string;
    status: string;
  }>;
  heatmapIncidents: Array<{ createdAt: Date }>;
  escalationEvents: Array<{ incidentId: string; createdAt: Date }>;
  resolved24hCount?: number;
}) => {
  if (!prismaMock.alert) {
    prismaMock.alert = { count: vi.fn() };
  }
  if (!prismaMock.alert.groupBy) {
    prismaMock.alert.groupBy = vi.fn();
  }
  if (!prismaMock.incidentNote) {
    prismaMock.incidentNote = { groupBy: vi.fn() };
  }
  if (!prismaMock.incident.groupBy) {
    prismaMock.incident.groupBy = vi.fn();
  }
  if (!prismaMock.sLADefinition) {
    prismaMock.sLADefinition = { findMany: vi.fn() };
  }
  // systemSettings is now in the global mock - just call mockResolvedValue
  prismaMock.systemSettings.findUnique.mockResolvedValue({
    incidentRetentionDays: 30,
    alertRetentionDays: 30,
    logRetentionDays: 30,
    metricsRetentionDays: 30,
    realTimeWindowDays: 30,
  });
  prismaMock.systemSettings.upsert.mockResolvedValue({
    incidentRetentionDays: 30,
    alertRetentionDays: 30,
    logRetentionDays: 30,
    metricsRetentionDays: 30,
    realTimeWindowDays: 30,
  });
  prismaMock.incident.count.mockResolvedValueOnce(resolved24hCount);

  // 1. activeIncidentsData
  // 2. displayIncidentsRaw (recentIncidents)
  // 3. previousPeriodAggregates (no longer finds many, it's a raw query too, but check implementation)
  // Wait, previousPeriodAggregates is $queryRaw (line 833).
  // So there are only 2 incident.findMany calls in the Promise.all.

  prismaMock.incident.findMany
    .mockResolvedValueOnce(activeIncidents)
    .mockResolvedValueOnce(recentIncidents);

  prismaMock.alert.count.mockResolvedValueOnce(0);
  prismaMock.alert.groupBy.mockResolvedValueOnce([]);
  prismaMock.incidentNote.groupBy.mockResolvedValueOnce([]);
  prismaMock.onCallShift.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  prismaMock.onCallOverride.count.mockResolvedValueOnce(0);
  prismaMock.incident.groupBy
    .mockResolvedValueOnce([]) // muted counts
    .mockResolvedValueOnce([]) // status trends
    .mockResolvedValueOnce([]) // assignee counts
    .mockResolvedValueOnce([]) // title counts
    .mockResolvedValueOnce([]); // urgency counts

  prismaMock.service.findMany.mockResolvedValueOnce([]);
  prismaMock.incidentEvent.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(escalationEvents)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  // Mock $queryRaw to return heatmap data when requested
  // The implementation calls $queryRaw multiple times:
  // 1. aggregateResult (if useDbAggregation) - likely skipped in this test case
  // 2. percentileResult (if useDbAggregation)
  // 3. eventCountsResult (if useDbAggregation)
  // 4. heatmapAggregates (ALWAYS CALLED)
  // 5. previousPeriodAggregates (ALWAYS CALLED)

  // We need to be careful with the order or use mockImplementation to return based on query strings if possible,
  // but sequential mocks are easier if we know the order.

  // In the Promise.all:
  // ...
  // heatmapAggregates (index 10)
  // ...
  // previousPeriodAggregates (index 15)

  const heatmapRaw = heatmapIncidents.map(i => ({
    date: i.createdAt.toISOString().split('T')[0],
    count: BigInt(1),
  }));

  prismaMock.$queryRaw
    .mockResolvedValueOnce(heatmapRaw) // heatmapAggregates
    .mockResolvedValueOnce([
      {
        // previousPeriodAggregates
        total_count: BigInt(previousIncidents.length),
        high_urgency_count: BigInt(0),
        avg_mtta_ms: null,
        avg_mttr_ms: null,
        ack_count: BigInt(0),
        resolve_count: BigInt(0),
      },
    ]);

  prismaMock.$executeRaw.mockResolvedValue(0);
  prismaMock.sLADefinition.findMany.mockResolvedValue([]);
};

const toHourKey = (date: Date) => {
  const dayKey = date.toISOString().split('T')[0];
  const hour = `${date.getUTCHours()}`.padStart(2, '0');
  return `${dayKey}-${hour}`;
};

describe('calculateSLAMetrics trend series', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    clearRetentionPolicyCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds hourly trend series for a 1-day window with rate metrics', async () => {
    const recentIncidents = [
      {
        id: 'inc-1',
        createdAt: new Date('2026-01-01T01:00:00Z'),
        updatedAt: new Date('2026-01-01T02:00:00Z'),
        status: 'RESOLVED',
        urgency: 'HIGH',
        assigneeId: null,
        serviceId: 'service-1',
        acknowledgedAt: new Date('2026-01-01T01:10:00Z'),
        resolvedAt: new Date('2026-01-01T02:00:00Z'),
        service: { targetAckMinutes: 15, targetResolveMinutes: 120 },
      },
      {
        id: 'inc-2',
        createdAt: new Date('2026-01-01T05:00:00Z'),
        updatedAt: new Date('2026-01-01T05:30:00Z'),
        status: 'OPEN',
        urgency: 'LOW',
        assigneeId: null,
        serviceId: 'service-1',
        acknowledgedAt: new Date('2026-01-01T05:30:00Z'),
        resolvedAt: null,
        service: { targetAckMinutes: 15, targetResolveMinutes: 120 },
      },
    ];
    const escalationEvents = [{ incidentId: 'inc-2', createdAt: new Date('2026-01-01T05:15:00Z') }];

    setupBaseMocks({
      activeIncidents: [
        {
          id: 'inc-2',
          status: 'OPEN',
          urgency: 'LOW',
          assigneeId: null,
          serviceId: 'service-1',
        },
      ],
      recentIncidents,
      previousIncidents: [],
      heatmapIncidents: [],
      escalationEvents,
    });

    const metrics = await calculateSLAMetrics({ windowDays: 1, userTimeZone: 'UTC' });

    expect(metrics.trendSeries).toHaveLength(24);

    const hourOneKey = toHourKey(new Date('2026-01-01T01:00:00Z'));
    const hourFiveKey = toHourKey(new Date('2026-01-01T05:00:00Z'));

    const hourOne = metrics.trendSeries.find(entry => entry.key === hourOneKey);
    const hourFive = metrics.trendSeries.find(entry => entry.key === hourFiveKey);

    expect(hourOne).toBeDefined();
    expect(hourFive).toBeDefined();

    expect(hourOne?.count).toBe(1);
    expect(hourOne?.ackRate).toBe(100);
    expect(hourOne?.resolveRate).toBe(100);
    expect(hourOne?.ackCompliance).toBe(100);
    expect(hourOne?.escalationRate).toBe(0);

    expect(hourFive?.count).toBe(1);
    expect(hourFive?.ackRate).toBe(100);
    expect(hourFive?.resolveRate).toBe(0);
    expect(hourFive?.ackCompliance).toBe(0);
    expect(hourFive?.escalationRate).toBe(100);
  });

  it('builds daily trend series for multi-day windows with new fields', async () => {
    setupBaseMocks({
      activeIncidents: [],
      recentIncidents: [],
      previousIncidents: [],
      heatmapIncidents: [],
      escalationEvents: [],
    });

    const metrics = await calculateSLAMetrics({ windowDays: 7, userTimeZone: 'UTC' });

    expect(metrics.trendSeries).toHaveLength(7);
    metrics.trendSeries.forEach(entry => {
      expect(entry).toHaveProperty('ackRate');
      expect(entry).toHaveProperty('resolveRate');
      expect(entry).toHaveProperty('ackCompliance');
      expect(entry).toHaveProperty('escalationRate');
    });
  });
});

describe('calculateSLAMetrics retention metadata', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    clearRetentionPolicyCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clips requested window to retention policy and exposes metadata', async () => {
    setupBaseMocks({
      activeIncidents: [],
      recentIncidents: [],
      previousIncidents: [],
      heatmapIncidents: [],
      escalationEvents: [],
    });

    prismaMock.systemSettings.findUnique.mockResolvedValue({
      incidentRetentionDays: 1,
      alertRetentionDays: 1,
      logRetentionDays: 1,
      metricsRetentionDays: 1,
      realTimeWindowDays: 1,
    });

    const metrics = await calculateSLAMetrics({ windowDays: 7, userTimeZone: 'UTC' });

    expect(metrics.isClipped).toBe(true);
    expect(metrics.retentionDays).toBe(1);
    expect(metrics.requestedStart.toISOString().startsWith('2025-12-26')).toBe(true);
    expect(metrics.effectiveStart.toISOString().startsWith('2026-01-01')).toBe(true);
  });
});

describe('calculateSLAMetrics investigation metrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    clearRetentionPolicyCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes MTTI and MTTK from first notes and alerts', async () => {
    const recentIncidents = [
      {
        id: 'inc-1',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        updatedAt: new Date('2026-01-01T10:45:00Z'),
        status: 'OPEN',
        urgency: 'LOW',
        assigneeId: null,
        serviceId: 'service-1',
        acknowledgedAt: null,
        resolvedAt: null,
        service: { targetAckMinutes: 15, targetResolveMinutes: 120 },
      },
      {
        id: 'inc-2',
        createdAt: new Date('2026-01-01T12:00:00Z'),
        updatedAt: new Date('2026-01-01T12:20:00Z'),
        status: 'OPEN',
        urgency: 'LOW',
        assigneeId: null,
        serviceId: 'service-1',
        acknowledgedAt: null,
        resolvedAt: null,
        service: { targetAckMinutes: 15, targetResolveMinutes: 120 },
      },
    ];

    setupBaseMocks({
      activeIncidents: [],
      recentIncidents,
      previousIncidents: [],
      heatmapIncidents: [],
      escalationEvents: [],
    });

    prismaMock.incidentNote?.groupBy.mockReset().mockResolvedValueOnce([
      { incidentId: 'inc-1', _min: { createdAt: new Date('2026-01-01T10:30:00Z') } },
      { incidentId: 'inc-2', _min: { createdAt: new Date('2026-01-01T12:10:00Z') } },
    ]);
    prismaMock.alert?.groupBy?.mockReset().mockResolvedValueOnce([
      { incidentId: 'inc-1', _min: { createdAt: new Date('2026-01-01T09:45:00Z') } },
      { incidentId: 'inc-2', _min: { createdAt: new Date('2026-01-01T11:50:00Z') } },
    ]);

    const metrics = await calculateSLAMetrics({ windowDays: 1, userTimeZone: 'UTC' });

    expect(metrics.mtti).toBeCloseTo(20, 2);
    expect(metrics.mttk).toBeCloseTo(12.5, 2);
  });
});

describe('calculateSLAMetrics composed PostgreSQL queries', () => {
  type CapturedSqlQuery = { sql: string; values: unknown[] };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    clearRetentionPolicyCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flattens canonical filters into every large-dataset raw query', async () => {
    setupBaseMocks({
      activeIncidents: [],
      recentIncidents: [],
      previousIncidents: [],
      heatmapIncidents: [],
      escalationEvents: [],
    });

    prismaMock.incident.count.mockReset().mockResolvedValueOnce(501).mockResolvedValueOnce(0);
    prismaMock.$queryRaw.mockReset().mockImplementation(async (query: unknown) => {
      const sql = String((query as Partial<CapturedSqlQuery>)?.sql ?? '');

      if (sql.includes('total_incidents')) {
        return [
          {
            total_incidents: BigInt(501),
            acknowledged_count: BigInt(0),
            resolved_count: BigInt(0),
            avg_mtta_ms: null,
            avg_mttr_ms: null,
            ack_sla_met: BigInt(0),
            ack_sla_breached: BigInt(0),
            resolve_sla_met: BigInt(0),
            resolve_sla_breached: BigInt(0),
            high_urgency_count: BigInt(0),
            medium_urgency_count: BigInt(0),
            low_urgency_count: BigInt(0),
            after_hours_count: BigInt(0),
          },
        ];
      }
      if (sql.includes('mtta_p50_ms')) {
        return [
          {
            mtta_p50_ms: null,
            mtta_p95_ms: null,
            mttr_p50_ms: null,
            mttr_p95_ms: null,
          },
        ];
      }
      if (sql.includes('escalation_count')) {
        return [
          {
            escalation_count: BigInt(0),
            reopen_count: BigInt(0),
            auto_resolve_count: BigInt(0),
          },
        ];
      }
      if (sql.includes('total_count')) {
        return [
          {
            total_count: BigInt(0),
            high_urgency_count: BigInt(0),
            medium_urgency_count: BigInt(0),
            low_urgency_count: BigInt(0),
            avg_mtta_ms: null,
            avg_mttr_ms: null,
            ack_count: BigInt(0),
            resolve_count: BigInt(0),
          },
        ];
      }
      return [];
    });

    await calculateSLAMetrics({
      windowDays: 1,
      userTimeZone: 'UTC',
      serviceId: ['service-a', 'service-b'],
      teamId: ['team-a', 'team-b'],
      assigneeId: 'user-a',
      urgency: 'HIGH',
      status: 'RESOLVED',
      visibility: 'PRIVATE',
      useOrScope: true,
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(5);
    const queries = prismaMock.$queryRaw.mock.calls.map(([query]) => query as CapturedSqlQuery);

    for (const query of queries) {
      expect(query).toEqual(
        expect.objectContaining({ sql: expect.any(String), values: expect.any(Array) })
      );
      // Production previously emitted the entire filter object as a lone
      // PostgreSQL placeholder (`$3`/`$20`) in grammar position.
      expect(query.sql).not.toMatch(/^\s*\?\s*$/m);
    }

    const heatmapQuery = queries.find(query => query.sql.includes('SELECT DATE("createdAt")'));
    const aggregateQuery = queries.find(query => query.sql.includes('total_incidents'));
    const eventQuery = queries.find(query => query.sql.includes('escalation_count'));

    for (const query of [heatmapQuery, aggregateQuery, eventQuery]) {
      expect(query).toBeDefined();
      if (!query) throw new Error('Expected composed SLA query was not executed');
      expect(query.sql).toContain('= ANY(?::text[])');
      expect(query.sql).toContain('"teamId" = ANY(?::text[])');
      expect(query.sql).toContain(' OR ');
      expect(query.values).toContainEqual(['service-a', 'service-b']);
      expect(query.values).toContainEqual(['team-a', 'team-b']);
    }
  });

  it('marks comparison data unavailable when optional raw queries fail', async () => {
    setupBaseMocks({
      activeIncidents: [],
      recentIncidents: [],
      previousIncidents: [],
      heatmapIncidents: [],
      escalationEvents: [],
    });

    prismaMock.$queryRaw.mockReset().mockRejectedValue(new Error('transient database failure'));

    const metrics = await calculateSLAMetrics({ windowDays: 1, userTimeZone: 'UTC' });

    expect(metrics.previousPeriod.available).toBe(false);
    expect(metrics.heatmapAvailable).toBe(false);
    expect(metrics.heatmapData).toEqual([]);
    expect(metrics.insights).toEqual([]);
  });

  it('loads the complete filtered set when database aggregation fails', async () => {
    setupBaseMocks({
      activeIncidents: [],
      recentIncidents: [],
      previousIncidents: [],
      heatmapIncidents: [],
      escalationEvents: [],
    });

    const fallbackIncident = {
      id: 'fallback-incident',
      title: 'Fallback incident',
      description: null,
      createdAt: new Date('2026-01-01T12:00:00Z'),
      updatedAt: new Date('2026-01-01T12:30:00Z'),
      status: 'OPEN',
      urgency: 'HIGH',
      assigneeId: null,
      serviceId: 'service-a',
      acknowledgedAt: new Date('2026-01-01T12:05:00Z'),
      resolvedAt: null,
      service: {
        id: 'service-a',
        name: 'Service A',
        region: null,
        targetAckMinutes: 15,
        targetResolveMinutes: 120,
      },
    };

    prismaMock.incident.count.mockReset().mockResolvedValueOnce(501).mockResolvedValueOnce(0);
    prismaMock.incident.findMany.mockResolvedValueOnce([fallbackIncident]);
    prismaMock.$queryRaw.mockReset().mockImplementation(async (query: unknown) => {
      const sql = String((query as Partial<CapturedSqlQuery>)?.sql ?? '');
      if (sql.includes('total_incidents')) throw new Error('aggregate query failed');
      if (sql.includes('total_count')) {
        return [
          {
            total_count: BigInt(0),
            high_urgency_count: BigInt(0),
            medium_urgency_count: BigInt(0),
            low_urgency_count: BigInt(0),
            avg_mtta_ms: null,
            avg_mttr_ms: null,
            ack_count: BigInt(0),
            resolve_count: BigInt(0),
          },
        ];
      }
      return [];
    });

    const metrics = await calculateSLAMetrics({ windowDays: 1, userTimeZone: 'UTC' });

    expect(prismaMock.incident.findMany).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ take: expect.anything() })
    );
    expect(metrics.highUrgencyCount).toBe(1);
    expect(metrics.ackRate).toBe(100);
  });
});
