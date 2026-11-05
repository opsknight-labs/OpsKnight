import { randomBytes } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, loadMcpRuntime, mcpResource } from '@/lib/mcp/auth/config';
import { resolveMcpGrantWithPolicy } from '@/lib/mcp/auth/principal';
import { mcpGrantBlockError } from '@/lib/mcp/auth/effective-access';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { clearDiscoveryPolicyCache, loadDiscoveryPolicy } from '@/lib/mcp/auth/discovery-policy';
import { resetMcpUsageForTests } from '@/lib/mcp/core/usage';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';

const actor = vi.hoisted(() => ({ id: '', isAdmin: true, fresh: true }));
// Whether the acting administrator signed in recently (SEC-7); widening needs it.
vi.mock('@/lib/mcp/auth/fresh-admin', () => ({
  requireFreshMcpAdmin: vi.fn(async (id: string) => actor.fresh && id === actor.id),
}));
// Runs inside a policy write's transaction, just before its audit row: a concurrent reader's view.
const duringAudit = vi.hoisted(() => ({ run: null as null | (() => Promise<unknown>) }));
vi.mock('@/lib/audit', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/audit')>();
  return {
    ...actual,
    logAudit: vi.fn(async (...args: Parameters<typeof actual.logAudit>) => {
      await duringAudit.run?.();
      return actual.logAudit(...args);
    }),
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({
    id: actor.id,
    isAdmin: actor.isAdmin,
    authenticated: true,
    capabilities: actor.isAdmin ? ['admin.manage'] : [],
  })),
  getCurrentUser: vi.fn(async () => ({ id: actor.id, tokenVersion: 0, timeZone: 'UTC' })),
}));

const queries = await import('@/app/(app)/settings/integrations/mcp/queries');
const actions = await import('@/app/(app)/settings/integrations/mcp/actions');
const { updateMcpDisabledCapabilities } =
  await import('@/app/(app)/settings/integrations/mcp/capability-actions');
const { POST } = await import('@/app/mcp/route');

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
  await loadMcpRuntime({ force: true });
}, 60000);

afterEach(() => cleanup());
afterAll(async () => {
  await db.mcpToken.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
});

let admin: { id: string };
beforeEach(async () => {
  actor.isAdmin = true;
  actor.fresh = true;
  duringAudit.run = null;
  clearDiscoveryPolicyCache();
  resetMcpUsageForTests();
  await db.mcpToken.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.deleteMany();
  admin = await createTestUser({ role: 'ADMIN', name: 'Ada Admin' });
  actor.id = admin.id;
});

const both = ['incidents:read', 'services:read'];
async function grant(
  name: string,
  client: Omit<Prisma.McpClientCreateInput, 'name' | 'redirectUris' | 'scopes'> = {},
  user: Partial<Prisma.UserCreateInput> = {},
  extra: Partial<Prisma.McpGrantUncheckedCreateInput> = {}
) {
  const person = await createTestUser({ name, ...user });
  const created = await db.mcpClient.create({
    data: { name, redirectUris: ['http://localhost/cb'], scopes: both, ...client },
  });
  return db.mcpGrant.create({
    data: {
      clientId: created.id,
      userId: person.id,
      userTokenVersion: 0,
      userRevocationVersion: 0,
      scopes: both,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600_000),
      ...extra,
    },
  });
}

/** One connection per way it can fail, plus the working kinds. */
async function fixtures() {
  return {
    manual: await grant('Manual'),
    dcr: await grant('Automatic', { dynamicRegistration: true }),
    trustedCimd: await grant('Trusted CIMD', {
      id: 'https://claude.ai/oauth/client.json',
      metadataUrl: 'https://claude.ai/oauth/client.json',
    }),
    untrustedCimd: await grant('Untrusted CIMD', {
      id: 'https://evil.example/client.json',
      metadataUrl: 'https://evil.example/client.json',
    }),
    inactive: await grant('Inactive', {}, { status: 'DISABLED' }),
    securityEvent: await grant('Security event', {}, { mcpRevocationVersion: 1 }),
    clientRevoked: await grant('Revoked client', { revokedAt: new Date() }),
    expired: await grant('Expired', {}, {}, { expiresAt: new Date(Date.now() - 1000) }),
    otherServer: await grant('Other server', {}, {}, { resource: 'https://elsewhere.example/mcp' }),
    adminScope: await (async () => {
      // A manual ceiling and a consent that both carry admin:manage: MCP never honours it.
      const created = await grant('Admin scope');
      const withAdmin = [...both, 'admin:manage'];
      await db.mcpClient.update({ where: { id: created.clientId }, data: { scopes: withAdmin } });
      return db.mcpGrant.update({ where: { id: created.id }, data: { scopes: withAdmin } });
    })(),
  };
}

