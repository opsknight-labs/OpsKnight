// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  LOGIN_LIMITS,
  checkLoginAttempt,
  getAttemptCount,
  recordFailedAttempt,
} from '@/lib/login-security';

const IP = '1.2.3.4';
const MAX_KEYS = 10_000;
const spray = (from: number, to: number) => {
  for (let i = from; i < to; i++) recordFailedAttempt(`spray-${i}@example.com`, IP);
};

describe('login-security attempt store is bounded', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps at most the cap, dropping the oldest keys first', () => {
    spray(0, MAX_KEYS + 200);

    expect(getAttemptCount('spray-0@example.com', IP)).toBe(0);
    expect(getAttemptCount('spray-199@example.com', IP)).toBe(0);
    expect(getAttemptCount(`spray-${MAX_KEYS + 199}@example.com`, IP)).toBe(1);
  });

  it('never evicts a key that is locked out', () => {
    for (let i = 0; i < LOGIN_LIMITS.MAX_ATTEMPTS; i++)
      recordFailedAttempt('victim@example.com', IP);
    spray(100_000, 100_000 + MAX_KEYS + 500);

    expect(checkLoginAttempt('victim@example.com', IP).allowed).toBe(false);
  });

  it('keeps a key that is still failing while a spray of new keys evicts the idle ones', () => {
    const victim = 'part-way@example.com';
    for (let i = 0; i < LOGIN_LIMITS.MAX_ATTEMPTS - 2; i++) recordFailedAttempt(victim, IP);
    spray(300_000, 300_000 + MAX_KEYS - 1_000);
    recordFailedAttempt(victim, IP);
    spray(400_000, 400_000 + 2_500);

    expect(getAttemptCount(victim, IP)).toBe(LOGIN_LIMITS.MAX_ATTEMPTS - 1);
  });

  it('sweeps records past the reset window before evicting live ones', () => {
    vi.useFakeTimers();
    spray(200_000, 200_000 + MAX_KEYS);
    vi.advanceTimersByTime(61 * 60 * 1000);
    // Fresh key at the cap: every stale record goes, not just the oldest one.
    recordFailedAttempt('fresh@example.com', IP);

    expect(getAttemptCount('spray-205000@example.com', IP)).toBe(0);
    expect(getAttemptCount('fresh@example.com', IP)).toBe(1);
  });
});
