// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const registry = vi.hoisted(() => ({
  ensureRegisteredSession: vi.fn(),
  touchSessionActivity: vi.fn(),
}));
vi.mock('@/lib/session-registry', () => registry);

import { customJwtDecode, customJwtEncode } from '@/lib/auth-jwt-encoder';

const secret = 'test-only-registry-unavailable-secret-with-length';

async function cookie() {
  return customJwtEncode({
    token: { sub: 'user-1', sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600 },
    secret,
    maxAge: 3600,
  });
}

describe('customJwtDecode registry outcomes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the session (flagged, unauthorized) when the registry is unavailable', async () => {
    registry.ensureRegisteredSession.mockResolvedValue('unavailable');
    const decoded = await customJwtDecode({ token: await cookie(), secret });
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe('user-1');
    expect(decoded?.error).toBe('SECURITY_LOOKUP_UNAVAILABLE');

    // Re-encoding (Auth.js session refresh) must not persist the transient flag.
    const reencoded = await customJwtEncode({ token: decoded!, secret, maxAge: 3600 });
    registry.ensureRegisteredSession.mockResolvedValue('allowed');
    const recovered = await customJwtDecode({ token: reencoded, secret });
    expect(recovered?.error).toBeUndefined();
    expect(recovered?.jti).toBe(decoded?.jti);
  });

  it('still rejects explicitly revoked sessions', async () => {
    registry.ensureRegisteredSession.mockResolvedValue('denied');
    expect(await customJwtDecode({ token: await cookie(), secret })).toBeNull();
  });
});
