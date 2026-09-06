import 'server-only';

import { createHash } from 'node:crypto';
import type { IncidentStatus } from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import {
  addOperationalMetric,
  observeOperationalHistogram,
  setOperationalGauge,
} from '@/lib/metrics/operational/registry';
import { logger } from '@/lib/logger';

export type DashboardAnalyticsFilters = {
  rangeDays?: number;
  startDate?: Date;
  endDate?: Date;
  includeAllTime?: boolean;
  serviceId?: string;
  assigneeId?: string | null;
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
  status?: 'ACTIVE' | IncidentStatus;
};

export type DashboardAnalyticsSnapshot = {
  mtta: number | null;
  mttr: number | null;
  ackCompliance: number | null;
  resolveCompliance: number | null;
  heatmapData: Array<{ date: string; count: number }>;
  serviceMetrics: Array<{
    id: string;
    name: string;
    count: number;
    activeCount?: number;
    criticalCount?: number;
  }>;
  assigneeLoad: Array<{ id: string; name: string | null; count: number }>;
  effectiveStart: string;
  effectiveEnd: string;
  isClipped: boolean;
  retentionDays: number;
  asOf: string;
  sourceGeneration: string | null;
  freshness: 'fresh' | 'stale';
};

type CacheEntry = {
  snapshot: Omit<DashboardAnalyticsSnapshot, 'freshness'>;
  freshUntil: number;
  staleUntil: number;
};

export class DashboardAnalyticsUnavailableError extends Error {
  constructor() {
    super('Dashboard analytics are temporarily unavailable');
    this.name = 'DashboardAnalyticsUnavailableError';
  }
}

const FRESH_TTL_MS = 30_000;
const STALE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();
let activeCalculations = 0;
let lastSuccessAt: Date | null = null;
let lastFailureAt: Date | null = null;

function normalizedKey(actor: AuthorizationActor, filters: DashboardAnalyticsFilters): string {
  const scope = {
    actorId: actor.id,
    role: actor.role,
    teams: [...actor.teamIds].sort(),
  };
  const normalizedFilters = {
    rangeDays: filters.rangeDays,
    startDate: filters.startDate?.toISOString(),
    endDate: filters.endDate?.toISOString(),
    includeAllTime: filters.includeAllTime === true,
    serviceId: filters.serviceId,
    assigneeId: filters.assigneeId,
    urgency: filters.urgency,
    status: filters.status,
  };
  return JSON.stringify({ scope, filters: normalizedFilters });
}

function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function prune(now: number) {
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

async function calculate(
  key: string,
  actor: AuthorizationActor,
  filters: DashboardAnalyticsFilters
): Promise<CacheEntry> {
  activeCalculations += 1;
  setOperationalGauge('opsknight_dashboard_analytics_inflight', activeCalculations);
  const startedAt = Date.now();
  try {
    const [metrics, sourceGeneration] = await Promise.all([
      calculateActorSLAMetrics(actor, {
        windowDays: filters.rangeDays,
        startDate: filters.startDate,
        endDate: filters.endDate,
        includeAllTime: filters.includeAllTime,
        serviceId: filters.serviceId,
        assigneeId: filters.assigneeId,
        urgency: filters.urgency,
        status: filters.status,
        includeIncidents: false,
        includeActiveIncidents: false,
        incidentLimit: 0,
      }),
      getRealtimeChangeGeneration(),
    ]);
    const now = Date.now();
    const snapshot: Omit<DashboardAnalyticsSnapshot, 'freshness'> = {
      mtta: metrics.mttd,
      mttr: metrics.mttr,
      ackCompliance: metrics.ackCompliance,
      resolveCompliance: metrics.resolveCompliance,
      heatmapData: (metrics.heatmapData ?? []).map(point => ({
        date: point.date,
        count: point.count,
      })),
      serviceMetrics: metrics.serviceMetrics.map(item => ({
        id: item.id,
        name: item.name,
        count: item.count,
        activeCount: item.activeCount,
        criticalCount: item.criticalCount,
      })),
      assigneeLoad: metrics.assigneeLoad.map(item => ({
        id: item.id,
        name: item.name,
        count: item.count,
      })),
      effectiveStart: metrics.effectiveStart.toISOString(),
      effectiveEnd: metrics.effectiveEnd.toISOString(),
      isClipped: metrics.isClipped,
      retentionDays: metrics.retentionDays,
      asOf: new Date(now).toISOString(),
      sourceGeneration,
    };
    const entry = { snapshot, freshUntil: now + FRESH_TTL_MS, staleUntil: now + STALE_TTL_MS };
    cache.delete(key);
    cache.set(key, entry);
    lastSuccessAt = new Date(now);
    observeOperationalHistogram('opsknight_dashboard_analytics_duration_seconds',
      (now - startedAt) / 1000);
    return entry;
  } catch (error) {
    lastFailureAt = new Date();
    addOperationalMetric('opsknight_dashboard_analytics_failures_total', 1);
    logger.error('dashboard.analytics.calculate_failed', {
      filterFingerprint: fingerprint(key),
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  } finally {
    activeCalculations -= 1;
    setOperationalGauge('opsknight_dashboard_analytics_inflight', activeCalculations);
  }
}

function startCalculation(
  key: string,
  actor: AuthorizationActor,
  filters: DashboardAnalyticsFilters
) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (activeCalculations >= 1) return null;
  const request = calculate(key, actor, filters).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export async function getDashboardAnalytics(
  actor: AuthorizationActor,
  filters: DashboardAnalyticsFilters
): Promise<DashboardAnalyticsSnapshot> {
  const now = Date.now();
  prune(now);
  const key = normalizedKey(actor, filters);
  const entry = cache.get(key);
  const currentGeneration = entry ? await getRealtimeChangeGeneration().catch(() => null) : null;
  const generationChanged = Boolean(
    entry && currentGeneration && currentGeneration !== entry.snapshot.sourceGeneration
  );
  if (entry && entry.freshUntil > now && !generationChanged) {
    addOperationalMetric('opsknight_dashboard_analytics_cache_hits_total', 1, { state: 'fresh' });
    return { ...entry.snapshot, freshness: 'fresh' };
  }
  if (entry && entry.staleUntil > now) {
    addOperationalMetric('opsknight_dashboard_analytics_cache_hits_total', 1, { state: 'stale' });
    addOperationalMetric('opsknight_dashboard_analytics_stale_served_total', 1);
    const refresh = startCalculation(key, actor, filters);
    if (refresh) void refresh.catch(() => undefined);
    return { ...entry.snapshot, freshness: 'stale' };
  }
  addOperationalMetric('opsknight_dashboard_analytics_cache_hits_total', 1, { state: 'miss' });
  const request = startCalculation(key, actor, filters);
  if (!request) throw new DashboardAnalyticsUnavailableError();
  const calculated = await request;
  return { ...calculated.snapshot, freshness: 'fresh' };
}

export function getDashboardAnalyticsHealth() {
  return {
    inflight: activeCalculations,
    cacheEntries: cache.size,
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: lastFailureAt?.toISOString() ?? null,
  };
}

export function resetDashboardAnalyticsCacheForTests() {
  cache.clear();
  inFlight.clear();
  activeCalculations = 0;
  lastSuccessAt = null;
  lastFailureAt = null;
  setOperationalGauge('opsknight_dashboard_analytics_inflight', 0);
}
