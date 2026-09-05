import type { SLAMetricsFilter } from './sla-server';
import { getWidgetRealtimeProjection, type WidgetRealtimeProjection } from './widget-data-provider';

const FRESH_TTL_MS = 30_000;
const STALE_TTL_MS = 5 * 60_000;
const MAX_WIDGET_CACHE_ENTRIES = 1_000;

type CacheEntry = {
  value?: WidgetRealtimeProjection;
  freshUntil: number;
  staleUntil: number;
  inFlight?: Promise<WidgetRealtimeProjection>;
  lastAccessAt: number;
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

function evict(now: number): void {
  for (const [key, entry] of widgetCache) {
    if (entry.staleUntil <= now && !entry.inFlight) widgetCache.delete(key);
  }
  if (widgetCache.size < MAX_WIDGET_CACHE_ENTRIES) return;
  const oldest = [...widgetCache.entries()]
    .sort((left, right) => left[1].lastAccessAt - right[1].lastAccessAt)
    .slice(0, widgetCache.size - MAX_WIDGET_CACHE_ENTRIES + 1);
  for (const [key] of oldest) widgetCache.delete(key);
}

function refresh(
  key: string,
  entry: CacheEntry,
  filters: SLAMetricsFilter
): Promise<WidgetRealtimeProjection> {
  if (entry.inFlight) return entry.inFlight;
  const request = getWidgetRealtimeProjection(filters)
    .then(value => {
      // Start freshness after the expensive fetch completes.
      const completedAt = Date.now();
      entry.value = value;
      entry.freshUntil = completedAt + FRESH_TTL_MS;
      entry.staleUntil = completedAt + STALE_TTL_MS;
      entry.lastAccessAt = completedAt;
      return value;
    })
    .finally(() => {
      if (entry.inFlight === request) entry.inFlight = undefined;
      if (!entry.value && widgetCache.get(key) === entry) widgetCache.delete(key);
    });
  entry.inFlight = request;
  return request;
}

/** Process-local L1 singleflight with bounded stale-while-revalidate. */
export async function getCachedWidgetData(
  userId: string,
  role: string,
  filters: SLAMetricsFilter,
  now = Date.now()
): Promise<WidgetRealtimeProjection> {
  const key = buildWidgetCacheKey(userId, role, filters);
  let entry = widgetCache.get(key);
  if (entry) {
    entry.lastAccessAt = now;
    if (entry.value && entry.freshUntil > now) return entry.value;
    if (entry.value && entry.staleUntil > now) {
      void refresh(key, entry, filters).catch(() => undefined);
      return entry.value;
    }
    return refresh(key, entry, filters);
  }

  evict(now);
  entry = { freshUntil: 0, staleUntil: 0, lastAccessAt: now };
  widgetCache.set(key, entry);
  return refresh(key, entry, filters);
}

export function clearWidgetDataCache(): void {
  widgetCache.clear();
}