async function setPolicy(policy: Partial<Prisma.McpPolicyCreateInput>) {
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...policy },
    update: policy,
  });
}

/**
 * Runs the request path (resolveMcpGrantWithPolicy) and the admin list over the same rows and
 * requires them to agree on every connection, and the headline count to match.
 */
async function expectParity() {
  const viewer = await queries.loadMcpViewer();
  const list = await queries.listMcpGrants(
    viewer,
    { status: 'all', q: '', clientId: null, page: 1 },
    new Date()
  );
  const rows = new Map(list.rows.map(row => [row.id, row]));
  let usable = 0;
  for (const row of rows.values()) {
    let resolved: Awaited<ReturnType<typeof resolveMcpGrantWithPolicy>> | null = null;
    let code: string | null = null;
    try {
      resolved = await resolveMcpGrantWithPolicy(row.id);
    } catch (error) {
      if (!(error instanceof McpBoundaryError)) throw error;
      code = error.code;
    }
    const label = `${row.client.name}: ${row.blockedReason}`;
    if (row.status !== 'active') {
      expect(code, label).toBe('MCP_INVALID_GRANT');
      continue;
    }
    if (row.blockedReason === null) {
      usable++;
      expect(code, label).toBeNull();
      expect(resolved?.policy?.enabled, label).toBe(true);
      expect([...row.effectiveScopes].sort(), label).toEqual(
        [...resolved!.auth.apiKey.scopes].sort()
      );
    } else if (row.blockedReason === 'mcp_disabled') {
      expect(code, label).toBeNull();
      expect(resolved?.policy?.enabled ?? false, label).toBe(false);
      expect(row.effectiveScopes, label).toEqual([]);
    } else {
      expect(code, label).toBe(mcpGrantBlockError(row.blockedReason));
      expect(row.effectiveScopes, label).toEqual([]);
    }
  }
  expect(await queries.countActiveConnections(viewer)).toBe(usable);
  expect(list.usable).toBe(usable);
  return { rows, usable };
}

describe('D3 effective access: the admin list shows what the request path enforces', () => {
  it('agrees with principal.ts for a narrowed ceiling, DCR off, untrusted hosts and inactive users', async () => {
    const f = await fixtures();
    const narrowed = {
      enabled: true,
      dcrEnabled: true,
      dcrScopes: ['incidents:read'],
      cimdEnabled: true,
      cimdAllowedHosts: ['claude.ai'],
      cimdScopes: both,
    };
    await setPolicy(narrowed);
    const a = await expectParity();
    expect(a.usable).toBe(3);
    // Approved two scopes; the narrowed automatic ceiling leaves one usable.
    expect(a.rows.get(f.dcr.id)).toMatchObject({
      scopes: both,
      effectiveScopes: ['incidents:read'],
      blockedReason: null,
    });
    expect(a.rows.get(f.manual.id)?.effectiveScopes).toEqual(both);
    expect(a.rows.get(f.trustedCimd.id)?.blockedReason).toBeNull();
    expect(a.rows.get(f.untrustedCimd.id)?.blockedReason).toBe('client_untrusted');
    expect(a.rows.get(f.inactive.id)?.blockedReason).toBe('user_inactive');
    expect(a.rows.get(f.securityEvent.id)?.blockedReason).toBe('access_changed');
    expect(a.rows.get(f.clientRevoked.id)?.blockedReason).toBe('client_revoked');
    expect(a.rows.get(f.expired.id)).toMatchObject({ status: 'expired', blockedReason: null });
    expect(a.rows.get(f.otherServer.id)?.blockedReason).toBe('ended');
    expect(a.rows.get(f.adminScope.id)?.blockedReason).toBe('admin_scope');

    // Automatic connections off: the self-registered assistant is blocked by policy.
    await setPolicy({ ...narrowed, dcrEnabled: false });
    const b = await expectParity();
    expect(b.rows.get(f.dcr.id)?.blockedReason).toBe('client_untrusted');
    expect(b.usable).toBe(2);

    // MCP off: nothing is usable and the headline count says so.
    await setPolicy({ ...narrowed, enabled: false });
    const c = await expectParity();
    expect(c.usable).toBe(0);
    expect(c.rows.get(f.manual.id)?.blockedReason).toBe('mcp_disabled');
  });

  it('shows the assistants list ceiling and "Blocked by policy" from the same columns', async () => {
    await fixtures();
    await setPolicy({ enabled: true, dcrEnabled: false, cimdEnabled: true, cimdScopes: both });
    const viewer = await queries.loadMcpViewer();
    const { rows } = await queries.listMcpClients(
      viewer,
      { status: 'all', type: 'all', q: '', page: 1 },
      new Date()
    );
    const byName = new Map(rows.map(row => [row.name, row]));
    expect(byName.get('Automatic')).toMatchObject({
      blockedReason: 'client_untrusted',
      effectiveScopes: [],
    });
    expect(byName.get('Manual')).toMatchObject({ blockedReason: null, effectiveScopes: both });
    expect(byName.get('Revoked client')?.blockedReason).toBeNull();
  });
});

