type CacheEntry<T> = { value: T; expiresAt: number };

const CAPACITY_TTL_MS = 5_000;
const RUNTIME_TTL_MS = 5_000;

function createCache<T>() {
  const store = new Map<string, CacheEntry<T>>();
  return {
    get(key: string, now: number): T | null {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= now) {
        if (entry) store.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key: string, value: T, now: number, ttl = CAPACITY_TTL_MS) {
      store.set(key, { value, expiresAt: now + ttl });
    },
    invalidate(key?: string) {
      if (key) store.delete(key);
      else store.clear();
    },
  };
}

export const capacityCache = createCache<unknown>();
export const runtimeCache = createCache<unknown>();

export function invalidateCapacityCache(key?: string) {
  capacityCache.invalidate(key);
}

export function invalidateRuntimeCache() {
  runtimeCache.invalidate();
}

export const CACHE_TTLS = { capacityTtlMs: CAPACITY_TTL_MS, runtimeTtlMs: RUNTIME_TTL_MS };
