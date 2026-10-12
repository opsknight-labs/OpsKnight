// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import {
  evaluateAuthenticationPolicy,
  type AuthenticationMode,
} from '@/lib/authentication-policy-evaluator';
import {
  assertPasswordOperationAllowed,
  getAuthenticationPolicy,
  checkAuthenticationPolicy,
} from '@/lib/authentication-policy';

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const policy = {
  id: 'default',
  mode: 'SSO_OPTIONAL' as const,
  version: 3,
  legacyEmergencyEmail: null,
};

describe('central authentication policy', () => {
  it('restricts password recovery to a stable User ID and expires it on session rechecks', () => {
    const state = {
      ...policy,
      mode: 'SSO_REQUIRED' as const,
      passwordRecoveryUserId: 'original-admin',
      passwordRecoveryExpiresAt: new Date(Date.now() + 60000),
    };
    expect(
      evaluateAuthenticationPolicy(state, 'PASSWORD_LOGIN', { id: 'original-admin' }).allowed
    ).toBe(true);
    expect(
      evaluateAuthenticationPolicy(state, 'PASSWORD_LOGIN', { id: 'another-user' }).allowed
    ).toBe(false);
    expect(
      evaluateAuthenticationPolicy(
        state,
        'SESSION',
        { id: 'original-admin' },
        { method: 'credentials', policyVersion: 3 }
      ).allowed
    ).toBe(true);
    expect(
      evaluateAuthenticationPolicy(
        state,
        'SESSION',
        { id: 'another-user' },
        { method: 'credentials', policyVersion: 3 }
      ).allowed
    ).toBe(false);
    expect(
      evaluateAuthenticationPolicy(state, 'SESSION', {}, { method: 'oidc', policyVersion: 3 })
        .allowed
    ).toBe(true);
    expect(
      evaluateAuthenticationPolicy(
        { ...state, passwordRecoveryExpiresAt: new Date(0) },
        'SESSION',
        { id: 'original-admin' },
        { method: 'credentials', policyVersion: 3 }
      ).allowed
    ).toBe(false);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue(policy as never);
    vi.mocked(prisma.authenticationPolicyImport.findUnique).mockResolvedValue(null);
  });

  it.each([
    ['PASSWORD_ONLY', true, false],
    ['SSO_OPTIONAL', true, true],
    ['SSO_REQUIRED', false, true],
  ] as const)(
    '%s enforces new login, password writes and existing sessions',
    (mode, password, oidc) => {
      const state = { ...policy, mode };
      expect(evaluateAuthenticationPolicy(state, 'PASSWORD_LOGIN').allowed).toBe(password);
      expect(evaluateAuthenticationPolicy(state, 'PASSWORD_WRITE').allowed).toBe(password);
      expect(evaluateAuthenticationPolicy(state, 'OIDC_LOGIN').allowed).toBe(oidc);
      expect(
        evaluateAuthenticationPolicy(
          state,
          'SESSION',
          {},
          { method: 'credentials', policyVersion: 1 }
        ).allowed
      ).toBe(password);
      expect(
        evaluateAuthenticationPolicy(state, 'SESSION', {}, { method: 'oidc', policyVersion: 1 })
          .allowed
      ).toBe(oidc);
      expect(evaluateAuthenticationPolicy(state, 'SESSION').allowed).toBe(password);
    }
  );

  it('preserves only the explicitly imported emergency identity; never authorizes password reset', () => {
    const state = {
      ...policy,
      mode: 'SSO_REQUIRED' as const,
      legacyEmergencyEmail: 'recovery@example.com',
    };
    const principal = { email: ' Recovery@Example.com ' };
    expect(evaluateAuthenticationPolicy(state, 'PASSWORD_LOGIN', principal).allowed).toBe(true);
    expect(evaluateAuthenticationPolicy(state, 'PASSWORD_WRITE', principal).allowed).toBe(false);
    expect(
      evaluateAuthenticationPolicy(state, 'SESSION', principal, { method: 'credentials' }).allowed
    ).toBe(false);
    expect(
      evaluateAuthenticationPolicy(state, 'SESSION', principal, { method: 'legacy-emergency' })
        .allowed
    ).toBe(true);
    expect(
      evaluateAuthenticationPolicy(
        state,
        'SESSION',
        { email: 'attacker@example.com' },
        { method: 'legacy-emergency' }
      ).allowed
    ).toBe(false);
  });

  it('fails closed for corrupt policies and impossible session versions', () => {
    for (const version of [0, -1, NaN, Infinity, 1.5]) {
      expect(evaluateAuthenticationPolicy({ ...policy, version }, 'PASSWORD_LOGIN').allowed).toBe(
        false
      );
    }
    expect(
      evaluateAuthenticationPolicy(
        { ...policy, mode: 'invalid' as AuthenticationMode },
        'PASSWORD_LOGIN'
      ).allowed
    ).toBe(false);
    expect(
      evaluateAuthenticationPolicy(
        policy,
        'SESSION',
        {},
        { method: 'credentials', policyVersion: 4 }
      ).allowed
    ).toBe(false);
  });

  it('reads authoritative state on every decision without a process cache', async () => {
    expect((await checkAuthenticationPolicy('SESSION')).allowed).toBe(true);
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue({
      ...policy,
      mode: 'SSO_REQUIRED',
      version: 4,
    } as never);
    expect((await checkAuthenticationPolicy('SESSION')).allowed).toBe(false);
    expect(prisma.authenticationPolicy.findUnique).toHaveBeenCalledTimes(2);
  });

  it('keeps old methods revoked when the policy is relaxed and rejects corrupt cutoffs', () => {
    const state = { ...policy, passwordSessionMinVersion: 2, oidcSessionMinVersion: 2 };
    for (const method of ['credentials', 'oidc'] as const) {
      expect(
        evaluateAuthenticationPolicy(state, 'SESSION', {}, { method, policyVersion: 1 }).reason
      ).toBe('SESSION_REVOKED_BY_POLICY');
      expect(
        evaluateAuthenticationPolicy(state, 'SESSION', {}, { method, policyVersion: 3 }).allowed
      ).toBe(true);
    }
    expect(evaluateAuthenticationPolicy(state, 'SESSION').allowed).toBe(false);
    expect(
      evaluateAuthenticationPolicy({ ...state, passwordSessionMinVersion: NaN }, 'PASSWORD_LOGIN')
        .allowed
    ).toBe(false);
    expect(
      evaluateAuthenticationPolicy({ ...state, oidcSessionMinVersion: 4 }, 'PASSWORD_LOGIN').allowed
    ).toBe(false);
  });

  it('never falls back to environment authentication during a database outage', async () => {
    vi.mocked(prisma.authenticationPolicy.findUnique).mockRejectedValueOnce(
      new Error('database unavailable')
    );
    await expect(checkAuthenticationPolicy('PASSWORD_LOGIN')).rejects.toThrow(
      'database unavailable'
    );
    expect(prisma.authenticationPolicy.create).not.toHaveBeenCalled();
  });

  it('does not reimport environment settings after a migrated policy disappears', async () => {
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.authenticationPolicyImport.findUnique).mockResolvedValue({
      id: 'default',
      importedAt: new Date(),
    });
    await expect(getAuthenticationPolicy()).rejects.toThrow('environment fallback is prohibited');
    expect(prisma.authenticationPolicy.create).not.toHaveBeenCalled();
  });

  it('preserves ordinary administrator password access when Optional has break-glass variables', async () => {
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', 'true');
    vi.stubEnv('AUTH_BREAK_GLASS_ENABLED', 'true');
    vi.stubEnv('AUTH_BREAK_GLASS_EMAIL', 'Recovery@Example.com');
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcConfig.findUnique).mockResolvedValue({
      enabled: true,
      configVersion: 7,
    } as never);
    vi.mocked(prisma.authenticationPolicy.create).mockResolvedValue({
      ...policy,
      version: 1,
    } as never);
    try {
      await getAuthenticationPolicy();
      expect(prisma.authenticationPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mode: 'SSO_OPTIONAL',
            legacyEmergencyEmail: null,
            passwordSessionMinVersion: 0,
          }),
        })
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('preserves an Optional password session even when an earlier import stored the break-glass email', () => {
    const state = { ...policy, legacyEmergencyEmail: 'admin@example.com' };
    expect(
      evaluateAuthenticationPolicy(state, 'PASSWORD_LOGIN', { email: 'admin@example.com' }).allowed
    ).toBe(true);
    expect(
      evaluateAuthenticationPolicy(
        state,
        'SESSION',
        { email: 'admin@example.com' },
        { method: 'credentials', policyVersion: 1 }
      ).allowed
    ).toBe(true);
  });
  it('imports legacy controls atomically exactly once without converting a user', async () => {
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', 'false');
    vi.stubEnv('AUTH_BREAK_GLASS_ENABLED', 'true');
    vi.stubEnv('AUTH_BREAK_GLASS_EMAIL', 'Recovery@Example.com');
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcConfig.findUnique).mockResolvedValue({
      enabled: true,
      configVersion: 7,
    } as never);
    vi.mocked(prisma.authenticationPolicy.create).mockResolvedValue({
      ...policy,
      mode: 'SSO_REQUIRED',
      version: 1,
      legacyEmergencyEmail: 'recovery@example.com',
    } as never);
    try {
      expect((await getAuthenticationPolicy()).mode).toBe('SSO_REQUIRED');
      expect(prisma.authenticationPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mode: 'SSO_REQUIRED',
            oidcConfigVersion: 7,
            legacyEmergencyEmail: 'recovery@example.com',
          }),
        })
      );
      expect(prisma.authenticationPolicyImport.create).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps a fresh zero-user installation bootstrappable even with deprecated SSO-only environment settings', async () => {
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', 'false');
    vi.stubEnv('AUTH_BREAK_GLASS_ENABLED', 'true');
    vi.stubEnv('AUTH_BREAK_GLASS_EMAIL', 'first-admin@example.test');
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    vi.mocked(prisma.authenticationPolicy.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.authenticationPolicy.create).mockResolvedValue({
      ...policy,
      mode: 'PASSWORD_ONLY',
      version: 1,
    } as never);
    try {
      expect((await getAuthenticationPolicy()).mode).toBe('PASSWORD_ONLY');
      expect(prisma.authenticationPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mode: 'PASSWORD_ONLY',
            passwordSessionMinVersion: 0,
            legacyEmergencyEmail: null,
            enforcedAt: null,
            legacySnapshot: expect.objectContaining({ bootstrap: true }),
          }),
        })
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('locks the authoritative row before password mutation and denies SSO Required', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ ...policy, mode: 'SSO_REQUIRED' }]);
    await expect(assertPasswordOperationAllowed(prisma)).rejects.toThrow(
      'disabled by authentication policy'
    );
    const query = vi.mocked(prisma.$queryRaw).mock.calls[0][0];
    expect(String(query)).toContain('FOR UPDATE');
  });
});
