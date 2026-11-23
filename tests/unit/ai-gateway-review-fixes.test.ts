import { describe, expect, it } from 'vitest';
import { APICallError, RetryError } from 'ai';
import {
  isProviderFault,
  PROPOSAL_ACKNOWLEDGEMENT,
  runWithDeadline,
  stepInputEstimate,
  ToolDeadlineError,
} from '@/lib/intelligence/ai/gateway';
import { ProviderBreakers, type SharedBreakerStore } from '@/lib/intelligence/ai/breaker';

const apiError = (statusCode?: number) =>
  new APICallError({
    message: 'upstream',
    url: 'https://api.example.com',
    requestBodyValues: {},
    statusCode,
  });

describe('provider fault classification', () => {
  it('trips the breaker for server errors, rate limits, rejected keys and network failures', () => {
    for (const status of [500, 503, 429, 401, 403, undefined])
      expect(isProviderFault(apiError(status), false)).toBe(true);
    expect(
      isProviderFault(
        new RetryError({ message: 'x', reason: 'maxRetriesExceeded', errors: [apiError(502)] }),
        false
      )
    ).toBe(true);
  });

  it('never trips it for a missing model or a malformed request (one route, not the provider)', () => {
    for (const status of [400, 404, 413, 422])
      expect(isProviderFault(apiError(status), false)).toBe(false);
  });

  it('counts our own timer only while nothing had come back', () => {
    const timeout = new DOMException('Step timeout', 'TimeoutError');
    expect(isProviderFault(timeout, false)).toBe(true);
    expect(isProviderFault(timeout, true)).toBe(false);
    // Our own code failing says nothing about the provider.
    expect(isProviderFault(new TypeError('bug'), false)).toBe(false);
  });
});

describe('per-step hold estimate', () => {
  it('charges the cached previous prompt at the cache-read weight', () => {
    expect(stepInputEstimate(10_000, 8_000, false)).toBe(10_000);
    expect(stepInputEstimate(10_000, 8_000, true)).toBe(10_000 - Math.round(8_000 * 0.9));
    // Never below zero, never discounting more than was sent.
    expect(stepInputEstimate(1_000, 8_000, true)).toBe(100);
  });
});

describe('tool deadline with a per-call signal', () => {
  it('aborts the call signal at the deadline so a late result can be discarded', async () => {
    let seen: AbortSignal | undefined;
    let finish: () => void = () => undefined;
    const run = runWithDeadline(
      signal => {
        seen = signal;
        return new Promise<string>(resolve => (finish = () => resolve('late')));
      },
      undefined,
      20
    );
    await expect(run).rejects.toBeInstanceOf(ToolDeadlineError);
    expect(seen?.aborted).toBe(true);
    finish();
  });

  it('passes the SDK signal through', async () => {
    const parent = new AbortController();
    let seen: AbortSignal | undefined;
    const run = runWithDeadline(signal => {
      seen = signal;
      return Promise.resolve('ok');
    }, parent.signal);
    expect(await run).toBe('ok');
    parent.abort();
    expect(seen?.aborted).toBe(true);
  });

  it('does not tell the model a proposal was shown', () => {
    expect(PROPOSAL_ACKNOWLEDGEMENT).not.toMatch(/^Shown/);
    expect(PROPOSAL_ACKNOWLEDGEMENT).toContain('if it is still valid');
  });
});

describe('shared breaker readings', () => {
  const store = (shared: { failures: number; openUntil: number } | null) => {
    const saves: unknown[] = [];
    const value: SharedBreakerStore = {
      load: async () => shared,
      save: async (_id, state) => {
        saves.push(state);
      },
    };
    return { value, saves };
  };

  it('does not write on every success, only when the state changes', () => {
    let now = 1_000;
    const { value, saves } = store(null);
    const breakers = new ProviderBreakers(
      { failureThreshold: 2, openMs: 30_000 },
      () => now,
      value
    );
    breakers.recordSuccess('p');
    breakers.recordSuccess('p');
    expect(saves).toHaveLength(0);
    breakers.recordFailure('p');
    now += 1;
    breakers.recordSuccess('p');
    expect(saves).toHaveLength(2);
  });

  it('ignores a shared open reading older than this replica’s last success', async () => {
    let now = 100_000;
    // Another replica opened it at t=90s (openUntil = 90s + 30s).
    const { value } = store({ failures: 3, openUntil: 120_000 });
    const breakers = new ProviderBreakers(
      { failureThreshold: 3, openMs: 30_000 },
      () => now,
      value
    );
    breakers.recordSuccess('p');
    await breakers.sync(['p']);
    expect(breakers.isOpen('p')).toBe(false);

    // A reading opened after the local success is adopted.
    now = 200_000;
    const fresh = store({ failures: 3, openUntil: 235_000 });
    const other = new ProviderBreakers(
      { failureThreshold: 3, openMs: 30_000 },
      () => now,
      fresh.value
    );
    other.recordSuccess('p');
    now = 206_000;
    await other.sync(['p']);
    expect(other.isOpen('p')).toBe(true);
  });
});
