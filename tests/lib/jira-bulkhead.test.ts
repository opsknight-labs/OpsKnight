import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ running: 0, peak: 0 }));
vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      state.running++;
      state.peak = Math.max(state.peak, state.running);
      try {
        return await work({});
      } finally {
        state.running--;
      }
    },
  },
}));
vi.mock('@/lib/db-locks', () => ({
  acquireAdvisoryLock: vi.fn(),
  acquireSharedAdvisoryLock: vi.fn(),
  LOCK_KEYS: {},
}));

import {
  JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS,
  runJiraProviderTransaction,
} from '@/lib/jira-concurrency';

afterEach(() => {
  vi.useRealTimers();
  state.running = 0;
  state.peak = 0;
});

describe('Jira provider bulkhead', () => {
  it('never holds more provider transactions than the limit, and finishes the rest in turn', async () => {
    const releases: Array<() => void> = [];
    const total = JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS + 3;
    const done = Array.from({ length: total }, () =>
      runJiraProviderTransaction(() => new Promise<void>(resolve => releases.push(resolve)))
    );
    await vi.waitFor(() => expect(releases).toHaveLength(JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS));
    expect(state.peak).toBe(JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS);

    while (releases.length) releases.shift()!();
    await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
    for (;;) {
      const next = releases.shift();
      if (!next) break;
      next();
      await Promise.resolve();
    }
    await Promise.all(done);
    expect(state.peak).toBe(JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS);
    expect(state.running).toBe(0);
  });

  it('turns away a caller that waits longer than the fence wait, without leaking a slot', async () => {
    vi.useFakeTimers();
    const holders: Array<() => void> = [];
    const held = Array.from({ length: JIRA_MAX_CONCURRENT_PROVIDER_WORKFLOWS }, () =>
      runJiraProviderTransaction(() => new Promise<void>(resolve => holders.push(resolve)))
    );
    const rejected = runJiraProviderTransaction(async () => 'never');
    const assertion = expect(rejected).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;

    holders.forEach(release => release());
    await Promise.all(held);
    // Every slot is free again: a fresh caller runs immediately.
    await expect(runJiraProviderTransaction(async () => 'ok')).resolves.toBe('ok');
  });
});