describe('D1 Revoke all', () => {
  it('drives the confirmation dialog into revokeAllMcpConnections and revokes every grant', async () => {
    await fixtures();
    const before = await db.mcpGrant.count({ where: { revokedAt: null } });
    expect(before).toBeGreaterThan(0);
    const viewer = await queries.loadMcpViewer();
    // A filter is active, but the dialog reports what the action really revokes.
    const filtered = await queries.listMcpGrants(
      viewer,
      { status: 'active', q: 'Manual', clientId: null, page: 1 },
      new Date()
    );
    expect(filtered.total).toBe(1);
    expect(filtered.revocable).toBe(before);
    render(
      <McpConfirmAction
        action={actions.revokeAllMcpConnections}
        fields={{}}
        acknowledgement={`I understand this disconnects every assistant (${filtered.revocable}).`}
        label="Revoke all active connections"
        title="Revoke all active MCP connections?"
        description="Disconnects everyone."
        confirmLabel="Revoke all connections"
        successMessage="All MCP connections revoked"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all active connections' }));
    const confirm = screen.getByRole('button', { name: 'Revoke all connections' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /disconnects every assistant/ }));
    fireEvent.click(confirm);
    await waitFor(async () =>
      expect(await db.mcpGrant.count({ where: { revokedAt: null } })).toBe(0)
    );
    expect(
      await db.auditLog.findFirst({
        where: { action: 'mcp.grants.revoked_all', actorId: admin.id },
      })
    ).not.toBeNull();
  });
});

describe('D4 policy save is optimistic', () => {
  const policyForm = (revision: number | null, extra: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      enabled: 'on',
      dcrEnabled: 'on',
      dcrScopes: 'incidents:read',
      maxInFlight: '4',
      maxOperations: '8',
      requestsPerMinute: '60',
      ...extra,
    }))
      form.set(key, value);
    if (revision !== null) form.set('policyRevision', String(revision));
    return form;
  };

  it('refuses a save made from a stale page and keeps the newer policy', async () => {
    await setPolicy({ enabled: true, dcrEnabled: true, dcrScopes: ['incidents:read'] });
    const { policyRevision: start } = await db.mcpPolicy.findUniqueOrThrow({
      where: { id: 'default' },
    });
    // Admin A tightens the policy from a fresh page.
    expect(await actions.updateMcpPolicy(policyForm(start))).toEqual({
      ok: true,
      revision: start + 1,
    });
    // Admin B, still on the page rendered before A saved, tries to turn writes on.
    expect(await actions.updateMcpPolicy(policyForm(start, { writesEnabled: 'on' }))).toEqual({
      ok: false,
      code: 'MCP_POLICY_CONFLICT',
      revision: start + 1,
    });
    expect(await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      writesEnabled: false,
      policyRevision: start + 1,
    });
    // A capabilities save does not move the policy revision, so it causes no false conflict.
    await updateMcpDisabledCapabilities({ disabled: ['domain:incidents'], baseline: [] });
    expect(await actions.updateMcpPolicy(policyForm(start + 1))).toMatchObject({ ok: true });
  });

  it('treats one-click setup as a policy change, including the very first one', async () => {
    // The policy page rendered before any policy existed sends revision 0.
    expect(await db.mcpPolicy.findUnique({ where: { id: 'default' } })).toBeNull();
    await actions.enableMcpQuickSetup();
    expect(await actions.updateMcpPolicy(policyForm(0, { writesEnabled: 'on' }))).toEqual({
      ok: false,
      code: 'MCP_POLICY_CONFLICT',
      revision: 1,
    });
    // Turning MCP back on from an existing policy also moves the revision.
    await setPolicy({ enabled: false });
    await actions.enableMcpQuickSetup();
    expect(await actions.updateMcpPolicy(policyForm(1))).toMatchObject({
      ok: false,
      code: 'MCP_POLICY_CONFLICT',
      revision: 2,
    });
    expect((await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).writesEnabled).toBe(
      false
    );
  });
});

