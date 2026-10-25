import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  policy: vi.fn(),
  active: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/authentication-policy', () => ({ checkAuthenticationPolicy: mocks.policy }));
vi.mock('@/lib/session-registry', () => ({ isSessionActive: mocks.active }));
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
vi.mock('@/lib/secret-manager', () => ({ getNextAuthSecret: vi.fn() }));
vi.mock('@/lib/auth-cookies', () => ({ SESSION_TOKEN_COOKIE_NAME: 'x', useSecureCookies: false }));
vi.mock('@/lib/auth-jwt-encoder', () => ({ customJwtDecode: vi.fn() }));

import { resolveStreamAuthorizationCoalesced } from '@/lib/realtime-stream-authorization';

describe('stream authorization coalescing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.policy.mockResolvedValue({ allowed: true });
    mocks.active.mockResolvedValue(true);
    mocks.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'ADMIN',
      status: 'ACTIVE',
      tokenVersion: 0,
      teamMemberships: [],
    });
  });

  it('shares one recheck between streams of the same session', async () => {
    const [a, b] = await Promise.all([
      resolveStreamAuthorizationCoalesced('u1', 0, 'jti-same'),
      resolveStreamAuthorizationCoalesced('u1', 0, 'jti-same'),
    ]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });

  it('never shares a result across sessions or users and still fails closed', async () => {
    mocks.active.mockResolvedValueOnce(false);
    const revoked = await resolveStreamAuthorizationCoalesced('u1', 0, 'jti-revoked');
    expect(revoked).toBeNull();
    const other = await resolveStreamAuthorizationCoalesced('u1', 0, 'jti-other');
    expect(other).not.toBeNull();
    await resolveStreamAuthorizationCoalesced('u2', 0, 'jti-other');
    expect(mocks.findUnique).toHaveBeenCalledTimes(3);
    await expect(resolveStreamAuthorizationCoalesced('u1', 0, null)).resolves.toBeNull();
  });
});
