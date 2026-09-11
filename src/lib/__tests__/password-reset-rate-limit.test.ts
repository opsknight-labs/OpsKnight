import { beforeEach, describe, expect, it, vi } from 'vitest';

const consumeAuthRateLimit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth-abuse', () => ({
  consumeAuthRateLimit,
  authPrivacyDigest: vi.fn().mockResolvedValue('a'.repeat(64)),
}));

import { checkRateLimit } from '@/lib/password-reset';

describe('password-reset shared rate-limit contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeAuthRateLimit.mockResolvedValue({ allowed: true });
  });

  it('throws the project AppError contract when throttled', async () => {
    consumeAuthRateLimit
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true });

    await expect(checkRateLimit('user@example.com', '203.0.113.10')).rejects.toMatchObject({
      name: 'AppError',
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
    });
  });

  it('does not turn the invite unknown sentinel into a tenant-wide identifier limit', async () => {
    await expect(checkRateLimit('unknown', '203.0.113.10', 'INVITE_FAILED')).resolves.toBeUndefined();
    expect(consumeAuthRateLimit).toHaveBeenCalledTimes(1);
    expect(consumeAuthRateLimit).toHaveBeenCalledWith(
      'invite_failed:ip',
      '203.0.113.10',
      20,
      15 * 60 * 1000
    );
  });
});