describe('SEC-12 policy saves clear the discovery memo after they commit', () => {
  it('a discovery read racing one-click setup does not pin the old policy', async () => {
    await db.mcpPolicy.create({ data: { id: 'default', enabled: false } });
    // A public request served while the setup transaction is still open sees the committed row
    // (MCP off) and memoises it; the memo must be cleared once the new policy is visible.
    duringAudit.run = () => loadDiscoveryPolicy();
    await actions.enableMcpQuickSetup();
    duringAudit.run = null;
    expect((await loadDiscoveryPolicy())?.enabled).toBe(true);
  });
});

describe('SEC-7 widening access needs a recent sign-in', () => {
  const policyForm = (revision: number, extra: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      enabled: 'on',
      dcrEnabled: 'on',
      dcrScopes: 'incidents:read',
      maxInFlight: '4',
      maxOperations: '8',
      requestsPerMinute: '60',
      policyRevision: String(revision),
      ...extra,
    }))
      form.set(key, value);
    return form;
  };
  const stored = () => db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });

  // Automatic connections cover both registration and metadata documents under one ceiling.
  const automatic = (scopes: string[]) => ({
    enabled: true,
    dcrEnabled: true,
    dcrScopes: scopes,
    cimdEnabled: true,
    cimdScopes: scopes,
  });

  it('refuses a stale session that widens access and leaves the policy and revision as they were', async () => {
    await setPolicy(automatic(['incidents:read']));
    const before = await stored();
    actor.fresh = false;
    // Saving the same values is not a widening.
    expect(await actions.updateMcpPolicy(policyForm(before.policyRevision))).toMatchObject({
      ok: true,
    });
    before.policyRevision += 1;
    for (const extra of [
      { writesEnabled: 'on' } as Record<string, string>,
      { sensitiveReadsEnabled: 'on' },
      { dcrScopes: 'incidents:read services:read' },
      { requestsPerMinute: '600' },
      { allowedBrowserOrigins: 'http://localhost:6274' },
    ]) {
      expect(await actions.updateMcpPolicy(policyForm(before.policyRevision, extra))).toEqual({
        ok: false,
        code: 'MCP_REAUTHENTICATION_REQUIRED',
      });
    }
    expect(await stored()).toMatchObject({
      writesEnabled: false,
      sensitiveReadsEnabled: false,
      dcrScopes: ['incidents:read'],
      requestsPerMinute: before.requestsPerMinute,
      allowedBrowserOrigins: [],
      policyRevision: before.policyRevision,
    });
    // One-click setup, adding or restoring an assistant and re-exposing a capability also widen.
    await setPolicy({ enabled: false });
    expect(await actions.enableMcpQuickSetup()).toEqual({
      ok: false,
      code: 'MCP_REAUTHENTICATION_REQUIRED',
    });
    expect((await stored()).enabled).toBe(false);
    const register = new FormData();
    register.set('name', 'Late');
    register.set('redirectUri', 'http://127.0.0.1:9/cb');
    register.set('scopes', 'incidents:read');
    expect(await actions.registerMcpClient(register)).toMatchObject({
      ok: false,
      code: 'MCP_REAUTHENTICATION_REQUIRED',
    });
    const restore = new FormData();
    restore.set('id', 'any');
    expect(await actions.restoreMcpClient(restore)).toMatchObject({
      code: 'MCP_REAUTHENTICATION_REQUIRED',
    });
    expect(await db.mcpClient.count()).toBe(0);
    await setPolicy({ disabledCapabilities: ['domain:incidents'] });
    expect(
      await updateMcpDisabledCapabilities({ disabled: [], baseline: ['domain:incidents'] })
    ).toEqual({ ok: false, code: 'MCP_REAUTHENTICATION_REQUIRED' });
    expect((await stored()).disabledCapabilities).toEqual(['domain:incidents']);
  });

  it('lets a stale session narrow access', async () => {
    await setPolicy({
      ...automatic(['incidents:read', 'services:read']),
      writesEnabled: true,
      allowedBrowserOrigins: ['http://localhost:6274'],
    });
    const before = await stored();
    actor.fresh = false;
    expect(
      await actions.updateMcpPolicy(
        policyForm(before.policyRevision, { requestsPerMinute: '30', allowedBrowserOrigins: '' })
      )
    ).toEqual({ ok: true, revision: before.policyRevision + 1 });
    expect(await stored()).toMatchObject({
      writesEnabled: false,
      dcrScopes: ['incidents:read'],
      requestsPerMinute: 30,
      allowedBrowserOrigins: [],
    });
    expect(
      await updateMcpDisabledCapabilities({ disabled: ['domain:incidents'], baseline: [] })
    ).toMatchObject({ ok: true });
  });

  it('saves allowed browser origins and refuses anything but exact origins', async () => {
    await setPolicy(automatic(['incidents:read']));
    const { policyRevision } = await stored();
    for (const bad of [
      '*',
      'null',
      'http://evil.example',
      'https://x.example/path',
      'https://u@x.example',
    ])
      await expect(
        actions.updateMcpPolicy(policyForm(policyRevision, { allowedBrowserOrigins: bad }))
      ).rejects.toThrow('MCP_INVALID_BROWSER_ORIGIN');
    expect(
      await actions.updateMcpPolicy(
        policyForm(policyRevision, {
          allowedBrowserOrigins: 'http://localhost:6274\nhttps://inspector.example.com',
          scopeStepUpEnabled: 'on',
        })
      )
    ).toMatchObject({ ok: true });
    expect(await stored()).toMatchObject({
      allowedBrowserOrigins: ['http://localhost:6274', 'https://inspector.example.com'],
      scopeStepUpEnabled: true,
    });
    // A form without the field keeps the list.
    const { policyRevision: next } = await stored();
    expect(await actions.updateMcpPolicy(policyForm(next))).toMatchObject({ ok: true });
    expect((await stored()).allowedBrowserOrigins).toHaveLength(2);
  });
});

