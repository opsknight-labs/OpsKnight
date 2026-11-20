import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';

/**
 * Per-process stale-while-revalidate cache, same policy as
 * dashboard-analytics-cache: fresh for 30s, served stale for up to 5 min
 * while one refresh runs, and invalidated early when incident data changes
 * (realtime change generation). Concurrent identical requests share one query.
 *
 * shortcut: per-process memory; move to Redis if the app runs many replicas.
 */

const FRESH_TTL_MS = 30_000;
const STALE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;

type Entry = {
  value: unknown;
  generation: string | null;
  /** When the value was computed (ms epoch). */
  computedAt: number;
  freshUntil: number;
  staleUntil: number;
};

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry>>();

function prune(now: number) {
  for (const [key, entry] of cache) if (entry.staleUntil <= now) cache.delete(key);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

function refresh(key: string, compute: () => Promise<unknown>): Promise<Entry> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const request = Promise.all([compute(), getRealtimeChangeGeneration().catch(() => null)])
    .then(([value, generation]) => {
      const now = Date.now();
      const entry = {
        value,
        generation,
        computedAt: now,
        freshUntil: now + FRESH_TTL_MS,
        staleUntil: now + STALE_TTL_MS,
      };
      cache.delete(key);
      cache.set(key, entry);
      return entry;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export type Cached<T> = { value: T; asOf: Date };

/** Like `cached`, plus when the returned value was computed. */
export async function cachedWithTime<T>(
  key: string,
  compute: () => Promise<T>
): Promise<Cached<T>> {
  const now = Date.now();
  prune(now);
  let entry = cache.get(key);
  if (entry) {
    const generation = await getRealtimeChangeGeneration().catch(() => null);
    // Fail closed: if we can't prove the data is unchanged (signal unavailable now or
    // when cached), recompute. Assignee/watcher/team changes alter what an actor may see.
    const changed = !generation || !entry.generation || generation !== entry.generation;
    if (changed || entry.staleUntil <= now) entry = undefined;
    else if (entry.freshUntil <= now) void refresh(key, compute).catch(() => undefined);
  }
  entry ??= await refresh(key, compute);
  return { value: entry.value as T, asOf: new Date(entry.computedAt) };
}

export async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  return (await cachedWithTime(key, compute)).value;
}

/** Drops every entry whose key contains `fragment`; the next read recomputes. */
export function invalidateCached(fragment: string): number {
  let dropped = 0;
  for (const key of cache.keys()) {
    if (key.includes(fragment)) {
      cache.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}

export function resetAnalyticsCacheForTests() {
  cache.clear();
  inFlight.clear();
}
