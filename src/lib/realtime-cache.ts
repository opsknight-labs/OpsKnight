import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
/**
 * Real-time Data Cache for SSE Streams
 *
 * This cache layer reduces database load by caching frequently accessed data
 * that's used by real-time SSE streams. Without this, 100 concurrent users
 * would generate 200-300 queries/second from polling.
 *
 * With caching: Same 100 users generate ~20-30 queries/second (10x reduction)
 *
 * Cache Strategy:
 * - Dashboard metrics: 5-second TTL (metrics don't need sub-second freshness)
 * - Incident lists: 3-second TTL (slightly fresher for incident updates)
 * - User-specific data: 5-second TTL with user-scoped keys
 */

import { createHash } from 'node:crypto';
import { logger } from './logger';
import { setOperationalGauge } from './metrics/operational/registry';
import type { Prisma } from '@prisma/client';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  /** Compact content digest used for change detection; never the serialized payload itself. */
  hash: string;
  /** Estimated retained size, used for the memory budget. */
  bytes: number;
  storedAt: number;
}

// Global cache store
const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<CacheEntry<unknown>>>();

// Cache configuration
const DEFAULT_TTL_MS = 5000; // 5 seconds
const INCIDENT_TTL_MS = 3000; // 3 seconds for incident data
const METRICS_TTL_MS = 5000; // 5 seconds for metrics
const CLEANUP_INTERVAL_MS = 30000; // Clean up every 30 seconds
const MAX_CACHE_SIZE = 5000; // Prevent unbounded growth
// Entry count alone does not bound memory: one dashboard active set can hold thousands of
// incidents. The budget is weighted by estimated bytes (UTF-16 serialized size).
const DEFAULT_MAX_CACHE_BYTES = 96 * 1024 * 1024;
const configuredBudget = Number(process.env.REALTIME_CACHE_MAX_BYTES);
const MAX_CACHE_BYTES =
  Number.isFinite(configuredBudget) && configuredBudget > 0
    ? configuredBudget
    : DEFAULT_MAX_CACHE_BYTES;
// An entry larger than this share of the budget is served to its callers but not retained.
const MAX_ENTRY_BYTES = Math.floor(MAX_CACHE_BYTES / 4);

let totalBytes = 0;

let lastCleanup = Date.now();

/** Serialize once; the digest replaces the retained JSON string used for change detection. */
function measure(data: unknown): { hash: string; bytes: number } {
  const json = JSON.stringify(data) ?? '';
  return { hash: createHash('sha1').update(json).digest('base64url'), bytes: json.length * 2 };
}

function publishCacheGauges(): void {
  setOperationalGauge('opsknight_realtime_cache_bytes', totalBytes);
  setOperationalGauge('opsknight_realtime_cache_entries', cache.size);
}

function dropEntry(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  totalBytes -= entry.bytes;
  cache.delete(key);
  publishCacheGauges();
}

function storeEntry(key: string, entry: CacheEntry<unknown>): void {
  dropEntry(key);
  if (entry.bytes > MAX_ENTRY_BYTES) return;
  cache.set(key, entry);
  totalBytes += entry.bytes;
  publishCacheGauges();
  // Map iteration order is insertion order, so the oldest entries are evicted first.
  for (const oldest of cache.keys()) {
    if (totalBytes <= MAX_CACHE_BYTES && cache.size <= MAX_CACHE_SIZE) break;
    if (oldest === key) continue;
    dropEntry(oldest);
  }
}

/**
 * Clean up expired entries
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) {
      dropEntry(key);
      cleaned++;
    }
  }

  // If cache is still too large, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = entries.slice(0, cache.size - MAX_CACHE_SIZE + 100);
    for (const [key] of toRemove) {
      dropEntry(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug('[RealtimeCache] Cleaned up entries', { cleaned, remaining: cache.size });
  }

  lastCleanup = now;
}

/**
 * Maybe run cleanup based on time or size
 */
function maybeCleanup(): void {
  const now = Date.now();
  if (
    now - lastCleanup >= CLEANUP_INTERVAL_MS ||
    cache.size > MAX_CACHE_SIZE ||
    totalBytes > MAX_CACHE_BYTES
  ) {
    cleanupExpiredEntries();
  }
}

