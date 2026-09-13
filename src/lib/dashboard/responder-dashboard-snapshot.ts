import 'server-only';

import { createHash } from 'node:crypto';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { actorMetricReadScope } from '@/lib/authorization-filters';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import {
  addResponderCacheLookup,
  addResponderFailure,
  observeResponderDuration,
  setResponderInflight,
} from '@/lib/metrics/operational/responder-registry';
import { logger } from '@/lib/logger';

export type ResponderDashboardSnapshot = {
  openIncidents: number;
  criticalIncidents: number;
  acknowledgedIncidents: number;
  resolved24h: number;
  mutedIncidents: number;
  totalActive: number;
  activeIncidents: Array<{
    id: string;
    title: string;
    status: string;
    urgency: string;
    createdAt: Date;
    service: { name: string };
  }>;
  currentOnCallShift: {
    id: string;
    scheduleId?: string;
    schedule: { id?: string; name: string };
    start: Date;
    end: Date;
  } | null;
  generatedAt: Date;
  sourceGeneration: string | null;
  freshness: 'fresh' | 'stale';
};

type SharedSnapshot = Omit<ResponderDashboardSnapshot, 'currentOnCallShift' | 'freshness'> & {
  currentShifts: Array<{
    id: string;
    userId?: string;
    scheduleId?: string;
    schedule: { id?: string; name: string };
    start: Date;
    end: Date;
  }>;
};

type CacheEntry = {
  snapshot: SharedSnapshot;
  freshUntil: number;
  staleUntil: number;
};

export class ResponderDashboardUnavailableError extends Error {
  constructor() {
    super('Responder dashboard is temporarily unavailable');
    this.name = 'ResponderDashboardUnavailableError';
  }
}

const FRESH_TTL_MS = 20_000;
const STALE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
const MAX_CONCURRENT_CALCULATIONS = 4;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();
let activeCalculations = 0;

function normalizedScopeKey(actor: AuthorizationActor) {
  const authorizationScope = actorMetricReadScope(actor).authorizationScope;
  const scope = authorizationScope
    ? {
        type: 'scoped',
        actorId: authorizationScope.actorId,
        teams: [...authorizationScope.teamIds].sort(),
      }
    : { type: 'global' };
  return JSON.stringify({ scope, windowDays: 90, includeActiveIncidents: true });
}

function fingerprint(key: string) {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function prune(now: number) {
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

async function calculate(key: string, actor: AuthorizationActor): Promise<CacheEntry> {
  activeCalculations += 1;
  setResponderInflight(activeCalculations);
  const startedAt = Date.now();

  try {
    const [metrics, sourceGeneration] = await Promise.all([
      calculateActorSLAMetrics(actor, {
        windowDays: 90,
        includeAllTime: false,
        includeActiveIncidents: true,
        // The dashboard renders only five items; cap the detailed incident projection
        // while aggregate metrics continue to cover the complete authorized window.
        incidentLimit: 25,
        includeDescription: false,
      }),
      getRealtimeChangeGeneration().catch(() => null),
    ]);

    const generatedAt = new Date();
    const activeIncidents = [...(metrics.activeIncidentSummaries ?? [])]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map(incident => ({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        urgency: incident.urgency,
        createdAt: incident.createdAt,
        service: { name: incident.serviceName },
      }));

    const snapshot: SharedSnapshot = {
      openIncidents: metrics.openCount,
      criticalIncidents: metrics.criticalCount,
      acknowledgedIncidents: metrics.acknowledgedCount,
      resolved24h: metrics.resolved24h,
      mutedIncidents: metrics.snoozedCount + metrics.suppressedCount,
      totalActive: metrics.openCount + metrics.acknowledgedCount,
      activeIncidents,
      currentShifts: metrics.currentShifts.map(shift => ({
        id: shift.id,
        userId: shift.userId,
        scheduleId: shift.scheduleId,
        schedule: { id: shift.schedule.id, name: shift.schedule.name },
        start: shift.start,
        end: shift.end,
      })),
      generatedAt,
      sourceGeneration,
    };

    const now = generatedAt.getTime();
    const entry = {
      snapshot,
      freshUntil: now + FRESH_TTL_MS,
      staleUntil: now + STALE_TTL_MS,
    };
    cache.delete(key);
    cache.set(key, entry);
    observeResponderDuration((Date.now() - startedAt) / 1000);
    return entry;
  } catch (error) {
    addResponderFailure();
    logger.error('dashboard.responder.calculate_failed', {
      scopeFingerprint: fingerprint(key),
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  } finally {
    activeCalculations -= 1;
    setResponderInflight(activeCalculations);
  }
}

function startCalculation(key: string, actor: AuthorizationActor) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (activeCalculations >= MAX_CONCURRENT_CALCULATIONS) return null;
  const request = calculate(key, actor).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

function projectForUser(
  snapshot: SharedSnapshot,
  userId: string | undefined,
  freshness: 'fresh' | 'stale'
): ResponderDashboardSnapshot {
  const currentOnCallShift = userId
    ? snapshot.currentShifts.find(shift => shift.userId === userId && shift.end) ?? null
    : null;

  return {
    openIncidents: snapshot.openIncidents,
    criticalIncidents: snapshot.criticalIncidents,
    acknowledgedIncidents: snapshot.acknowledgedIncidents,
    resolved24h: snapshot.resolved24h,
    mutedIncidents: snapshot.mutedIncidents,
    totalActive: snapshot.totalActive,
    activeIncidents: snapshot.activeIncidents,
    currentOnCallShift,
    generatedAt: snapshot.generatedAt,
    sourceGeneration: snapshot.sourceGeneration,
    freshness,
  };
}

/**
 * Actor-scoped, stale-while-revalidate read model used by responder surfaces.
 * It bounds detailed incident reads, single-flights identical work and reacts to
 * the shared realtime generation so incident changes invalidate quickly.
 */
export async function getResponderDashboardSnapshot(
  actor: AuthorizationActor,
  userId?: string
): Promise<ResponderDashboardSnapshot> {
  const now = Date.now();
  prune(now);
  const key = normalizedScopeKey(actor);
  const entry = cache.get(key);
  const currentGeneration = entry ? await getRealtimeChangeGeneration().catch(() => null) : null;
  const generationChanged = Boolean(
    entry && currentGeneration && currentGeneration !== entry.snapshot.sourceGeneration
  );

  if (entry && entry.freshUntil > now && !generationChanged) {
    addResponderCacheLookup('fresh');
    return projectForUser(entry.snapshot, userId, 'fresh');
  }

  if (entry && entry.staleUntil > now) {
    addResponderCacheLookup('stale');
    const refresh = startCalculation(key, actor);
    if (refresh) void refresh.catch(() => undefined);
    return projectForUser(entry.snapshot, userId, 'stale');
  }

  addResponderCacheLookup('miss');
  const request = startCalculation(key, actor);
  if (!request) throw new ResponderDashboardUnavailableError();
  const calculated = await request;
  return projectForUser(calculated.snapshot, userId, 'fresh');
}

export function resetResponderDashboardCacheForTests() {
  cache.clear();
  inFlight.clear();
  activeCalculations = 0;
  setResponderInflight(0);
}
