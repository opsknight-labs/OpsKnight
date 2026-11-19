// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLoginAttempt, recordFailedAttempt } from '@/lib/login-security';

const fail = (email: string, n: number) => {
  let last = recordFailedAttempt(email, '1.2.3.4');
  for (let i = 1; i < n; i++) last = recordFailedAttempt(email, '1.2.3.4');
  return last;
};

describe('login-security progressive lockout', () => {
  afterEach(() => vi.useRealTimers());

  it('unlocks after the 1 minute lockout and escalates to 5 minutes next time', () => {
    vi.useFakeTimers();
    const email = 'lockout@example.com';
    const first = fail(email, 5);
    expect(first.locked).toBe(true);
    expect(first.lockoutDurationMs).toBe(60_000);
    expect(checkLoginAttempt(email, '1.2.3.4').allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(checkLoginAttempt(email, '1.2.3.4').allowed).toBe(true);

    // A full new round of attempts before the second, longer lockout.
    expect(fail(email, 4).locked).toBe(false);
    const second = recordFailedAttempt(email, '1.2.3.4');
    expect(second.locked).toBe(true);
    expect(second.lockoutDurationMs).toBe(5 * 60_000);
  });
});