/**
 * Logical clock for ordering flight starts against callers' needs. Wall-clock milliseconds cannot
 * order two events inside the same millisecond, which would let an older flight satisfy a newer need.
 */
let logicalClock = 0;
const tick = () => ++logicalClock;
/** Logical start of each in-flight fetch; a fetch that began after a caller's need satisfies it. */
const inFlightStartedAt = new Map<string, number>();

/**
 * Start a single-flight fetch for `key` (the caller has already established there is none to join).
 * A rejected fetch stores nothing, so a failure can never be mistaken for fresh data.
 */
function startFlight<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<CacheEntry<T>> {
  const startedAt = tick();
  const request: Promise<CacheEntry<T>> = fetcher()
    .then(data => {
      const entry = {
        data,
        expiresAt: Date.now() + ttlMs,
        storedAt: Date.now(),
        ...measure(data),
      };
      storeEntry(key, entry);
      return entry;
    })
    .finally(() => {
      if (inFlight.get(key) === request) {
        inFlight.delete(key);
        inFlightStartedAt.delete(key);
      }
    });
  inFlight.set(key, request);
  inFlightStartedAt.set(key, startedAt);
  return request;
}

/**
 * Get cached data or fetch fresh data
 */
export async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<{ data: T; fromCache: boolean; hash: string }> {
  maybeCleanup();

  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;

  // Return cached data if still valid
  if (existing && now < existing.expiresAt) {
    return { data: existing.data, fromCache: true, hash: existing.hash };
  }

  // Coalesce equivalent misses on this replica. Freshness begins only after
  // the fetch completes, so a slow query cannot populate an expired entry.
  const request =
    (inFlight.get(key) as Promise<CacheEntry<T>> | undefined) ?? startFlight(key, fetcher, ttlMs);
  const entry = await request;
  return { data: entry.data, fromCache: false, hash: entry.hash };
}

/**
 * Like `getCachedOrFetch`, but a cached value is only served while `accept(data, ageMs)` holds.
 * It bounds database work by time while honoring a caller's freshness requirement:
 *
 * - concurrent callers share one fetch per key (single flight);
 * - a fetch that was already running when the caller needed fresher data is NOT trusted to satisfy
 *   it unless its result passes `accept`; otherwise a new fetch is started (or a fetch that began
 *   after the need is joined);
 * - a failed fetch never satisfies anyone and never populates the cache.
 */
export async function getCachedWhenAcceptable<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
  accept: (data: T, ageMs: number) => boolean
): Promise<{ data: T; fromCache: boolean; hash: string }> {
  maybeCleanup();
  const need = tick();
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && now < existing.expiresAt && accept(existing.data, now - existing.storedAt)) {
    return { data: existing.data, fromCache: true, hash: existing.hash };
  }

  const pending = inFlight.get(key) as Promise<CacheEntry<T>> | undefined;
  if (pending) {
    if ((inFlightStartedAt.get(key) ?? 0) > need) {
      const joined = await pending;
      return { data: joined.data, fromCache: false, hash: joined.hash };
    }
    try {
      const settled = await pending;
      if (accept(settled.data, Date.now() - settled.storedAt)) {
        return { data: settled.data, fromCache: false, hash: settled.hash };
      }
    } catch {
      // A failed earlier fetch satisfies nobody; fall through to a fetch of our own.
    }
  }

  // The cached or earlier value is unacceptable: fetch, or join a fetch that began after `need`.
  const racing = inFlight.get(key) as Promise<CacheEntry<T>> | undefined;
  const fresh =
    racing && (inFlightStartedAt.get(key) ?? 0) > need ? racing : startFlight(key, fetcher, ttlMs);
  const entry = await fresh;
  return { data: entry.data, fromCache: false, hash: entry.hash };
}

/**
 * Check if data has changed since last hash
 */
