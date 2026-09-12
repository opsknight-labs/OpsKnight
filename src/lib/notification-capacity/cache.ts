type CacheEntry<T> = { value: T; expiresAt: number };

const CAPACITY_TTL_MS = 5_000;
const RUNTIME_TTL_MS = 5_000;
// Webhook origins are unbounded cardinality — prevent gradual process-memory growth
// from expired entries left behind when many distinct origins churn.
const CAPACITY_MAX_ENTRIES = 512;
const RUNTIME_NEGATIVE_SENTINEL = Symbol('RUNTIME_NULL');

function createCache<T>({ maxEntries }: { maxEntries?: number } = {}) {
  const store = new Map<string, CacheEntry<T>>();
  function sweepExpired(now: number) {
    for (const [k, entry] of store) {
      if (entry.expiresAt <= now) store.delete(k);
    }
  }
  function evictIfNeeded() {
    if (maxEntries == null || store.size < maxEntries) return;
    // Evict oldest (insertion order) until under limit — plain LRU via insertion order refresh on get/set.
    const toEvict = store.size - maxEntries + 1;
    let evicted = 0;
    for (const k of store.keys()) {
      if (evicted >= toEvict) break;
      store.delete(k);
      evicted++;
    }
  }
  return {
    get(key: string, now: number): T | null | undefined {
      const entry = store.get(key);
      if (!entry) return undefined; // cache miss
      if (entry.expiresAt <= now) {
        store.delete(key);
        return undefined; // expired → miss
      }
      // Refresh LRU position
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T, now: number, ttl = CAPACITY_TTL_MS) {
      // Delete existing key first so eviction counts its slot as free on update.
      if (store.has(key)) store.delete(key);
      sweepExpired(now);
      evictIfNeeded();
      store.set(key, { value, expiresAt: now + ttl });
    },
    invalidate(key?: string) {
      if (key) store.delete(key);
      else store.clear();
    },
    /** Test-only: number of live entries */
    _size() {
      return store.size;
    },
  };
}

// capacityCache is bounded because WEBHOOK provider keys are dynamic URL origins.
export const capacityCache = createCache<unknown>({ maxEntries: CAPACITY_MAX_ENTRIES });
// runtimeCache is singleton-sized but uses sentinel so cached-null (no row yet) is not re-queried each fanout.
export const runtimeCache = createCache<unknown>();

export function invalidateCapacityCache(key?: string) {
  capacityCache.invalidate(key);
}

export function invalidateRuntimeCache() {
  runtimeCache.invalidate();
}

export const CACHE_TTLS = { capacityTtlMs: CAPACITY_TTL_MS, runtimeTtlMs: RUNTIME_TTL_MS };
export const RUNTIME_NULL_SENTINEL = RUNTIME_NEGATIVE_SENTINEL;
