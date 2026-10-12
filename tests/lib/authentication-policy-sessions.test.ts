// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JWT } from 'next-auth/jwt';
import prisma from '@/lib/prisma';
import { getAuthOptions, resetAuthOptionsCache } from '@/lib/auth';
import { resetOidcConfigCache } from '@/lib/oidc-config';

vi.mock('@/lib/oidc-validation', () => ({ getValidatedOidcRuntimeMetadata: vi.fn() }));
const optionalPolicy = {
  id: 'default',
  mode: 'SSO_OPTIONAL',
  version: 1,
  legacyEmergencyEmail: null,
};

async function evaluate(
  token: JWT,
  update?: { activity?: boolean; extendSession?: boolean; profileRefresh?: boolean }
) {
  const options = await getAuthOptions();
  return options.callbacks!.jwt!({
    token,
    user: undefined as never,
    account: null,
    ...(update ? { trigger: 'update' as const, session: update } : {}),
  });
}

const passwordToken = (): JWT => ({
  sub: 'admin-1',
  email: 'admin@example.com',
  role: 'ADMIN',
  tokenVersion: 0,
  authProvider: 'credentials',
  authenticationPolicyVersion: 1,
  sessionExpiresAt: Math.floor(Date.now() / 1000) + 86400,
  absoluteExpiresAt: Math.floor(Date.now() / 1000) + 86400,
});

describe('policy changes re-evaluate existing authenticated sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthOptionsCache();
    resetOidcConfigCache();
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue(optionalPolicy as never);
    vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'admin-1',
      status: 'ACTIVE',
      role: 'ADMIN',
      tokenVersion: 0,
    } as never);
  });

  it('revokes a password session on its next evaluation, even with warm auth options and projection caches', async () => {
    const original = passwordToken();
    expect((await evaluate({ ...original })).sub).toBe('admin-1');
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue({
      ...optionalPolicy,
      mode: 'SSO_REQUIRED',
      version: 2,
    } as never);
    const revoked = await evaluate({ ...original });
    expect(revoked.sub).toBeUndefined();
    expect(revoked.error).toBe('AUTHENTICATION_POLICY_DENIED');
  });

  it('revokes legacy tokens without method indicators under SSO Required', async () => {
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue({
      ...optionalPolicy,
      mode: 'SSO_REQUIRED',
      version: 2,
    } as never);
    const legacy = passwordToken();
    delete legacy.authProvider;
    expect((await evaluate(legacy)).sub).toBeUndefined();
  });

  it('fails protected requests closed during an outage but preserves the cookie for recovery', async () => {
    await getAuthOptions();
    vi.mocked(prisma.authenticationPolicy.findUnique).mockRejectedValueOnce(
      new Error('database down')
    );
    const token = await evaluate(passwordToken());
    expect(token.sub).toBe('admin-1');
    expect(token.error).toBe('AUTHENTICATION_POLICY_UNAVAILABLE');
    const options = await getAuthOptions();
    const session = await options.callbacks!.session!({
      session: {
        user: { id: 'admin-1', email: 'admin@example.com' },
        expires: new Date().toISOString(),
      },
      token,
      user: { id: 'admin-1', email: 'admin@example.com', emailVerified: null },
      newSession: undefined,
      trigger: 'update',
    });
    expect(session.user).toBeUndefined();
    const recovered = await evaluate(token);
    expect(recovered.error).toBeUndefined();
  });

  it('does not let activity updates revive an idle emergency-password session', async () => {
    const token: JWT = {
      ...passwordToken(),
      authProvider: 'legacy-emergency',
      authenticatedAt: Date.now() - 1200000,
      lastActivityAt: Date.now() - 901000,
    };
    const result = await evaluate(token, { activity: true, extendSession: true });
    expect(result.sub).toBeUndefined();
    expect(result.error).toBe('EMERGENCY_SESSION_EXPIRED');
  });

  it('does not let a profile refresh replace the security version of a revoked cookie', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'admin-1',
      status: 'ACTIVE',
      role: 'ADMIN',
      tokenVersion: 1,
    } as never);
    const result = await evaluate(passwordToken(), { profileRefresh: true });
    expect(result.sub).toBeUndefined();
    expect(result.error).toBe('SESSION_REVOKED');
  });

  it('caps emergency-password sessions at one hour despite a trusted-device extension request', async () => {
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue({
      ...optionalPolicy,
      legacyEmergencyEmail: 'admin@example.com',
      mode: 'SSO_REQUIRED',
    } as never);
    const started = Date.now() - 300000;
    const token: JWT = {
      ...passwordToken(),
      authProvider: 'legacy-emergency',
      authenticatedAt: started,
      lastActivityAt: Date.now(),
      rememberMe: true,
    };
    const result = await evaluate(token, { activity: true, extendSession: true });
    expect(result.sub).toBe('admin-1');
    expect(result.rememberMe).toBe(false);
    expect(result.absoluteExpiresAt).toBe(Math.floor(started / 1000) + 3600);
    expect(Number(result.sessionExpiresAt)).toBeLessThanOrEqual(Number(result.absoluteExpiresAt));
  });
});
