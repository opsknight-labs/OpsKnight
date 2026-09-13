// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { customJwtDecode, customJwtEncode } from '@/lib/auth-jwt-encoder';

describe('auth JWT session identity', () => {
  const secret = 'test-only-session-identity-secret-with-sufficient-length';

  it('preserves jti across refresh/re-encode cycles', async () => {
    const first = await customJwtEncode({
      token: { sub: 'user-1', sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600 },
      secret,
      maxAge: 3600,
    });
    const decodedFirst = await customJwtDecode({ token: first, secret });
    expect(decodedFirst?.jti).toBeTruthy();

    const second = await customJwtEncode({
      token: decodedFirst ?? {},
      secret,
      maxAge: 3600,
    });
    const decodedSecond = await customJwtDecode({ token: second, secret });

    expect(decodedSecond?.jti).toBe(decodedFirst?.jti);
  });

  it('refuses to preserve malformed or oversized session identifiers', async () => {
    const encoded = await customJwtEncode({
      token: {
        sub: 'user-1',
        jti: 'x',
        sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
      maxAge: 3600,
    });
    const decoded = await customJwtDecode({ token: encoded, secret });

    expect(decoded?.jti).toBeTruthy();
    expect(decoded?.jti).not.toBe('x');
  });
});
