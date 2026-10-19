// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMERGENCY_FRESH_AUTHENTICATION_MAX_AGE_MS,
  FRESH_AUTHENTICATION_MAX_AGE_MS,
  getControlActor,
  isAuthenticationFresh,
} from '@/lib/auth-control/actor';
import { getEmergencySession } from '@/lib/auth-control/emergency';
import { getServerSession } from 'next-auth';
import { CAPABILITIES } from '@/lib/authorization';
import { getUserPermissions } from '@/lib/rbac';
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'stale-emergency-cookie' }) })),
}));
vi.mock('@/lib/auth-control/emergency', () => ({
  EMERGENCY_COOKIE: 'opsknight-emergency',
  getEmergencySession: vi.fn(),
  digest: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getUserPermissions: vi.fn() }));
describe('independent normal administrator fallback', () => {
  beforeEach(() => {
    vi.mocked(getEmergencySession).mockResolvedValue(null);
    vi.mocked(getUserPermissions).mockResolvedValue({
      capabilities: [CAPABILITIES.ADMIN_MANAGE],
    } as never);
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'separately-authenticated-admin', tokenVersion: 1 },
      authenticatedAt: Date.now(),
      authenticationMethod: 'oidc',
      issuedUnderPolicyVersion: 3,
    });
  });
  it('ignores an invalid recovery cookie when normal administrator authority is valid', async () => {
    expect(await getControlActor()).toMatchObject({
      kind: 'admin',
      id: 'separately-authenticated-admin',
      method: 'oidc',
    });
  });
  it('does not grant administrator authority just because a stale recovery cookie exists', async () => {
    vi.mocked(getUserPermissions).mockResolvedValue({ capabilities: [] } as never);
    await expect(getControlActor()).rejects.toThrow('Administrator access required');
  });
});

describe('sensitive administration freshness policy', () => {
  const now = Date.parse('2026-10-15T12:00:00.000Z');
  beforeEach(() => {
    vi.mocked(getEmergencySession).mockResolvedValue(null);
    vi.mocked(getUserPermissions).mockResolvedValue({
      capabilities: [CAPABILITIES.ADMIN_MANAGE],
    } as never);
  });
  it('keeps the two-hour administrator window as product policy', () => {
    expect(FRESH_AUTHENTICATION_MAX_AGE_MS).toBe(2 * 60 * 60 * 1000);
  });
  it('accepts an administrator sign-in up to exactly two hours old and rejects it afterwards', () => {
    expect(isAuthenticationFresh(now - FRESH_AUTHENTICATION_MAX_AGE_MS + 1, 'admin', now)).toBe(
      true
    );
    expect(isAuthenticationFresh(now - FRESH_AUTHENTICATION_MAX_AGE_MS, 'admin', now)).toBe(true);
    expect(isAuthenticationFresh(now - FRESH_AUTHENTICATION_MAX_AGE_MS - 1, 'admin', now)).toBe(
      false
    );
  });
  it('does not extend emergency recovery step-up to the administrator window', () => {
    expect(EMERGENCY_FRESH_AUTHENTICATION_MAX_AGE_MS).toBe(5 * 60 * 1000);
    expect(isAuthenticationFresh(now - 6 * 60 * 1000, 'emergency', now)).toBe(false);
    expect(isAuthenticationFresh(now - 6 * 60 * 1000, 'legacy', now)).toBe(false);
    expect(isAuthenticationFresh(now - 4 * 60 * 1000, 'emergency', now)).toBe(true);
  });
  it('rejects missing, invalid and future-dated authentication times', () => {
    expect(isAuthenticationFresh(undefined, 'admin', now)).toBe(false);
    expect(isAuthenticationFresh(0, 'admin', now)).toBe(false);
    expect(isAuthenticationFresh(Number.NaN, 'admin', now)).toBe(false);
    expect(isAuthenticationFresh(now + 60_000, 'admin', now)).toBe(false);
    expect(isAuthenticationFresh(now + 10_000, 'admin', now)).toBe(true); // clock skew allowance
  });
  it('enforces the window when a fresh actor is requested', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'stale-admin', tokenVersion: 1 },
      authenticatedAt: Date.now() - FRESH_AUTHENTICATION_MAX_AGE_MS - 60_000,
      authenticationMethod: 'oidc',
    });
    await expect(getControlActor(true)).rejects.toThrow('Sign in again');
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'recent-admin', tokenVersion: 1 },
      authenticatedAt: Date.now() - 90 * 60 * 1000,
      authenticationMethod: 'oidc',
    });
    await expect(getControlActor(true)).resolves.toMatchObject({ id: 'recent-admin' });
  });
});