describe('D5 register and restore return typed results', () => {
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields))
      for (const item of [value].flat()) data.append(key, item);
    return data;
  };

  it('reports field problems inline and the new client_id on success', async () => {
    expect(
      await actions.registerMcpClient(
        form({ name: 'Bad', redirectUri: 'http://evil.example/cb', scopes: 'incidents:read' })
      )
    ).toEqual({ ok: false, code: 'MCP_INVALID_REDIRECT', field: 'redirectUri' });
    expect(
      await actions.registerMcpClient(
        form({ name: 'Bad', redirectUri: 'not a url', scopes: 'incidents:read' })
      )
    ).toMatchObject({ ok: false, field: 'redirectUri' });
    expect(
      await actions.registerMcpClient(
        form({ name: 'Bad', redirectUri: 'http://127.0.0.1:9/cb', scopes: 'nope:read' })
      )
    ).toMatchObject({ ok: false, field: 'scopes' });
    expect(await db.mcpClient.count()).toBe(0);
    const created = await actions.registerMcpClient(
      form({ name: 'Good', redirectUri: 'http://127.0.0.1:9/cb', scopes: 'incidents:read' })
    );
    expect(
      created.ok && (await db.mcpClient.findUnique({ where: { id: created.clientId } }))
    ).toMatchObject({ name: 'Good' });
    expect(await actions.restoreMcpClient(form({ id: 'missing-client' }))).toEqual({
      ok: false,
      code: 'MCP_CLIENT_NOT_FOUND',
    });
  });
});

