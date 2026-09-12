import { beforeEach, describe, expect, it } from 'vitest';
import { capacityCache, runtimeCache } from '@/lib/notification-capacity/cache';
import { resetCapacityResolverForTests } from '@/lib/notification-capacity/resolver';

describe('notification capacity cache hardening', () => {
  beforeEach(() => {
    resetCapacityResolverForTests();
    capacityCache.invalidate();
    runtimeCache.invalidate();
  });

  it('remains bounded under webhook-origin cardinality (LRU, maxEntries)', () => {
    const now = 1000;
    // Pump more distinct origins than the bound (512)
    for (let i = 0; i < 600; i++) {
      capacityCache.set(`WEBHOOK:https://hooks.example.com/${i}`, { v: i } as unknown as null, now, 5000);
    }
    // Must be bounded — not unbounded growth
    expect((capacityCache as any)._size()).toBeLessThanOrEqual(512);
    expect((capacityCache as any)._size()).toBeGreaterThan(0);
  });

  it('cached null is distinguishable from miss (negative cache semantics on runtime)', () => {
    const now = 2000;
    // Simulate resolver negative-cache of runtime "no row yet"
    runtimeCache.set('runtime', null as unknown as null, now, 5000);
    const hit = runtimeCache.get('runtime', now + 100) as unknown;
    expect(hit).toBe(null);
    // Distinct from undefined (miss)
    runtimeCache.invalidate('runtime');
    expect(runtimeCache.get('runtime', now + 100)).toBeUndefined();
  });

  it('expired entries are not returned (TTL expiry)', () => {
    const t0 = 5000;
    capacityCache.set('EMAIL:default', { v: 1 } as unknown as null, t0, 5000);
    expect(capacityCache.get('EMAIL:default', t0 + 4999)).toBeDefined();
    expect(capacityCache.get('EMAIL:default', t0 + 6000)).toBeUndefined();
  });

  it('invalidate(key) only drops that key; invalidate() clears all', () => {
    capacityCache.set('EMAIL:default', { a: 1 } as unknown as null, 10_000, 5000);
    capacityCache.set('SMS:default', { a: 2 } as unknown as null, 10_000, 5000);
    capacityCache.invalidate('EMAIL:default');
    expect(capacityCache.get('EMAIL:default', 10_100)).toBeUndefined();
    expect(capacityCache.get('SMS:default', 10_100)).toBeDefined();
    capacityCache.invalidate();
    expect(capacityCache.get('SMS:default', 10_100)).toBeUndefined();
  });

  it('sweepExpired prevents gradual growth from expired entries left behind by churn', () => {
    const t0 = 100_000;
    // Fill near capacity with short-lived entries, then let them expire and add one more
    for (let i = 0; i < 510; i++) {
      capacityCache.set(`k:${i}`, { v: i } as unknown as null, t0, 1000);
    }
    expect((capacityCache as any)._size()).toBe(510);
    // After TTL, adding a new key should sweep expired and stay bounded
    capacityCache.set('k:new', { v: 999 } as unknown as null, t0 + 2000, 5000);
    // Expired 510 should have been swept before eviction logic
    expect((capacityCache as any)._size()).toBeLessThanOrEqual(10);
  });
});
