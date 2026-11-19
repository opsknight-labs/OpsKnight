import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { classifyTeamsError, operationRetryDelayMs } from '@/lib/microsoft-teams/delivery';
import { preSendNetworkErrorCode } from '@/lib/microsoft-teams/client';
import { AppError } from '@/lib/errors';

const providerError = (userMessage: string, failureCode: string) =>
  new AppError({
    code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
    userMessage,
    details: { provider: 'microsoftTeams', failureCode },
  });

describe('Teams error classification', () => {
  it('treats a deleted channel / removed bot as terminal via the failure code', () => {
    expect(
      classifyTeamsError(providerError('Teams channel not found', 'CHANNEL_NOT_FOUND')).terminal
    ).toBe(true);
    expect(classifyTeamsError(providerError('Bot was removed', 'APP_NOT_INSTALLED')).terminal).toBe(
      true
    );
  });

  it('does not fail terminally just because provider text says "invalid"', () => {
    expect(classifyTeamsError(providerError('invalid gateway response', 'UNKNOWN')).terminal).toBe(
      false
    );
    expect(classifyTeamsError(new Error('upstream returned invalid json')).terminal).toBe(false);
  });

  it('keeps a corrupt operation payload terminal', () => {
    expect(classifyTeamsError(new Error('Teams operation payload is invalid')).terminal).toBe(true);
  });
});

describe('Teams retry backoff', () => {
  it('grows exponentially and is capped', () => {
    const base = (attempts: number) => operationRetryDelayMs(new Error('boom'), attempts);
    expect(base(1)).toBeLessThanOrEqual(36_000);
    expect(base(4)).toBeGreaterThanOrEqual(0.8 * 240_000);
    expect(base(20)).toBeLessThanOrEqual(1.2 * 30 * 60_000);
  });
});

describe('Teams pre-send network errors', () => {
  const fetchFailed = (cause: unknown) => Object.assign(new TypeError('fetch failed'), { cause });

  it('recognises connect-phase failures that prove nothing was sent', () => {
    expect(preSendNetworkErrorCode(fetchFailed({ code: 'ENOTFOUND' }))).toBe('ENOTFOUND');
    expect(
      preSendNetworkErrorCode(
        fetchFailed({ errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] })
      )
    ).toBe('ECONNREFUSED');
  });

  it('keeps mid-request failures ambiguous', () => {
    expect(preSendNetworkErrorCode(fetchFailed({ code: 'ECONNRESET' }))).toBeNull();
    expect(preSendNetworkErrorCode(new DOMException('timeout', 'TimeoutError'))).toBeNull();
  });
});