describe('D6 assistant filter', () => {
  it('lists allowed, used assistants and tells repeated names apart', async () => {
    const one = await grant('Claude Code');
    const two = await grant('Claude Code');
    await grant('Gone', { revokedAt: new Date() });
    await db.mcpClient.create({ data: { name: 'Never used', redirectUris: [], scopes: both } });
    const viewer = await queries.loadMcpViewer();
    const { clients, truncated } = await queries.listMcpAssistantFilter(viewer);
    expect(truncated).toBe(false);
    expect(clients.map(client => client.id).sort()).toEqual([one.clientId, two.clientId].sort());
    expect(new Set(clients.map(client => client.label)).size).toBe(2);
    expect(clients.every(client => client.label.startsWith('Claude Code · '))).toBe(true);
    actor.isAdmin = false;
    await expect(queries.listMcpAssistantFilter(await queries.loadMcpViewer())).rejects.toThrow(
      'MCP_ADMIN_REQUIRED'
    );
  });
});

describe('D7 fewer page queries', () => {
  it('reads a connections page with rows, access and every count in four statements', async () => {
    await fixtures();
    await setPolicy({ enabled: true, dcrEnabled: true, dcrScopes: both });
    const viewer = await queries.loadMcpViewer();
    await loadMcpRuntime();
    let statements = 0;
    const observe = () => statements++;
    const client = globalThis.prismaGlobal as unknown as {
      $on: (event: 'query', listener: () => void) => void;
    };
    client.$on('query', observe);
    statements = 0;
    // Searching by person reads the matching people first; then rows, counts and owners.
    await queries.listMcpGrants(
      viewer,
      { status: 'active', q: 'Manual', clientId: null, page: 1 },
      new Date()
    );
    const counted = statements;
    // Before this change: people, rows, four counts and owners (seven statements).
    expect(counted).toBeLessThanOrEqual(4);
  });
});

describe('D8 last call', () => {
  it('records the last tool call per connection, at most once a minute', async () => {
    await setPolicy({ enabled: true, requestsPerMinute: 600 });
    const user = await createTestUser({ role: 'ADMIN' });
    const scopes = ['incidents:read'];
    const client = await db.mcpClient.create({
      data: { name: 'Last call', scopes, redirectUris: ['http://localhost/cb'] },
    });
    const created = await db.mcpGrant.create({
      data: {
        clientId: client.id,
        userId: user.id,
        userTokenVersion: user.tokenVersion,
        scopes,
        resource: mcpResource(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const bearer = randomBytes(32).toString('base64url');
    await db.mcpToken.create({
      data: {
        grantId: created.id,
        scopes,
        accessHash: digestMcpSecret(bearer),
        refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
        accessExpiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const call = (method: string, params: Record<string, unknown>) =>
      POST(
        new Request(mcpResource(), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
      );
    // Listing tools is not a call.
    expect((await call('tools/list', {})).status).toBe(200);
    expect(await db.mcpGrant.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      lastCallAt: null,
      lastTool: null,
    });
    expect((await call('tools/call', { name: 'whoami', arguments: {} })).status).toBe(200);
    const first = await db.mcpGrant.findUniqueOrThrow({ where: { id: created.id } });
    expect(first.lastTool).toBe('whoami');
    expect(first.lastCallAt).toBeInstanceOf(Date);
    // A second call within the minute writes nothing.
    expect(
      (await call('tools/call', { name: 'search_capabilities', arguments: { query: 'x' } })).status
    ).toBe(200);
    expect(await db.mcpGrant.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      lastCallAt: first.lastCallAt,
      lastTool: 'whoami',
    });
    // The lists show it.
    const viewer = await queries.loadMcpViewer();
    const list = await queries.listMcpGrants(
      viewer,
      { status: 'all', q: '', clientId: client.id, page: 1 },
      new Date()
    );
    expect(list.rows[0]).toMatchObject({ lastTool: 'whoami', lastCallAt: first.lastCallAt });
    const clients = await queries.listMcpClients(
      viewer,
      { status: 'all', type: 'all', q: 'Last call', page: 1 },
      new Date()
    );
    expect(clients.rows[0]?.lastCallAt).toEqual(first.lastCallAt);
  });
});