export async function getIfChanged<T>(
  key: string,
  fetcher: () => Promise<T>,
  lastHash: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<{ data: T; changed: boolean; hash: string } | null> {
  const result = await getCachedOrFetch(key, fetcher, ttlMs);

  if (result.hash === lastHash) {
    return null; // No change
  }

  return { data: result.data, changed: true, hash: result.hash };
}

// ============================================================================
// Pre-built cache functions for common real-time data
// ============================================================================

import prisma from './prisma';
import { CAPABILITIES, hasCapability, isAppRole, type AppRole } from './authorization';
import { incidentReadWhere } from './authorization-filters';
import { compileIncidentMetricFilter, type IncidentMetricFilter } from './metrics/domain/filter';

/**
 * Cache key generators
 */
export const CacheKeys = {
  dashboardMetrics: (userId: string, scope: string) =>
    scope === 'global' ? 'metrics:global' : `metrics:${userId}:${scope}`,
  incidentList: (scope: string, filters: string) => `incidents:${scope}:${filters}`,
  serviceIncidents: (serviceId: string) => `service-incidents:${serviceId}`,
  userIncidents: (userId: string) => `user-incidents:${userId}`,
  recentIncidents: (teamIds: string) => `recent-incidents:${teamIds}`,
};

/**
 * Get dashboard metrics with caching
 */
export async function getCachedDashboardMetrics(
  userId: string,
  role: string,
  teamIds: string[],
  lastHash?: string,
  generation?: string | null,
  metricFilter: IncidentMetricFilter = {}
) {
  const hasGlobalMetrics = isAppRole(role) && hasCapability(role, CAPABILITIES.METRICS_READ_ALL);
  const scope = hasGlobalMetrics ? 'global' : `user:${userId}`;
  const filterKey = JSON.stringify({
    serviceId: metricFilter.serviceId,
    teamId: metricFilter.teamId,
    assigneeId: metricFilter.assigneeId,
    urgency: metricFilter.urgency,
    status: metricFilter.status,
  });
  const key = `${CacheKeys.dashboardMetrics(userId, scope)}:${filterKey}:g:${generation ?? 'initial'}`;

  const fetcher = async () => {
    const authorizationScope = hasGlobalMetrics
      ? {}
      : incidentReadWhere({ id: userId, role: role as AppRole, status: 'ACTIVE', teamIds });
    const selectedScope = compileIncidentMetricFilter({
      ...metricFilter,
      status: undefined,
    }).prisma;
    const scope: Prisma.IncidentWhereInput = { AND: [authorizationScope, selectedScope] };
    const resolvedSince = new Date(Date.now() - 24 * 60 * 60_000);
    const [statusGroups, resolved24h] = await Promise.all([
      prisma.incident.groupBy({
        by: ['status', 'urgency'],
        where: scope,
        _count: { _all: true },
      }),
      prisma.incident.count({
        where: { AND: [scope, { status: 'RESOLVED', resolvedAt: { gte: resolvedSince } }] },
      }),
    ]);
    const count = (status: string) =>
      statusGroups
        .filter(group => group.status === status)
        .reduce((sum, group) => sum + group._count._all, 0);
    const open = count('OPEN');
    const acknowledged = count('ACKNOWLEDGED');
    const snoozed = count('SNOOZED');
    const suppressed = count('SUPPRESSED');
    const active = open + acknowledged;
    const critical = statusGroups
      .filter(
        group =>
          (group.status === 'OPEN' || group.status === 'ACKNOWLEDGED') && group.urgency === 'HIGH'
      )
      .reduce((sum, group) => sum + group._count._all, 0);
    const urgencyCount = (urgency: string) =>
      statusGroups
        .filter(
          group =>
            (group.status === 'OPEN' || group.status === 'ACKNOWLEDGED') &&
            group.urgency === urgency
        )
        .reduce((sum, group) => sum + group._count._all, 0);
    const unassigned = await prisma.incident.count({
      where: { AND: [scope, { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, assigneeId: null }] },
    });

    return {
      open,
      acknowledged,
      resolved: resolved24h,
      critical,
      mediumUrgency: urgencyCount('MEDIUM'),
      lowUrgency: urgencyCount('LOW'),
      active,
      snoozed,
      suppressed,
      unassigned,
      isClipped: false,
      retentionDays: null,
    };
  };

  if (lastHash) {
    return getIfChanged(key, fetcher, lastHash, METRICS_TTL_MS);
  }

  const result = await getCachedOrFetch(key, fetcher, METRICS_TTL_MS);
  return { data: result.data, changed: true, hash: result.hash };
}

/**
 * Get recent incidents with caching
 */
export async function getCachedRecentIncidents(
  userId: string,
  role: string,
  teamIds: string[],
  lastHash?: string,
  generation?: string | null
) {
  const isPrivileged = isAppRole(role) && hasCapability(role, CAPABILITIES.INCIDENT_READ_ALL);
  const scopeKey = isPrivileged
    ? CacheKeys.recentIncidents('global')
    : `recent-incidents:${userId}:${teamIds.slice().sort().join(',')}`;
  const sensitive = isAppRole(role) && hasCapability(role, CAPABILITIES.INCIDENT_SENSITIVE_READ);
  const key = `${scopeKey}:sensitive:${sensitive}:g:${generation ?? 'initial'}`;

  const fetcher = async () => {
    const whereClause = incidentReadWhere({
      id: userId,
      role: role as AppRole,
      status: 'ACTIVE',
      teamIds,
    });

    const incidents = await prisma.incident.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        automationSourceRestricted: true,
        automationDecision: { select: { incidentId: true } },
        automationTraces: { select: { incidentId: true }, take: 1 },
        description: true,
        status: true,
        urgency: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        escalationStatus: true,
        currentEscalationStep: true,
        nextEscalationAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        slaAckTargetMs: true,
        slaResolveTargetMs: true,
        slaTargetSource: true,
        slaTargetCapturedAt: true,
        slaPausedMs: true,
        slaPauseStartedAt: true,
        slaAckElapsedMs: true,
        slaFirstAcknowledgedAt: true,
        slaResolveElapsedMs: true,
        assigneeId: true,
        teamId: true,
        service: {
          select: {
            id: true,
            name: true,
            targetAckMinutes: true,
            targetResolveMinutes: true,
          },
        },
        team: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      take: 50,
      orderBy: { updatedAt: 'desc' },
    });
    return incidents.map(incident => ({
      ...visibleIncidentSource(incident, sensitive),
      slaPausedMs: Number(incident.slaPausedMs),
      slaAckElapsedMs: incident.slaAckElapsedMs === null ? null : Number(incident.slaAckElapsedMs),
      slaResolveElapsedMs:
        incident.slaResolveElapsedMs === null ? null : Number(incident.slaResolveElapsedMs),
    }));
  };

  if (lastHash) {
    return getIfChanged(key, fetcher, lastHash, INCIDENT_TTL_MS);
  }

  const result = await getCachedOrFetch(key, fetcher, INCIDENT_TTL_MS);
  return { data: result.data, changed: true, hash: result.hash };
}

