import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { POST as register } from '@/app/oauth/mcp/register/route';
import { GET as authorize } from '@/app/oauth/mcp/authorize/route';
import { POST as exchange } from '@/app/oauth/mcp/token/route';
import { GET as protectedResource } from '@/app/.well-known/oauth-protected-resource/mcp/route';
import { resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';

const actor = vi.hoisted(() => ({
  id: '',
  status: 'ACTIVE',
  tokenVersion: 0,
  location: '',
  admin: true,
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(async () => actor),
  getUserPermissions: vi.fn(async () => ({
    ...actor,
    capabilities: actor.admin ? ['admin.manage'] : [],
  })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    actor.location = url;
  }),
}));
const origin = 'http://localhost:3000';
const callback = 'http://localhost:19345/callback';
const DAY = 86_400_000;
const scopes = ['incidents:read', 'services:read', 'schedules:read'];

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local PostgreSQL required');
  process.env.MCP_PUBLIC_ORIGIN = origin;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  delete process.env.ENCRYPTION_KEYS;
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  resetMcpRuntimeForTests();
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:' } } });
  await db.mcpConsentRequest.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpPolicy.deleteMany();
  actor.admin = true;
});

async function registerClient(scope?: string) {
  const response = await register(
    new Request(`${origin}/oauth/mcp/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Assistant',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        ...(scope ? { scope } : {}),
      }),
    })
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string };
}

async function authorizeOnly(
  clientId: string,
  user: { id: string; tokenVersion: number },
  extra: Record<string, string>
) {
  actor.id = user.id;
  actor.tokenVersion = user.tokenVersion;
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: 'code',
    state: randomBytes(24).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...extra,
  });
  const response = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
  return { response, verifier, state: query.get('state')! };
}

async function connectWithoutResource(
  clientId: string,
  user: Awaited<ReturnType<typeof createTestUser>>
) {
  const { response, verifier } = await authorizeOnly(clientId, user, {});
  expect(response.status).toBe(307);
  expect(new URL(response.headers.get('location')!).pathname).toBe('/oauth/mcp/consent');
  const pendingId = new URL(response.headers.get('location')!).searchParams.get('id')!;
  const { decideMcpConsent } = await import('@/app/(app)/settings/integrations/mcp/actions');
  const form = new FormData();
  form.set('id', pendingId);
  form.set('decision', 'allow');
  actor.location = '';
  await decideMcpConsent(form);
  const code = new URL(actor.location).searchParams.get('code')!;
  const token = await exchange(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: callback,
      }),
    })
  );
  expect(token.status).toBe(200);
  return (await token.json()) as { access_token: string; refresh_token: string };
}

const refresh = (clientId: string, refreshToken: string) =>
  exchange(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    })
  );

describe('easy assistant onboarding', () => {
  beforeEach(async () => {
    await db.mcpPolicy.create({ data: { enabled: true, dcrEnabled: true, dcrScopes: scopes } });
  });

  it('connects without a resource parameter and keeps the connection signed in while it is used', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    const { client_id } = await registerClient();
    const token = await connectWithoutResource(client_id, user);
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { userId: user.id } });
    // 30 days idle, 90 days absolute (previously a fixed 24 hours).
    expect(grant.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    expect(grant.absoluteExpiresAt!.getTime() - Date.now()).toBeGreaterThan(89 * DAY);

    // A grant close to idling out is renewed by use…
    await db.mcpGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() + DAY) },
    });
    const first = await refresh(client_id, token.refresh_token);
    expect(first.status).toBe(200);
    const renewed = await db.mcpGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(renewed.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    expect(renewed.lastUsedAt).not.toBeNull();

    // …but never past the absolute cap.
    await db.mcpGrant.update({
      where: { id: grant.id },
      data: { absoluteExpiresAt: new Date(Date.now() + 5 * DAY) },
    });
    const next = (await first.json()) as { refresh_token: string };
    expect((await refresh(client_id, next.refresh_token)).status).toBe(200);
    const capped = await db.mcpGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(capped.expiresAt.getTime()).toBe(capped.absoluteExpiresAt!.getTime());
  });

  it('does not renew a revoked or expired connection', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    const { client_id } = await registerClient();
    const token = await connectWithoutResource(client_id, user);
    const grant = await db.mcpGrant.findFirstOrThrow({ where: { userId: user.id } });
    await db.mcpGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await refresh(client_id, token.refresh_token)).status).toBe(400);
    const stale = await db.mcpGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stale.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it('narrows generic or excessive scopes when authorizing instead of failing', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    const { client_id } = await registerClient();
    const generic = await authorizeOnly(client_id, user, {
      scope: 'openid offline_access incidents:read',
    });
    expect(generic.response.status).toBe(307);
    const onlyGeneric = await authorizeOnly(client_id, user, { scope: 'openid' });
    expect(onlyGeneric.response.status).toBe(307);
    const pending = await db.mcpConsentRequest.findMany({ orderBy: { expiresAt: 'asc' }, take: 2 });
    expect(pending.at(-2)!.scopes).toEqual(['incidents:read']);
    expect(pending.at(-1)!.scopes).toEqual(scopes);
    const escalated = await authorizeOnly(client_id, user, { scope: 'admin:manage' });
    expect(escalated.response.status).toBe(307);
    const last = await db.mcpConsentRequest.findFirstOrThrow({ orderBy: { expiresAt: 'desc' } });
    expect(last.scopes).not.toContain('admin:manage');
  });

  it('shows a readable page, not raw JSON, when authorization cannot proceed', async () => {
    const user = await createTestUser({ role: 'USER' });
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { enabled: false } });
    const { response } = await authorizeOnly('missing', user, {});
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('AI assistant access is turned off');
    expect(html).not.toContain('{"error"');
  });

  it('advertises the scopes assistants should request', async () => {
    const body = await (await protectedResource()).json();
    expect(body.scopes_supported).toEqual(scopes);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { enabled: false } });
    expect(await (await protectedResource()).json()).not.toHaveProperty('scopes_supported');
  });
});

describe('failures reach the assistant as OAuth errors', () => {
  beforeEach(async () => {
    await db.mcpPolicy.create({ data: { enabled: true, dcrEnabled: true, dcrScopes: scopes } });
  });

  it('redirects a verified client back with a readable error instead of showing JSON', async () => {
    const user = await createTestUser({ role: 'USER' });
    const { client_id } = await registerClient();
    // The administrator emptied the ceiling after the assistant registered.
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { dcrScopes: [] } });
    const result = await authorizeOnly(client_id, user, {});
    expect(result.response.status).toBe(307);
    const target = new URL(result.response.headers.get('location')!);
    expect(`${target.origin}${target.pathname}`).toBe(callback);
    expect(target.searchParams.get('error')).toBe('unauthorized_client');
    expect(target.searchParams.get('error_description')).toMatch(/administrator/i);
    expect(target.searchParams.get('state')).toBe(result.state);
    expect(target.searchParams.get('iss')).toBe(`${origin}/oauth/mcp`);
  });

  it('keeps pre-verification failures in the browser, not on the client address', async () => {
    const user = await createTestUser({ role: 'USER' });
    const { client_id } = await registerClient();
    await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:consent:' } } });
    for (let attempt = 0; attempt < 10; attempt += 1) await authorizeOnly(client_id, user, {});
    const limited = await authorizeOnly(client_id, user, {});
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get('location')).toBeNull();
    expect(limited.response.headers.get('content-type')).toContain('text/html');
  });

  it('never redirects to an address the client did not register', async () => {
    const user = await createTestUser({ role: 'USER' });
    const { client_id } = await registerClient();
    actor.id = user.id;
    actor.tokenVersion = user.tokenVersion;
    const query = new URLSearchParams({
      client_id,
      redirect_uri: 'https://evil.example/steal',
      response_type: 'code',
      state: randomBytes(24).toString('hex'),
      code_challenge: createHash('sha256').update('x').digest('base64url'),
      code_challenge_method: 'S256',
      scope: 'incidents:read',
    });
    const response = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('sends an expired, unused consent back to the assistant as a retryable error', async () => {
    const user = await createTestUser({ role: 'USER' });
    const other = await createTestUser({ role: 'USER' });
    const { client_id } = await registerClient();
    const { response, state } = await authorizeOnly(client_id, user, {});
    const id = new URL(response.headers.get('location')!).searchParams.get('id')!;
    const { expiredConsentReturn } = await import('@/lib/mcp/auth/consent');
    expect(await expiredConsentReturn(id)).toBeNull(); // still valid: nothing to return
    await db.mcpConsentRequest.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const back = new URL((await expiredConsentReturn(id))!);
    expect(back.searchParams.get('error')).toBe('temporarily_unavailable');
    expect(back.searchParams.get('state')).toBe(state);
    // Not for someone else's request, and not once it was used.
    actor.id = other.id;
    expect(await expiredConsentReturn(id)).toBeNull();
    actor.id = user.id;
    await db.mcpConsentRequest.update({ where: { id }, data: { consumedAt: new Date() } });
    expect(await expiredConsentReturn(id)).toBeNull();
  });

  it('gives API callers a human-readable description when MCP is off', async () => {
    const { mcpHttpError } = await import('@/lib/mcp/auth/http');
    const { McpBoundaryError } = await import('@/lib/mcp/core/errors');
    const response = mcpHttpError(new McpBoundaryError('MCP_DISABLED', 503));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'MCP_DISABLED',
      error_description: expect.stringContaining('administrator'),
    });
  });
});

describe('restoring a revoked client', () => {
  beforeEach(async () => {
    await db.mcpPolicy.create({ data: { enabled: true, dcrEnabled: true, dcrScopes: scopes } });
  });
  const authenticate = async (token: string) => {
    const { authenticateMcp } = await import('@/lib/mcp/auth/principal');
    return authenticateMcp(
      new Request(`${origin}/mcp`, { headers: { authorization: `Bearer ${token}` } }),
      1
    );
  };
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it('does not bring old connections back when the client is allowed again', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const { client_id } = await registerClient();
    const token = await connectWithoutResource(client_id, admin);
    await expect(authenticate(token.access_token)).resolves.toBeTruthy();
    const { revokeMcpAccess, restoreMcpClient } =
      await import('@/app/(app)/settings/integrations/mcp/actions');
    actor.id = admin.id;
    actor.tokenVersion = admin.tokenVersion;
    await revokeMcpAccess(form({ kind: 'client', id: client_id }));
    await expect(authenticate(token.access_token)).rejects.toThrow('MCP_INVALID_GRANT');
    // Revoking the client revokes its grants themselves, not only the client record.
    expect(await db.mcpGrant.count({ where: { clientId: client_id, revokedAt: null } })).toBe(0);
    await restoreMcpClient(form({ id: client_id }));
    await expect(authenticate(token.access_token)).rejects.toThrow('MCP_INVALID_GRANT');
    // A fresh sign-in on the restored client works.
    const again = await connectWithoutResource(client_id, admin);
    await expect(authenticate(again.access_token)).resolves.toBeTruthy();
  });

  it('also revokes grants that were left live by a client revoked before this fix', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const { client_id } = await registerClient();
    const token = await connectWithoutResource(client_id, admin);
    await db.mcpClient.update({ where: { id: client_id }, data: { revokedAt: new Date() } });
    expect(await db.mcpGrant.count({ where: { clientId: client_id, revokedAt: null } })).toBe(1);
    const { restoreMcpClient } = await import('@/app/(app)/settings/integrations/mcp/actions');
    actor.id = admin.id;
    actor.tokenVersion = admin.tokenVersion;
    await restoreMcpClient(form({ id: client_id }));
    await expect(authenticate(token.access_token)).rejects.toThrow('MCP_INVALID_GRANT');
  });
});

describe('one-click setup', () => {
  it('enables read-only automatic connections once and never overwrites an existing setup', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    actor.id = admin.id;
    actor.tokenVersion = admin.tokenVersion;
    const { enableMcpQuickSetup } = await import('@/app/(app)/settings/integrations/mcp/actions');
    await enableMcpQuickSetup();
    const policy = await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    expect(policy).toMatchObject({
      enabled: true,
      dcrEnabled: true,
      cimdEnabled: true,
      writesEnabled: false,
      sensitiveReadsEnabled: false,
      cimdAllowedHosts: [],
    });
    expect(policy.dcrScopes).toEqual(scopes);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: true } });
    await expect(enableMcpQuickSetup()).rejects.toThrow('MCP_ALREADY_CONFIGURED');
    expect((await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).writesEnabled).toBe(
      true
    );
  });

  it('is refused for non-administrators', async () => {
    const user = await createTestUser({ role: 'USER' });
    actor.id = user.id;
    actor.admin = false;
    const { enableMcpQuickSetup } = await import('@/app/(app)/settings/integrations/mcp/actions');
    await expect(enableMcpQuickSetup()).rejects.toThrow('MCP_ADMIN_REQUIRED');
    expect(await db.mcpPolicy.count()).toBe(0);
  });
});

describe('saving the policy form', () => {
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    data.set('maxInFlight', '4');
    data.set('maxOperations', '8');
    data.set('requestsPerMinute', '60');
    data.set('sessionIdleDays', '30');
    for (const [key, value] of Object.entries(fields))
      for (const item of [value].flat()) data.append(key, item);
    return data;
  };
  it('turns client metadata documents on and off with automatic connections', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    actor.id = admin.id;
    actor.tokenVersion = admin.tokenVersion;
    const { updateMcpPolicy } = await import('@/app/(app)/settings/integrations/mcp/actions');
    await updateMcpPolicy(form({ enabled: 'on', dcrEnabled: 'on', dcrScopes: scopes }));
    expect(await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      dcrEnabled: true,
      cimdEnabled: true,
      cimdScopes: scopes,
      sessionIdleDays: 30,
    });
    await updateMcpPolicy(form({ enabled: 'on', dcrScopes: scopes }));
    expect(await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      dcrEnabled: false,
      cimdEnabled: false,
    });
  });
  it('does not silently drop an existing host-restricted metadata setup', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    actor.id = admin.id;
    actor.tokenVersion = admin.tokenVersion;
    await db.mcpPolicy.create({
      data: {
        enabled: true,
        cimdEnabled: true,
        cimdAllowedHosts: ['client.example.com'],
        cimdScopes: ['incidents:read'],
      },
    });
    const { updateMcpPolicy } = await import('@/app/(app)/settings/integrations/mcp/actions');
    await updateMcpPolicy(
      form({ enabled: 'on', cimdAllowedHosts: 'client.example.com', dcrScopes: scopes })
    );
    expect(await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      cimdEnabled: true,
      cimdAllowedHosts: ['client.example.com'],
      cimdScopes: ['incidents:read'],
      dcrEnabled: false,
    });
  });
});
