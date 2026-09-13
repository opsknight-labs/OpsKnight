import 'server-only';

import type { AuthorizationActor } from '@/lib/authorization-policy';
import { actorMetricReadScope } from '@/lib/authorization-filters';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { logger } from '@/lib/logger';

type Metrics = Awaited<ReturnType<typeof calculateActorSLAMetrics>>;

export type ResponderAnalyticsSnapshot = {
  metrics: Metrics;
  windowDays: 7 | 30 | 90;
  generatedAt: Date;
  sourceGeneration: string | null;
  freshness: 'fresh' | 'stale';
};

type CacheEntry = Omit<ResponderAnalyticsSnapshot, 'freshness'> & {
  freshUntil: number;
  staleUntil: number;
};

const FRESH_TTL_MS = 30_000;
const STALE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 300;
const MAX_CONCURRENT_CALCULATIONS = 3;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();
const cacheEpochs = new Map<string, number>();
let activeCalculations = 0;

function scopeKey(actor: AuthorizationActor, windowDays: 7 | 30 | 90) {
  const authorizationScope = actorMetricReadScope(actor).authorizationScope;
  const scope = authorizationScope
    ? {
        type: 'scoped',
        actorId: authorizationScope.actorId,
        teams: [...authorizationScope.teamIds].sort(),
      }
    : { type: 'global' };
  return JSON.stringify({ scope, windowDays, projection: 'responder-analytics-v1' });
}

function prune(now: number) {
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

function cacheEpoch(key: string) {
  return cacheEpochs.get(key) ?? 0;
}

/**
 * Authorization/realtime generation changes are a hard cache boundary. In-flight work that
 * started before the boundary may finish for its original caller, but must never repopulate
 * the cache or be reused by callers after the boundary.
 */
function invalidateAuthorizationBoundary(key: string) {
  cache.delete(key);
  cacheEpochs.set(key, cacheEpoch(key) + 1);
  inFlight.delete(key);
}

async function calculate(
  key: string,
  actor: AuthorizationActor,
  windowDays: 7 | 30 | 90,
  epoch: number
): Promise<CacheEntry> {
  activeCalculations += 1;
  const startedAt = Date.now();
  try {
    const [metrics, sourceGeneration] = await Promise.all([
      calculateActorSLAMetrics(actor, {
        windowDays,
        includeAllTime: false,
        includeIncidents: true,
        incidentLimit: 15,
        includeActiveIncidents: true,
        includeDescription: false,
      }),
      getRealtimeChangeGeneration().catch(() => null),
    ]);
    const generatedAt = new Date();
    const entry: CacheEntry = {
      metrics,
      windowDays,
      generatedAt,
      sourceGeneration,
      freshUntil: generatedAt.getTime() + FRESH_TTL_MS,
      staleUntil: generatedAt.getTime() + STALE_TTL_MS,
    };

    if (cacheEpoch(key) === epoch) {
      cache.delete(key);
      cache.set(key, entry);
    }
    return entry;
  } catch (error) {
    logger.error('dashboard.responderAnalytics.calculate_failed', {
      windowDays,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  } finally {
    activeCalculations = Math.max(0, activeCalculations - 1);
  }
}

function startCalculation(
  key: string,
  actor: AuthorizationActor,
  windowDays: 7 | 30 | 90
) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (activeCalculations >= MAX_CONCURRENT_CALCULATIONS) return null;

  const epoch = cacheEpoch(key);
  const request = calculate(key, actor, windowDays, epoch).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

function project(entry: CacheEntry, freshness: 'fresh' | 'stale'): ResponderAnalyticsSnapshot {
  return {
    metrics: entry.metrics,
    windowDays: entry.windowDays,
    generatedAt: entry.generatedAt,
    sourceGeneration: entry.sourceGeneration,
    freshness,
  };
}

export async function getResponderAnalyticsSnapshot(
  actor: AuthorizationActor,
  windowDays: 7 | 30 | 90
): Promise<ResponderAnalyticsSnapshot> {
  const now = Date.now();
  prune(now);
  const key = scopeKey(actor, windowDays);
  const entry = cache.get(key);

  if (entry) {
    const currentGeneration = await getRealtimeChangeGeneration().catch(() => null);
    const generationTrusted =
      currentGeneration !== null &&
      entry.sourceGeneration !== null &&
      currentGeneration === entry.sourceGeneration;

    // Never serve actor-scoped stale data if its authorization generation cannot be proven
    // current. This includes both a known generation change and control-plane failure.
    if (!generationTrusted) {
      invalidateAuthorizationBoundary(key);
      const refresh = startCalculation(key, actor, windowDays);
      if (!refresh) throw new Error('Responder analytics is temporarily busy');
      return project(await refresh, 'fresh');
    }

    if (entry.freshUntil > now) return project(entry, 'fresh');

    if (entry.staleUntil > now) {
      const refresh = startCalculation(key, actor, windowDays);
      if (refresh) void refresh.catch(() => undefined);
      return project(entry, 'stale');
    }
  }

  const request = startCalculation(key, actor, windowDays);
  if (!request) throw new Error('Responder analytics is temporarily busy');
  return project(await request, 'fresh');
}

export function resetResponderAnalyticsCacheForTests() {
  cache.clear();
  inFlight.clear();
  cacheEpochs.clear();
  activeCalculations = 0;
}
