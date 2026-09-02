import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fixture rollups: 3 days, each with a mix of priorities and lifecycle data.
const makeRollup = (overrides: Record<string, unknown> = {}) => ({
  id: 'rollup-' + Math.random(),
  date: new Date('2024-01-01T00:00:00.000Z'),
  granularity: 'daily',
  serviceId: null,
  teamId: null,
  totalIncidents: 10,
  openIncidents: 1,
  acknowledgedIncidents: 2,
  resolvedIncidents: 7,
  highUrgencyIncidents: 3,
  mediumUrgencyIncidents: 4,
  lowUrgencyIncidents: 3,
  p1Incidents: 2,
  p2Incidents: 3,
  p3Incidents: 3,
  p4Incidents: 1,
  p5Incidents: 1,
  mttaSum: BigInt(60 * 60 * 1000) * BigInt(5), // 5 acks, 1h each
  mttaCount: 5,
  mttrSum: BigInt(2 * 60 * 60 * 1000) * BigInt(7), // 7 resolves, 2h each
  mttrCount: 7,
  ackSlaMet: 4,
  ackSlaBreached: 1,
  resolveSlaMet: 5,
  resolveSlaBreached: 2,
  escalationCount: 2,
  escalationEventCount: 2,
  escalatedIncidentCount: 2,
  reopenCount: 0,
  reopenEventCount: 0,
  reopenedIncidentCount: 0,
  autoResolveCount: 3,
  autoResolveEventCount: 3,
  autoResolvedIncidentCount: 3,
  alertCount: 0,
  afterHoursCount: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const { findManyMock, priorityFindManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  priorityFindManyMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incidentMetricRollup: {
      findMany: findManyMock,
    },
    incidentMetricRollupByPriority: {
      findMany: priorityFindManyMock,
    },
    systemSettings: {
      findUnique: vi.fn().mockResolvedValue({
        incidentRetentionDays: 730,
        alertRetentionDays: 365,
        logRetentionDays: 90,
        metricsRetentionDays: 365,
        realTimeWindowDays: 90,
      }),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { calculateSLAMetricsFromRollups } from '@/lib/sla-server';

const REQUESTED_START = new Date('2024-01-01T00:00:00.000Z');
const REQUESTED_END = new Date('2024-01-03T23:59:59.999Z');

describe('calculateSLAMetricsFromRollups', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    priorityFindManyMock.mockReset().mockResolvedValue([]);
  });

  it('aggregates total incidents across rollup days without priority filter', async () => {
    findManyMock.mockResolvedValueOnce([
      makeRollup({ totalIncidents: 10, p1Incidents: 2 }),
      makeRollup({ totalIncidents: 6, p1Incidents: 1 }),
    ]);
    // heatmap query
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false
    );

    expect(result.totalIncidents).toBe(16);
    expect(result.dataSource).toBe('rollup');
  });

  it('honors priority filter using p1-p5 fields, not totalIncidents (regression for the disabled-code bug)', async () => {
    findManyMock.mockResolvedValueOnce([
      makeRollup({ totalIncidents: 10, p1Incidents: 2, p2Incidents: 3 }),
      makeRollup({ totalIncidents: 6, p1Incidents: 1, p2Incidents: 2 }),
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false,
      { priority: ['P1', 'P2'] }
    );

    // Pre-fix this returned 16 (sum of totalIncidents) regardless of the
    // filter. Correct value is 2+3 + 1+2 = 8.
    expect(result.totalIncidents).toBe(8);
  });

  it('accepts loose priority strings (P1, p1, "1", " p2 ")', async () => {
    findManyMock.mockResolvedValueOnce([
      makeRollup({ totalIncidents: 10, p1Incidents: 4, p2Incidents: 3 }),
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false,
      { priority: ['p1', '2'] }
    );

    expect(result.totalIncidents).toBe(7);
  });

  it('returns null for percentile fields rather than fake equal-to-avg values', async () => {
    findManyMock.mockResolvedValueOnce([makeRollup()]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false
    );

    expect(result.mttaP50).toBeNull();
    expect(result.mttaP95).toBeNull();
    expect(result.mttrP50).toBeNull();
    expect(result.mttrP95).toBeNull();
  });

  it('returns null compliance when nothing was evaluated (not zero)', async () => {
    findManyMock.mockResolvedValueOnce([
      makeRollup({
        totalIncidents: 5,
        ackSlaMet: 0,
        ackSlaBreached: 0,
        resolveSlaMet: 0,
        resolveSlaBreached: 0,
      }),
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false
    );

    expect(result.ackCompliance).toBeNull();
    expect(result.resolveCompliance).toBeNull();
  });

  it('returns lifecycle/compliance as null when priority filter is active (per-priority sums not stored)', async () => {
    findManyMock.mockResolvedValueOnce([makeRollup({ p1Incidents: 3 })]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false,
      { priority: 'P1' }
    );

    expect(result.totalIncidents).toBe(3);
    expect(result.mttr).toBeNull();
    expect(result.ackCompliance).toBeNull();
    expect(result.resolveCompliance).toBeNull();
  });

  it('rejects partial priority side-table coverage for a multi-day range', async () => {
    const first = makeRollup({ id: 'rollup-day-1', p1Incidents: 1 });
    const second = makeRollup({ id: 'rollup-day-2', p1Incidents: 1 });
    findManyMock.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([]);
    priorityFindManyMock.mockResolvedValueOnce([
      {
        rollupId: first.id,
        priority: 'P1',
        incidents: 1,
        mttaSum: BigInt(60_000),
        mttaCount: 1,
        mttrSum: BigInt(0),
        mttrCount: 0,
        ackSlaMet: 1,
        ackSlaBreached: 0,
        resolveSlaMet: 0,
        resolveSlaBreached: 0,
      },
    ]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false,
      { priority: 'P1' }
    );

    expect(result.totalIncidents).toBe(2);
    expect(result.mttd).toBeNull();
    expect(result.ackCompliance).toBeNull();
  });

  it('preserves user-requested range distinct from effective (clipped) range', async () => {
    findManyMock.mockResolvedValueOnce([]);
    findManyMock.mockResolvedValueOnce([]);

    const requestedStart = new Date('2020-01-01T00:00:00.000Z');
    const requestedEnd = new Date('2020-12-31T23:59:59.999Z');
    const effectiveStart = new Date('2020-03-01T00:00:00.000Z');
    const effectiveEnd = requestedEnd;

    const result = await calculateSLAMetricsFromRollups(
      requestedStart,
      requestedEnd,
      effectiveStart,
      effectiveEnd,
      true
    );

    expect(result.requestedStart).toEqual(requestedStart);
    expect(result.requestedEnd).toEqual(requestedEnd);
    expect(result.effectiveStart).toEqual(effectiveStart);
    expect(result.effectiveEnd).toEqual(effectiveEnd);
    expect(result.isClipped).toBe(true);
  });

  it('clamps negative manualResolved (event ILIKE over-counting safety)', async () => {
    findManyMock.mockResolvedValueOnce([
      // 2 resolves but the event-classifier thinks 5 were auto-resolved
      // (over-counted from message ILIKE matching).
      makeRollup({
        totalIncidents: 5,
        resolvedIncidents: 2,
        autoResolveCount: 5,
        autoResolveEventCount: 5,
        autoResolvedIncidentCount: 2,
      }),
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false
    );

    expect(result.manualResolvedCount).toBe(0);
  });

  it('derives ACK rate from canonical acknowledged samples, not resolved status', async () => {
    findManyMock.mockResolvedValueOnce([
      makeRollup({
        totalIncidents: 10,
        acknowledgedIncidents: 0,
        resolvedIncidents: 8,
        mttaCount: 3,
      }),
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false
    );

    expect(result.ackRate).toBe(30);
  });

  it('subtracts distinct auto-resolved incidents, not raw auto-resolve events', async () => {
    findManyMock.mockResolvedValueOnce([
      makeRollup({
        resolvedIncidents: 7,
        autoResolveCount: 5,
        autoResolveEventCount: 5,
        autoResolvedIncidentCount: 2,
      }),
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false
    );

    expect(result.manualResolvedCount).toBe(5);
  });

  it('applies priority filter to the heatmap as well as the headline metrics', async () => {
    findManyMock.mockResolvedValueOnce([makeRollup()]);
    findManyMock.mockResolvedValueOnce([
      {
        date: new Date('2024-01-01'),
        totalIncidents: 10,
        p1Incidents: 4,
        p2Incidents: 3,
        p3Incidents: 2,
        p4Incidents: 1,
        p5Incidents: 0,
      },
    ]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false,
      { priority: 'P1' }
    );

    expect(result.heatmapData).toHaveLength(1);
    expect(result.heatmapData[0].count).toBe(4);
  });

  it('does not return fake equal P50==P95 (regression for hardcoded approximation)', async () => {
    findManyMock.mockResolvedValueOnce([
      makeRollup({
        mttaSum: BigInt(60 * 60 * 1000) * BigInt(10),
        mttaCount: 10,
      }),
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const result = await calculateSLAMetricsFromRollups(
      REQUESTED_START,
      REQUESTED_END,
      REQUESTED_START,
      REQUESTED_END,
      false
    );

    // Both null (not equal-to-avg) is the correct contract.
    expect(result.mttaP50).toBeNull();
    expect(result.mttaP95).toBeNull();
    expect(result.mttaP50).toEqual(result.mttaP95); // both null
  });
});
