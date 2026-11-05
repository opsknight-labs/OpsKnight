import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capabilitiesWiden,
  mcpPolicyWidening,
  type McpPolicyAccess,
} from '@/lib/mcp/auth/policy-widening';

const session = vi.hoisted(() => ({ value: null as unknown, throws: false }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => {
    if (session.throws) throw new Error('no request scope');
    return session.value;
  }),
}));
const { requireFreshMcpAdmin } = await import('@/lib/mcp/auth/fresh-admin');

const base: McpPolicyAccess = {
  enabled: true,
  writesEnabled: false,
  sensitiveReadsEnabled: false,
  dcrEnabled: true,
  cimdEnabled: true,
  dcrScopes: ['incidents:read'],
  cimdScopes: ['incidents:read'],
  cimdAllowedHosts: ['claude.ai'],
  allowedBrowserOrigins: [],
  requestsPerMinute: 60,
  maxInFlight: 4,
  maxOperations: 8,
  sessionIdleDays: 30,
  approvalTtlMinutes: 240,
  approvalCommitWindowMinutes: 30,
};

describe('mcpPolicyWidening', () => {
  it('names each change that gives assistants more access', () => {
    expect(mcpPolicyWidening(base, base)).toEqual([]);
    expect(mcpPolicyWidening({ ...base, enabled: false }, base)).toEqual(['enabled']);
    expect(mcpPolicyWidening(base, { ...base, writesEnabled: true })).toEqual(['writesEnabled']);
    expect(mcpPolicyWidening(base, { ...base, maxOperations: 9 })).toEqual(['maxOperations']);
    expect(
      mcpPolicyWidening(base, { ...base, dcrScopes: ['incidents:read', 'services:read'] })
    ).toEqual(['dcrScopes']);
    expect(
      mcpPolicyWidening(base, { ...base, allowedBrowserOrigins: ['http://localhost:6274'] })
    ).toEqual(['allowedBrowserOrigins']);
  });

  it('treats emptying the trusted-host list, or adding a host while CIMD is on, as widening', () => {
    expect(mcpPolicyWidening(base, { ...base, cimdAllowedHosts: [] })).toEqual([
      'cimdAllowedHosts',
    ]);
    expect(
      mcpPolicyWidening(base, { ...base, cimdAllowedHosts: ['claude.ai', 'evil.example'] })
    ).toEqual(['cimdAllowedHosts']);
    // Going from "any host" to a list narrows.
    expect(
      mcpPolicyWidening({ ...base, cimdAllowedHosts: [] }, { ...base, cimdAllowedHosts: ['x.io'] })
    ).toEqual([]);
  });

  it('lets every narrowing through', () => {
    const wide = {
      ...base,
      writesEnabled: true,
      sensitiveReadsEnabled: true,
      dcrScopes: ['incidents:read', 'services:read'],
      allowedBrowserOrigins: ['http://localhost:6274'],
      requestsPerMinute: 600,
    };
    expect(mcpPolicyWidening(wide, base)).toEqual([]);
    expect(mcpPolicyWidening(base, { ...base, enabled: false, dcrEnabled: false })).toEqual([]);
  });

  it('flags re-exposing a disabled capability only', () => {
    expect(capabilitiesWiden(['domain:incidents'], [])).toBe(true);
    expect(capabilitiesWiden([], ['domain:incidents'])).toBe(false);
    expect(capabilitiesWiden(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('requireFreshMcpAdmin', () => {
  beforeEach(() => {
    session.throws = false;
  });

  it('needs the same person signed in within the admin window', async () => {
    session.value = { user: { id: 'admin-1' }, authenticatedAt: Date.now() - 60_000 };
    expect(await requireFreshMcpAdmin('admin-1')).toBe(true);
    expect(await requireFreshMcpAdmin('admin-2')).toBe(false);
    session.value = { user: { id: 'admin-1' }, authenticatedAt: Date.now() - 3 * 3600_000 };
    expect(await requireFreshMcpAdmin('admin-1')).toBe(false);
    session.value = { user: { id: 'admin-1' } };
    expect(await requireFreshMcpAdmin('admin-1')).toBe(false);
  });

  it('is never fresh without a readable session', async () => {
    session.value = null;
    expect(await requireFreshMcpAdmin('admin-1')).toBe(false);
    session.throws = true;
    expect(await requireFreshMcpAdmin('admin-1')).toBe(false);
  });
});
