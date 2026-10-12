// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getControlActor } from '@/lib/auth-control/actor';
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
