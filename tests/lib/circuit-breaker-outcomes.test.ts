import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerTimeoutError } from '@/lib/circuit-breaker';

describe('circuit breaker provider outcomes', () => {
  afterEach(() => vi.useRealTimers());

  it('counts resolved provider failures instead of resetting the circuit', async () => {
    const breaker = new CircuitBreaker({
      name: 'resolved-failure',
      failureThreshold: 2,
      resetTimeout: 60_000,
      successThreshold: 1,
      timeout: 1_000,
    });

    await breaker.execute(async () => ({ success: false, error: 'provider unavailable' }));
    await breaker.execute(async () => ({ success: false, error: 'provider unavailable' }));

    expect(breaker.getState()).toBe('OPEN');
    await expect(breaker.execute(async () => ({ success: true }))).rejects.toThrow(/OPEN/);
  });

  it('classifies a local timeout as an ambiguous external mutation', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      name: 'slow-provider',
      failureThreshold: 1,
      resetTimeout: 60_000,
      successThreshold: 1,
      timeout: 100,
    });
    const operation = breaker.execute(() => new Promise<{ success: true }>(() => undefined));
    const rejection = expect(operation).rejects.toBeInstanceOf(CircuitBreakerTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(breaker.getState()).toBe('OPEN');
  });
});
