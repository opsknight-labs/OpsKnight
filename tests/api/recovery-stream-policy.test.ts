// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { evaluateAuthenticationPolicy } from '@/lib/authentication-policy-evaluator';
import { checkAuthenticationPolicy } from '@/lib/authentication-policy';
import { getServerSession } from 'next-auth';
import { GET as notifications } from '@/app/api/notifications/stream/route';
import { GET as sla } from '@/app/api/sla/stream/route';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/authentication-policy', () => ({ checkAuthenticationPolicy: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertCanReadServiceMetrics: vi.fn(),
  getUserPermissions: vi.fn(async () => ({ capabilities: [] })),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/session-registry', () => ({ isSessionActive: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/realtime-stream-authorization', () => ({
  getRequestSessionJti: vi.fn().mockResolvedValue('fixture-jti'),
}));
vi.mock('@/lib/notification-change-clock', () => ({
  getNotificationUserChangeVersion: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'recovered-admin',
        status: 'ACTIVE',
        tokenVersion: 0,
        timeZone: 'UTC',
      }),
    },
    inAppNotification: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    incident: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  },
}));

describe('administrator-only restoration stream authorization', () => {
  let expiresAt: Date;
  beforeEach(() => {
    vi.clearAllMocks();
    expiresAt = new Date(Date.now() + 3600000);
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'recovered-admin', email: 'admin@example.test', tokenVersion: 0 },
      expires: new Date(Date.now() + 3600000).toISOString(),
      authenticationMethod: 'credentials',
      issuedUnderPolicyVersion: 1,
    });
    vi.mocked(checkAuthenticationPolicy).mockImplementation(async (action, principal, session) =>
      evaluateAuthenticationPolicy(
        {
          mode: 'SSO_REQUIRED',
          version: 1,
          legacyEmergencyEmail: null,
          passwordRecoveryUserId: 'recovered-admin',
          passwordRecoveryExpiresAt: expiresAt,
        },
        action,
        principal,
        session
      )
    );
  });
  afterEach(() => vi.useRealTimers());

  it('keeps notification polls authorized for the recovered User ID and closes when the exception expires', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      const response = await notifications(
        new NextRequest('http://localhost/api/notifications/stream', { signal: controller.signal })
      );
      const content = response.text();
      await vi.advanceTimersByTimeAsync(30000);
      expect(checkAuthenticationPolicy).toHaveBeenCalledWith(
        'SESSION',
        { id: 'recovered-admin', email: 'admin@example.test' },
        { method: 'credentials', policyVersion: 1 }
      );
      const decision = await vi.mocked(checkAuthenticationPolicy).mock.results[0].value;
      expect(decision.allowed).toBe(true);
      expiresAt = new Date(Date.now() - 1);
      await vi.advanceTimersByTimeAsync(30000);
      expect(await content).toContain('authorization_revoked');
    } finally {
      controller.abort();
    }
  });

  it('allows the restored administrator SLA stream while Required remains active', async () => {
    const response = await sla(new NextRequest('http://localhost/api/sla/stream'));
    const content = await response.text();
    expect(checkAuthenticationPolicy).toHaveBeenCalledWith(
      'SESSION',
      { id: 'recovered-admin', email: 'admin@example.test' },
      { method: 'credentials', policyVersion: 1 }
    );
    expect(content).not.toContain('authorization_revoked');
  });

  it('does not extend the exception to a different User ID sharing the same email', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'other-user', email: 'admin@example.test', tokenVersion: 0 },
      expires: new Date(Date.now() + 3600000).toISOString(),
      authenticationMethod: 'credentials',
      issuedUnderPolicyVersion: 1,
    });
    const response = await sla(new NextRequest('http://localhost/api/sla/stream'));
    expect(await response.text()).toContain('authorization_revoked');
  });

  it('closes SLA streams after the administrator-only exception expires', async () => {
    expiresAt = new Date(Date.now() - 1);
    const response = await sla(new NextRequest('http://localhost/api/sla/stream'));
    expect(await response.text()).toContain('authorization_revoked');
  });
});