/**
 * Get service incidents with caching
 */
export async function getCachedServiceIncidents(serviceId: string, lastHash?: string) {
  const key = CacheKeys.serviceIncidents(serviceId);

  const fetcher = async () => {
    return prisma.incident.findMany({
      where: { serviceId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        automationSourceRestricted: true,
        automationDecision: { select: { incidentId: true } },
        automationTraces: { select: { incidentId: true }, take: 1 },
        status: true,
        urgency: true,
        updatedAt: true,
      },
    });
  };

  if (lastHash) {
    return getIfChanged(key, fetcher, lastHash, INCIDENT_TTL_MS);
  }

  const result = await getCachedOrFetch(key, fetcher, INCIDENT_TTL_MS);
  return { data: result.data, changed: true, hash: result.hash };
}

/**
 * Get incident details with caching
 */
export async function getCachedIncidentDetails(incidentId: string, lastHash?: string) {
  const key = `incident:${incidentId}`;

  const fetcher = async () => {
    return prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        automationDecision: { select: { incidentId: true } },
        automationTraces: { select: { incidentId: true }, take: 1 },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  };

  if (lastHash) {
    return getIfChanged(key, fetcher, lastHash, INCIDENT_TTL_MS);
  }

  const result = await getCachedOrFetch(key, fetcher, INCIDENT_TTL_MS);
  return { data: result.data, changed: true, hash: result.hash };
}

/**
 * Invalidate cache entries by pattern
 */
export function invalidateCache(pattern: string): number {
  let invalidated = 0;
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      dropEntry(key);
      invalidated++;
    }
  }
  for (const key of inFlight.keys()) {
    if (key.includes(pattern)) {
      inFlight.delete(key);
      inFlightStartedAt.delete(key);
    }
  }
  return invalidated;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; hitRate: number; bytes: number } {
  return {
    size: cache.size,
    bytes: totalBytes,
    hitRate: 0, // Would need to track hits/misses to calculate
  };
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  cache.clear();
  inFlight.clear();
  inFlightStartedAt.clear();
  totalBytes = 0;
}
