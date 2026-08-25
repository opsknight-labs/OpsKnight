import type { SLAMetricsFilter } from './sla-server';
import type { WidgetDataContext } from './widget-data-provider';
import { getWidgetData } from './widget-data-provider';

const WIDGET_CACHE_TTL_MS = 5_000;
const MAX_WIDGET_CACHE_ENTRIES = 1_000;

type CacheEntry = {
  expiresAt: number;
  value: Promise<WidgetDataContext>;
};

const widgetCache = new Map<string, CacheEntry>();

function serializeFilterValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeFilterValue).sort();
  return value;
}

export function buildWidgetCacheKey(
  userId: string,
  role: string,
  filters: SLAMetricsFilter
): string {
  const normalizedFilters = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, serializeFilterValue(value)]);

  return JSON.stringify([userId, role, normalizedFilters]);
}

/**
 * Share the expensive widget calculation across equivalent SSE connections.
 * The promise itself is cached so simultaneous connections coalesce into one
 * calculation. User and filter scope are part of the key to prevent data from
 * crossing authorization or dashboard-filter boundaries.
 */
export async function getCachedWidgetData(
  userId: string,
  role: string,
  filters: SLAMetricsFilter,
  now = Date.now()
): Promise<WidgetDataContext> {
  const key = buildWidgetCacheKey(userId, role, filters);
  const existing = widgetCache.get(key);
  if (existing && existing.expiresAt > now) return existing.value;

  // Filter combinations are user-controlled. Bound the process-local map and
  // preferentially discard expired entries before evicting the oldest key.
  if (widgetCache.size >= MAX_WIDGET_CACHE_ENTRIES) {
    for (const [cachedKey, entry] of widgetCache) {
      if (entry.expiresAt <= now) widgetCache.delete(cachedKey);
    }
    while (widgetCache.size >= MAX_WIDGET_CACHE_ENTRIES) {
      const oldestKey = widgetCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      widgetCache.delete(oldestKey);
    }
  }

  const value = getWidgetData(userId, role, filters);
  widgetCache.set(key, { expiresAt: now + WIDGET_CACHE_TTL_MS, value });

  try {
    return await value;
  } catch (error) {
    // A transient failure must not poison this key until the TTL expires.
    if (widgetCache.get(key)?.value === value) widgetCache.delete(key);
    throw error;
  }
}

export function clearWidgetDataCache(): void {
  widgetCache.clear();
}
