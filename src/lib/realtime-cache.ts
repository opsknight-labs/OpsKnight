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

import { logger } from './logger';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  hash: string;
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

let lastCleanup = Date.now();

/**
 * Generate a simple hash for change detection
 */
function hashData(data: any): string {
  return JSON.stringify(data);
}

/**
 * Clean up expired entries
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) {
      cache.delete(key);
      cleaned++;
    }
  }

  // If cache is still too large, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = entries.slice(0, cache.size - MAX_CACHE_SIZE + 100);
    for (const [key] of toRemove) {
      cache.delete(key);
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
  if (now - lastCleanup >= CLEANUP_INTERVAL_MS || cache.size > MAX_CACHE_SIZE) {
    cleanupExpiredEntries();
  }
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
  let request = inFlight.get(key) as Promise<CacheEntry<T>> | undefined;
  if (!request) {
    request = fetcher()
      .then(data => {
        const entry = { data, expiresAt: Date.now() + ttlMs, hash: hashData(data) };
        cache.set(key, entry);
        return entry;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
  }
  const entry = await request;
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
  generation?: string | null
): Promise<{ data: any; changed: boolean; hash: string } | null> {
  const hasGlobalMetrics = isAppRole(role) && hasCapability(role, CAPABILITIES.METRICS_READ_ALL);
  const scope = hasGlobalMetrics ? 'global' : `user:${userId}`;
  const key = `${CacheKeys.dashboardMetrics(userId, scope)}:g:${generation ?? 'initial'}`;

  const fetcher = async () => {
    const scope = hasGlobalMetrics
      ? {}
      : incidentReadWhere({ id: userId, role: role as AppRole, status: 'ACTIVE', teamIds });
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
    const active = statusGroups
      .filter(group => group.status !== 'RESOLVED')
      .reduce((sum, group) => sum + group._count._all, 0);
    const critical = statusGroups
      .filter(group => group.status !== 'RESOLVED' && group.urgency === 'HIGH')
      .reduce((sum, group) => sum + group._count._all, 0);

    return {
      open,
      acknowledged,
      resolved: resolved24h,
      critical,
      active,
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
): Promise<{ data: any; changed: boolean; hash: string } | null> {
  const isPrivileged = isAppRole(role) && hasCapability(role, CAPABILITIES.INCIDENT_READ_ALL);
  const scopeKey = isPrivileged
    ? CacheKeys.recentIncidents('global')
    : `recent-incidents:${userId}:${teamIds.slice().sort().join(',')}`;
  const key = `${scopeKey}:g:${generation ?? 'initial'}`;

  const fetcher = async () => {
    const whereClause: any = {};

    if (!isPrivileged) {
      whereClause.OR = [
        { assigneeId: userId },
        { service: { team: { members: { some: { userId } } } } },
      ];
    }

    return prisma.incident.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
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
export async function getCachedServiceIncidents(
  serviceId: string,
  lastHash?: string
): Promise<{ data: any; changed: boolean; hash: string } | null> {
  const key = CacheKeys.serviceIncidents(serviceId);

  const fetcher = async () => {
    return prisma.incident.findMany({
      where: { serviceId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
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
export async function getCachedIncidentDetails(
  incidentId: string,
  lastHash?: string
): Promise<{ data: any; changed: boolean; hash: string } | null> {
  const key = `incident:${incidentId}`;

  const fetcher = async () => {
    return prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
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
      cache.delete(key);
      invalidated++;
    }
  }
  for (const key of inFlight.keys()) {
    if (key.includes(pattern)) inFlight.delete(key);
  }
  return invalidated;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; hitRate: number } {
  return {
    size: cache.size,
    hitRate: 0, // Would need to track hits/misses to calculate
  };
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  cache.clear();
  inFlight.clear();
}
