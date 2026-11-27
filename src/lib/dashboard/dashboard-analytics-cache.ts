import 'server-only';

import { createHash } from 'node:crypto';
import type { IncidentStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { tryAdvisoryLock } from '@/lib/db-locks';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import {
  addOperationalMetric,
  observeOperationalHistogram,
  setOperationalGauge,
} from '@/lib/metrics/operational/registry';
import { logger } from '@/lib/logger';
import { actorMetricReadScope } from '@/lib/authorization-filters';

export type DashboardAnalyticsFilters = {
  rangeDays?: number;
  startDate?: Date;
  endDate?: Date;
  includeAllTime?: boolean;
  serviceId?: string;
  assigneeId?: string | null;
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
  status?: 'ACTIVE' | IncidentStatus;
  /** The viewer's IANA zone: heatmap and trend days are that zone's calendar days. */
  userTimeZone?: string;
};

export type DashboardAnalyticsSnapshot = {
  mtta: number | null;
  mttr: number | null;
  ackCompliance: number | null;
  resolveCompliance: number | null;
  heatmapData: Array<{ date: string; count: number }>;
  /** False when the heatmap query failed, so an empty calendar is not read as zero incidents. */
  heatmapAvailable?: boolean;
  serviceMetrics: Array<{
    id: string;
    name: string;
    count: number;
    activeCount?: number;
    criticalCount?: number;
  }>;
  assigneeLoad: Array<{ id: string; name: string | null; count: number }>;
  /** Created vs resolved per bucket for the selected period (incident flow chart). */
  trendSeries: Array<{ key: string; label: string; count: number; resolveCount: number }>;
  previousPeriod: {
    available: boolean;
    mtta: number | null;
    mttr: number | null;
    totalIncidents: number;
  };
  totalIncidents: number;
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
/** Cold requests for other keys wait their turn for the one heavy-query slot, within these bounds. */
const MAX_QUEUED = 8;
const QUEUE_WAIT_MS = 10_000;
const slotWaiters: Array<() => void> = [];
/** A cold key waits this long for another replica's computation before computing for itself. */
const CLUSTER_LOCK_WAIT_MS = 3_000;
const CLUSTER_LOCK_POLL_MS = 250;
/** The lock lives as long as its transaction, so this bounds the longest computation it covers. */
const CLUSTER_LOCK_TX_TIMEOUT_MS = 60_000;
let lastSuccessAt: Date | null = null;
let lastFailureAt: Date | null = null;

function normalizedKey(actor: AuthorizationActor, filters: DashboardAnalyticsFilters): string {
  const metricScope = actorMetricReadScope(actor).authorizationScope;
  const scope = metricScope
    ? { type: 'scoped', actorId: metricScope.actorId, teams: [...metricScope.teamIds].sort() }
    : { type: 'global' };
  // On-call data is scoped by schedule access, which a custom role may grant differently.
  const scheduleAccess = authorize({ actor, action: AUTHORIZATION_ACTIONS.SCHEDULE_READ });
  const schedules = !scheduleAccess.allowed
    ? 'none'
    : scheduleAccess.scope === 'global'
      ? 'all'
      : actor.id;
  const normalizedFilters = {
    rangeDays: filters.rangeDays,
    startDate: filters.startDate?.toISOString(),
    endDate: filters.endDate?.toISOString(),
    includeAllTime: filters.includeAllTime === true,
    serviceId: filters.serviceId,
    assigneeId: filters.assigneeId,
    urgency: filters.urgency,
    status: filters.status,
    userTimeZone: filters.userTimeZone,
  };
  return JSON.stringify({ scope, schedules, filters: normalizedFilters });
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
        userTimeZone: filters.userTimeZone,
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
      heatmapAvailable: metrics.heatmapAvailable,
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
      trendSeries: (metrics.trendSeries ?? []).map(point => ({
        key: point.key,
        label: point.label,
        count: point.count,
        resolveCount: point.resolveCount,
      })),
      previousPeriod: {
        available: metrics.previousPeriod?.available !== false,
        mtta: metrics.previousPeriod?.mtta ?? null,
        mttr: metrics.previousPeriod?.mttr ?? null,
        totalIncidents: metrics.previousPeriod?.totalIncidents ?? 0,
      },
      totalIncidents: metrics.totalIncidents,
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
    observeOperationalHistogram(
      'opsknight_dashboard_analytics_duration_seconds',
      (now - startedAt) / 1000
    );
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
  }
}

type ClusterRun =
  | { state: 'done'; entry: CacheEntry }
  | { state: 'contended' }
  | { state: 'unavailable' };

function clusterLockKey(key: string): bigint {
  return createHash('sha256').update(`dashboard-analytics:${key}`).digest().readBigInt64BE(0);
}

/**
 * Runs `compute` while holding a transaction-scoped Postgres advisory lock for this cache key, so
 * replicas do not recompute the same entry at the same time. The lock ends with the transaction
 * (commit, rollback or a lost connection), never with a separate unlock call, which also keeps it
 * correct behind a transaction-mode connection pooler. A failed lock query is `unavailable`.
 */
async function runUnderClusterLock(
  key: string,
  compute: () => Promise<CacheEntry>
): Promise<ClusterRun> {
  type Outcome = { entry: CacheEntry } | { error: unknown };
  const run: { computing?: Promise<Outcome> } = {};
  try {
    const acquired = await prisma.$transaction(
      async tx => {
        if (!(await tryAdvisoryLock(tx, clusterLockKey(key)))) return false;
        run.computing = compute().then(
          (entry): Outcome => ({ entry }),
          (error): Outcome => ({ error })
        );
        await run.computing;
        return true;
      },
      { maxWait: 2_000, timeout: CLUSTER_LOCK_TX_TIMEOUT_MS }
    );
    if (!acquired) return { state: 'contended' };
  } catch (error) {
    // A computation that already started is not repeated if only closing the transaction failed.
    if (!run.computing) {
      logger.warn('dashboard.analytics.cluster_lock_unavailable', {
        filterFingerprint: fingerprint(key),
        error,
      });
      return { state: 'unavailable' };
    }
  }
  const outcome = await run.computing;
  if (!outcome) return { state: 'unavailable' };
  if ('error' in outcome) throw outcome.error;
  return { state: 'done', entry: outcome.entry };
}

/**
 * One computation per entry across replicas. A refresh of an entry another replica is already
 * computing keeps serving the stale value; a cold key waits a few seconds for that replica and
 * then computes for itself, so a lock problem never fails a request. Always frees the process slot.
 */
async function calculateAcrossReplicas(
  key: string,
  actor: AuthorizationActor,
  filters: DashboardAnalyticsFilters,
  stale: CacheEntry | undefined
): Promise<CacheEntry> {
  const compute = () => calculate(key, actor, filters);
  try {
    const giveUpAt = Date.now() + CLUSTER_LOCK_WAIT_MS;
    for (;;) {
      const run = await runUnderClusterLock(key, compute);
      if (run.state === 'done') return run.entry;
      if (run.state === 'unavailable') return await compute();
      logger.debug('dashboard.analytics.cluster_lock_contended', {
        filterFingerprint: fingerprint(key),
        serveStale: Boolean(stale),
      });
      if (stale) return stale;
      if (Date.now() >= giveUpAt) return await compute();
      await new Promise(resolve => setTimeout(resolve, CLUSTER_LOCK_POLL_MS));
    }
  } finally {
    releaseSlot();
  }
}

function releaseSlot() {
  const next = slotWaiters.shift();
  if (next) next();
  else activeCalculations -= 1;
  setOperationalGauge('opsknight_dashboard_analytics_inflight', activeCalculations);
}

/** Resolves when the slot has been handed over; rejects if the turn does not come in time. */
function queueForSlot(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const grant = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const index = slotWaiters.indexOf(grant);
      if (index >= 0) slotWaiters.splice(index, 1);
      reject(new DashboardAnalyticsUnavailableError());
    }, QUEUE_WAIT_MS);
    slotWaiters.push(grant);
  });
}

function startCalculation(
  key: string,
  actor: AuthorizationActor,
  filters: DashboardAnalyticsFilters,
  options: { queue?: boolean } = {}
) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  let slot: Promise<void>;
  if (activeCalculations < 1) {
    activeCalculations += 1;
    setOperationalGauge('opsknight_dashboard_analytics_inflight', activeCalculations);
    slot = Promise.resolve();
  } else if (options.queue && slotWaiters.length < MAX_QUEUED) {
    slot = queueForSlot();
  } else {
    return null;
  }
  // Only a refresh has a stale value to fall back on; a cold key (queue) has none.
  const stale = options.queue ? undefined : cache.get(key);
  const request = slot
    .then(() => calculateAcrossReplicas(key, actor, filters, stale))
    .finally(() => {
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
  const request = startCalculation(key, actor, filters, { queue: true });
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
  slotWaiters.length = 0;
  activeCalculations = 0;
  lastSuccessAt = null;
  lastFailureAt = null;
  setOperationalGauge('opsknight_dashboard_analytics_inflight', 0);
}
