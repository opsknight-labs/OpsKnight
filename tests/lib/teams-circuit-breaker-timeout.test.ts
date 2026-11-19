import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreakers } from '@/lib/circuit-breaker';

describe('Teams circuit breaker timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('lets a slow (20s) Teams create finish instead of timing it out as "circuit open"', async () => {
    vi.useFakeTimers();
    const breaker = CircuitBreakers.microsoftTeams('tenant-timeout-test');
    const slowCreate = () =>
      new Promise<{ success: boolean }>(resolve =>
        setTimeout(() => resolve({ success: true }), 20_000)
      );

    const pending = breaker.execute(slowCreate);
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(pending).resolves.toEqual({ success: true });
  });
});
