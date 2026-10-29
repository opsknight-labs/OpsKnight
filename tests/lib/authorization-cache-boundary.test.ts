import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calculateMetrics: vi.fn(),
  generation: vi.fn(),
  statusPageFindFirst: vi.fn(),
  serviceFindMany: vi.fn(),
  incidentGroupBy: vi.fn(),
  incidentFindMany: vi.fn(),
}));

vi.mock('@/lib/actor-metrics', () => ({
  calculateActorSLAMetrics: mocks.calculateMetrics,
}));

vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: mocks.generation,
}));

vi.mock('@/lib/authorization-filters', () => ({
  actorMetricReadScope: vi.fn(actor => ({
    authorizationScope: { actorId: actor.id, teamIds: actor.teamIds },
  })),
  incidentReadWhere: vi.fn(() => ({})),
  serviceReadWhere: vi.fn(() => ({})),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    statusPage: { findFirst: mocks.statusPageFindFirst },
    service: { findMany: mocks.serviceFindMany },
    incident: {
      groupBy: mocks.incidentGroupBy,
      findMany: mocks.incidentFindMany,
    },
  },
}));

vi.mock('@/lib/service-status', () => ({
  getServiceDynamicStatus: vi.fn(() => 'OPERATIONAL'),
}));

vi.mock('@/lib/sla-server', () => ({
  getExternalStatusLabel: vi.fn(status => status),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import {
  getResponderAnalyticsSnapshot,
  resetResponderAnalyticsCacheForTests,
} from '@/lib/dashboard/responder-analytics-snapshot';
import {
  getInternalOperationalStatusSnapshot,
  resetInternalOperationalStatusCacheForTests,
} from '@/lib/status/internal-operational-status-snapshot';

const actor = {
  id: 'user-1',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  teamIds: ['team-1'],
};

function activeIncident(title: string) {
  return {
    id: `incident-${title}`,
    title,
    status: 'TRIGGERED',
    urgency: 'HIGH',
    createdAt: new Date('2026-09-14T00:00:00.000Z'),
    service: { name: 'API' },
  };
}

function queueOperationalProjection(title: string) {
  mocks.incidentFindMany
    .mockResolvedValueOnce([activeIncident(title)])
    .mockResolvedValueOnce([]);
}

describe('authorization-sensitive cache generation boundaries', () => {
  let generation = '1';
  let failGeneration = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T00:00:00.000Z'));
    vi.clearAllMocks();
    resetResponderAnalyticsCacheForTests();
    resetInternalOperationalStatusCacheForTests();

    generation = '1';
    failGeneration = false;
    mocks.generation.mockImplementation(() =>
      failGeneration ? Promise.reject(new Error('control plane unavailable')) : Promise.resolve(generation)
    );
    mocks.statusPageFindFirst.mockResolvedValue(null);
    mocks.serviceFindMany.mockResolvedValue([{ id: 'service-1', name: 'API' }]);
    mocks.incidentGroupBy.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recalculates responder analytics across a generation change and never serves the old entry', async () => {
    const oldMetrics = { marker: 'old' };
    const newMetrics = { marker: 'new' };
    mocks.calculateMetrics.mockResolvedValueOnce(oldMetrics).mockResolvedValueOnce(newMetrics);

    const first = await getResponderAnalyticsSnapshot(actor, 30);
    expect(first.metrics).toBe(oldMetrics);

    generation = '2';
    const second = await getResponderAnalyticsSnapshot(actor, 30);

    expect(second.metrics).toBe(newMetrics);
    expect(second.sourceGeneration).toBe('2');
    expect(second.freshness).toBe('fresh');
    expect(mocks.calculateMetrics).toHaveBeenCalledTimes(2);
  });

  it('fails closed when responder generation validation is unavailable', async () => {
    const firstMetrics = { marker: 'first' };
    const secondMetrics = { marker: 'second' };
    const thirdMetrics = { marker: 'third' };
    mocks.calculateMetrics
      .mockResolvedValueOnce(firstMetrics)
      .mockResolvedValueOnce(secondMetrics)
      .mockResolvedValueOnce(thirdMetrics);

    await getResponderAnalyticsSnapshot(actor, 30);
    failGeneration = true;

    const second = await getResponderAnalyticsSnapshot(actor, 30);
    const third = await getResponderAnalyticsSnapshot(actor, 30);

    expect(second.metrics).toBe(secondMetrics);
    expect(third.metrics).toBe(thirdMetrics);
    expect(second.sourceGeneration).toBeNull();
    expect(third.sourceGeneration).toBeNull();
    expect(mocks.calculateMetrics).toHaveBeenCalledTimes(3);
  });

  it('prevents detached pre-boundary responder work from repopulating the cache', async () => {
    const initialMetrics = { marker: 'initial' };
    const oldRefreshMetrics = { marker: 'detached-old' };
    const boundaryMetrics = { marker: 'boundary-fresh' };
    let resolveOldRefresh!: (value: typeof oldRefreshMetrics) => void;

    mocks.calculateMetrics
      .mockResolvedValueOnce(initialMetrics)
      .mockReturnValueOnce(new Promise(resolve => (resolveOldRefresh = resolve)))
      .mockResolvedValueOnce(boundaryMetrics);

    await getResponderAnalyticsSnapshot(actor, 30);
    vi.advanceTimersByTime(31_000);

    const stale = await getResponderAnalyticsSnapshot(actor, 30);
    expect(stale.metrics).toBe(initialMetrics);
    expect(stale.freshness).toBe('stale');

    generation = '2';
    const boundary = await getResponderAnalyticsSnapshot(actor, 30);
    expect(boundary.metrics).toBe(boundaryMetrics);

    resolveOldRefresh(oldRefreshMetrics);
    await Promise.resolve();
    await Promise.resolve();

    const afterDetachedCompletion = await getResponderAnalyticsSnapshot(actor, 30);
    expect(afterDetachedCompletion.metrics).toBe(boundaryMetrics);
    expect(mocks.calculateMetrics).toHaveBeenCalledTimes(3);
  });

  it('recalculates operational status across a generation change and on generation failure', async () => {
    queueOperationalProjection('old-visible');
    const first = await getInternalOperationalStatusSnapshot(actor);
    expect(first.activeIncidents[0]?.title).toBe('old-visible');

    generation = '2';
    queueOperationalProjection('new-visible');
    const second = await getInternalOperationalStatusSnapshot(actor);
    expect(second.activeIncidents[0]?.title).toBe('new-visible');
    expect(second.sourceGeneration).toBe('2');

    failGeneration = true;
    queueOperationalProjection('fresh-while-generation-down');
    const third = await getInternalOperationalStatusSnapshot(actor);
    expect(third.activeIncidents[0]?.title).toBe('fresh-while-generation-down');
    expect(third.sourceGeneration).toBeNull();

    queueOperationalProjection('fresh-again-while-generation-down');
    const fourth = await getInternalOperationalStatusSnapshot(actor);
    expect(fourth.activeIncidents[0]?.title).toBe('fresh-again-while-generation-down');
    expect(mocks.statusPageFindFirst).toHaveBeenCalledTimes(4);
  });

  it('prevents detached pre-boundary operational work from repopulating the cache', async () => {
    queueOperationalProjection('initial');
    await getInternalOperationalStatusSnapshot(actor);
    vi.advanceTimersByTime(21_000);

    let releaseOldCalculation!: () => void;
    mocks.statusPageFindFirst.mockReturnValueOnce(
      new Promise(resolve => {
        releaseOldCalculation = () => resolve(null);
      })
    );
    queueOperationalProjection('detached-old');

    const stale = await getInternalOperationalStatusSnapshot(actor);
    expect(stale.activeIncidents[0]?.title).toBe('initial');
    expect(stale.freshness).toBe('stale');

    generation = '2';
    mocks.statusPageFindFirst.mockResolvedValueOnce(null);
    queueOperationalProjection('boundary-fresh');
    const boundary = await getInternalOperationalStatusSnapshot(actor);
    expect(boundary.activeIncidents[0]?.title).toBe('boundary-fresh');

    releaseOldCalculation();
    await Promise.resolve();
    await Promise.resolve();

    const afterDetachedCompletion = await getInternalOperationalStatusSnapshot(actor);
    expect(afterDetachedCompletion.activeIncidents[0]?.title).toBe('boundary-fresh');
    expect(mocks.statusPageFindFirst).toHaveBeenCalledTimes(3);
  });
});
