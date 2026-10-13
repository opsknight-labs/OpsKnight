/**
 * High-performance, memory-bounded in-process LRU cache with TTL.
 * Critical for protecting PostgreSQL and PGBouncer from redundant token lookups,
 * role resolutions, and rate limit spikes.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryLruCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;

  constructor(maxSize: number = 5000, defaultTtlMs: number = 60_000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh LRU order (delete & set puts it at the end of Map iteration)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.map.size >= this.maxSize) {
      // Evict oldest entry (first key in map iterator)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey) {
        this.map.delete(oldestKey);
      }
    }

    const duration = ttlMs ?? this.defaultTtlMs;
    this.map.set(key, {
      value,
      expiresAt: Date.now() + duration,
    });
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// Global caches (persisted across module re-evaluations in development)
declare global {
  // eslint-disable-next-line no-var
  var __v2AuthCache: MemoryLruCache<unknown> | undefined;
  // eslint-disable-next-line no-var
  var __v2RateLimitCache: MemoryLruCache<number> | undefined;
}

export const authCache = (globalThis.__v2AuthCache ??= new MemoryLruCache(5000, 60_000));
export const rateLimitMemoryCache = (globalThis.__v2RateLimitCache ??= new MemoryLruCache(10_000, 60_000));
