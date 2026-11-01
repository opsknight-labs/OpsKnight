import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { POST as register } from '@/app/oauth/mcp/register/route';
import { GET as authorize } from '@/app/oauth/mcp/authorize/route';
import { POST as exchange } from '@/app/oauth/mcp/token/route';
import { GET as discovery } from '@/app/.well-known/oauth-authorization-server/oauth/mcp/route';
import { authenticateMcp } from '@/lib/mcp/auth/principal';
import { cleanupMcpCredentials } from '@/lib/mcp/auth/retention';
import { resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';

const actor = vi.hoisted(() => ({ id: '', status: 'ACTIVE', tokenVersion: 0, location: '' }));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(async () => actor),
  getUserPermissions: vi.fn(async () => ({ ...actor, capabilities: ['admin.manage'] })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    actor.location = url;
  }),
}));
const origin = 'http://localhost:3000';
const scopes = ['incidents:read', 'services:read', 'schedules:read'];
const callback = 'http://localhost:19345/callback';

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
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:oauth:register:' } } });
  const policy = { enabled: true, dcrEnabled: true, dcrScopes: scopes, requestsPerMinute: 600 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});
function request(body: unknown, peer?: string) {
  return new Request(`${origin}/oauth/mcp/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(peer ? { 'x-forwarded-for': peer } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const metadata = {
  client_name: 'Claude Code',
  redirect_uris: [callback],
  token_endpoint_auth_method: 'none',
};
async function client() {
  const response = await register(request(metadata));
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string; scope: string };
}
async function connect(
  clientId: string,
  user: Awaited<ReturnType<typeof createTestUser>>,
  requestedScope?: string
) {
  actor.id = user.id;
  actor.tokenVersion = user.tokenVersion;
  actor.location = '';
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: 'code',
    resource: `${origin}/mcp`,
    state: randomBytes(24).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...(requestedScope ? { scope: requestedScope } : {}),
  });
  const response = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
  expect(response.status).toBe(307);
  const pendingId = new URL(response.headers.get('location')!).searchParams.get('id')!;
  const { decideMcpConsent } = await import('@/app/(app)/settings/integrations/mcp/actions');
  const form = new FormData();
  form.set('id', pendingId);
  form.set('decision', 'allow');
  // Select everything the consent page offers this user.
  const pending = await db.mcpConsentRequest.findUniqueOrThrow({ where: { id: pendingId } });
  for (const scope of pending.scopes) form.append('scope', scope);
  await decideMcpConsent(form);
  const result = new URL(actor.location);
  expect(result.searchParams.get('iss')).toBe(`${origin}/oauth/mcp`);
  const token = await exchange(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: result.searchParams.get('code')!,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: `${origin}/mcp`,
      }),
    })
  );
  expect(token.status).toBe(200);
  return (await token.json()) as { access_token: string; refresh_token: string; scope: string };
}
const authenticate = (token: string) =>
  authenticateMcp(
    new Request(`${origin}/mcp`, { headers: { authorization: `Bearer ${token}` } }),
    1
  );

describe('automatic MCP client registration', () => {
  it('advertises an admin-enabled endpoint and creates no grant, code or token during registration', async () => {
    const advertised = await discovery();
    expect(advertised.headers.get('cache-control')).toBe('no-store');
    expect(await advertised.json()).toMatchObject({
      registration_endpoint: `${origin}/oauth/mcp/register`,
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: scopes,
    });
    const before = [
      await db.mcpGrant.count(),
      await db.mcpToken.count(),
      await db.mcpAuthorizationCode.count(),
    ];
    const registered = await client();
    expect(registered.scope).toBe(scopes.join(' '));
    expect(registered).not.toHaveProperty('client_secret');
    expect(await db.mcpClient.findUnique({ where: { id: registered.client_id } })).toMatchObject({
      dynamicRegistration: true,
      metadataUrl: null,
      firstAuthorizedAt: null,
      scopes,
    });
    expect([
      await db.mcpGrant.count(),
      await db.mcpToken.count(),
      await db.mcpAuthorizationCode.count(),
    ]).toEqual(before);
  });
  it('completes PKCE with no supplied scope or client secret and keeps users independently revocable', async () => {
    const registered = await client();
    const first = await createTestUser({ role: 'ADMIN' });
    const second = await createTestUser({ role: 'USER' });
    const a = await connect(registered.client_id, first);
    const b = await connect(registered.client_id, second, 'incidents:read');
    const authA = await authenticate(a.access_token);
    const authB = await authenticate(b.access_token);
    expect(authA.auth.actor.id).toBe(first.id);
    expect(authB.auth.actor.id).toBe(second.id);
    expect(authA.grantId).not.toBe(authB.grantId);
    expect(authB.auth.apiKey.scopes).toEqual(['incidents:read']);
    expect(
      (await db.mcpClient.findUniqueOrThrow({ where: { id: registered.client_id } }))
        .firstAuthorizedAt
    ).not.toBeNull();
    await db.mcpGrant.update({ where: { id: authA.grantId }, data: { revokedAt: new Date() } });
    await expect(authenticate(a.access_token)).rejects.toThrow('MCP_INVALID_GRANT');
    expect((await authenticate(b.access_token)).auth.actor.id).toBe(second.id);
  });
  it('applies scope reduction, client revocation and the registration kill switch to issued credentials', async () => {
    const registered = await client();
    const token = await connect(registered.client_id, await createTestUser({ role: 'ADMIN' }));
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { dcrScopes: ['incidents:read'] },
    });
    expect((await authenticate(token.access_token)).auth.apiKey.scopes).toEqual(['incidents:read']);
    const refresh = await exchange(
      new Request(`${origin}/oauth/mcp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: registered.client_id,
          refresh_token: token.refresh_token,
          resource: `${origin}/mcp`,
        }),
      })
    );
    expect(refresh.status).toBe(200);
    const refreshed = await refresh.json();
    expect(refreshed.scope).toBe('incidents:read');
    token.access_token = refreshed.access_token;
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { dcrEnabled: false } });
    await expect(authenticate(token.access_token)).rejects.toThrow('MCP_INVALID_GRANT');
    expect((await register(request(metadata))).status).toBe(403);
    expect(await (await discovery()).json()).not.toHaveProperty('registration_endpoint');
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { dcrEnabled: true } });
    await db.mcpClient.update({
      where: { id: registered.client_id },
      data: { revokedAt: new Date() },
    });
    await expect(authenticate(token.access_token)).rejects.toThrow('MCP_INVALID_GRANT');
  });
  it('rejects unsafe metadata, secret grants, duplicate keys and oversized bodies', async () => {
    const before = await db.mcpClient.count();
    for (const body of [
      { ...metadata, redirect_uris: ['http://evil.example/callback'] },
      { ...metadata, redirect_uris: ['https://user:password@evil.example/callback'] },
      { ...metadata, redirect_uris: ['https://evil.example/callback#fragment'] },
      { ...metadata, redirect_uris: [callback, callback] },
      { ...metadata, token_endpoint_auth_method: 'client_secret_post' },
      { ...metadata, grant_types: ['client_credentials'] },
      { ...metadata, client_secret: 'not-supported' },
      { ...metadata, client_id: 'impersonate-existing' },
      '{"redirect_uris":["http://localhost:19345/callback"],"client_name":"one","client_name":"two"}',
    ])
      expect((await register(request(body))).status).toBe(400);
    expect((await register(request({ ...metadata, client_name: 'x'.repeat(9000) }))).status).toBe(
      413
    );
    expect(await db.mcpClient.count()).toBe(before);
  });
  it('accepts what real assistants send: extra known grants, a bare loopback URI', async () => {
    const response = await register(
      request({
        ...metadata,
        redirect_uris: ['http://127.0.0.1:33418', 'https://vscode.dev/redirect'],
        grant_types: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        ],
        application_type: 'native',
        software_statement: 'eyJhbGciOiJub25lIn0.e30.',
      })
    );
    expect(response.status).toBe(201);
    const registered = await response.json();
    expect(registered.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(registered.redirect_uris).toEqual([
      'http://127.0.0.1:33418',
      'https://vscode.dev/redirect',
    ]);
    expect(registered).not.toHaveProperty('software_statement');
  });
  it('refuses secrets, key material and unknown or misspelled metadata', async () => {
    for (const extra of [
      { client_secret: 'x' },
      { jwks_uri: 'https://keys.example/jwks' },
      { token_endpoint_auth_methd: 'none' },
      { grant_types: ['authorization_code', 'password'] },
    ]) {
      const response = await register(request({ ...metadata, ...extra }));
      expect(response.status).toBe(400);
    }
  });
  it('narrows requested scopes to the policy ceiling instead of failing or escalating', async () => {
    for (const scope of ['admin:manage', 'incidents:write', 'openid offline_access']) {
      const response = await register(request({ ...metadata, scope }));
      expect(response.status).toBe(201);
      const registered = await response.json();
      const policy = await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } });
      for (const granted of registered.scope.split(' ')) {
        expect(policy.dcrScopes).toContain(granted);
        expect(granted).not.toBe('admin:manage');
      }
    }
  });
  it('retains active consent and authenticated client identities while cleaning unused registrations', async () => {
    const unused = await client();
    const pending = await client();
    const used = await client();
    const recent = await client();
    const old = new Date(Date.now() - 31 * 86_400_000);
    await db.mcpClient.updateMany({
      where: { id: { in: [unused.client_id, pending.client_id, used.client_id] } },
      data: { createdAt: old },
    });
    // A failed sign-in an hour ago must not strand the client_id the assistant has cached.
    await db.mcpClient.update({
      where: { id: recent.client_id },
      data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    await db.mcpClient.update({ where: { id: used.client_id }, data: { firstAuthorizedAt: old } });
    const user = await createTestUser({ role: 'ADMIN' });
    await db.mcpConsentRequest.create({
      data: {
        userId: user.id,
        clientId: pending.client_id,
        redirectUri: callback,
        scopes,
        state: 'pending-registration-state',
        challenge: 'a'.repeat(43),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await cleanupMcpCredentials();
    expect(await db.mcpClient.findUnique({ where: { id: unused.client_id } })).toBeNull();
    expect(await db.mcpClient.findUnique({ where: { id: pending.client_id } })).not.toBeNull();
    expect(await db.mcpClient.findUnique({ where: { id: used.client_id } })).not.toBeNull();
    expect(await db.mcpClient.findUnique({ where: { id: recent.client_id } })).not.toBeNull();
  });
  it('keeps registrations disabled on existing installations until explicitly enabled', async () => {
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { dcrEnabled: false } });
    expect((await register(request(metadata))).status).toBe(403);
    expect(await (await discovery()).json()).not.toHaveProperty('registration_endpoint');
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { enabled: false, dcrEnabled: true },
    });
    expect((await register(request(metadata))).status).toBe(403);
  });
  it('rejects consent when an administrator withdraws scopes while the native form is open', async () => {
    const registered = await client();
    const user = await createTestUser({ role: 'ADMIN' });
    actor.id = user.id;
    actor.tokenVersion = user.tokenVersion;
    const query = new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: callback,
      response_type: 'code',
      resource: `${origin}/mcp`,
      state: 'stale-consent-state-123456',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    });
    const started = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
    expect(started.status).toBe(307);
    const id = new URL(started.headers.get('location')!).searchParams.get('id')!;
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { dcrScopes: ['incidents:read'] },
    });
    const before = await db.mcpGrant.count();
    const { decideMcpConsent } = await import('@/app/(app)/settings/integrations/mcp/actions');
    const form = new FormData();
    form.set('id', id);
    form.set('decision', 'allow');
    await expect(decideMcpConsent(form)).rejects.toThrow('invalid_scope');
    expect(await db.mcpGrant.count()).toBe(before);
    expect((await db.mcpConsentRequest.findUniqueOrThrow({ where: { id } })).consumedAt).toBeNull();
  });
  it('limits registration per trusted peer without spending another peer’s quota', async () => {
    const previous = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';
    try {
      for (let i = 0; i < 10; i++)
        expect((await register(request(metadata, '198.51.100.10'))).status).toBe(201);
      for (let i = 0; i < 5; i++)
        expect((await register(request(metadata, '198.51.100.10'))).status).toBe(429);
      expect((await register(request(metadata, '198.51.100.11'))).status).toBe(201);
      const global = await db.rateLimit.findMany({
        where: { key: { startsWith: 'mcp:oauth:register:global:' } },
      });
      expect(global.reduce((sum, row) => sum + row.count, 0)).toBe(11);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = previous;
    }
  });
  it('caps anonymous client allocation and makes room by evicting the oldest unused entry', async () => {
    const existing = await db.mcpClient.count({
      where: { dynamicRegistration: true, revokedAt: null },
    });
    // Entries left by earlier tests are made fresh, so only this test's ones can be evicted.
    await db.mcpClient.updateMany({
      where: { dynamicRegistration: true },
      data: { createdAt: new Date() },
    });
    // A burst of fresh registrations fills the table: nothing is old enough to evict.
    await db.mcpClient.createMany({
      data: Array.from({ length: 5000 - existing }, (_, index) => ({
        name: 'Unused registration',
        dynamicRegistration: true,
        scopes,
        redirectUris: [callback],
        createdAt: new Date(Date.now() - 60_000 - index),
      })),
    });
    expect((await register(request(metadata))).status).toBe(503);
    const oldest = await db.mcpClient.findFirstOrThrow({
      where: { name: 'Unused registration' },
      orderBy: { createdAt: 'asc' },
    });
    const authorized = await db.mcpClient.findFirstOrThrow({
      where: { name: 'Unused registration', id: { not: oldest.id } },
      orderBy: { createdAt: 'asc' },
    });
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    await db.mcpClient.update({ where: { id: oldest.id }, data: { createdAt: hoursAgo(3) } });
    await db.mcpClient.update({
      where: { id: authorized.id },
      data: { createdAt: hoursAgo(4), firstAuthorizedAt: hoursAgo(4) },
    });
    // A revoked entry is outside the counted population; evicting it would let the cap grow.
    const revoked = await db.mcpClient.create({
      data: {
        name: 'Revoked registration',
        dynamicRegistration: true,
        scopes,
        redirectUris: [callback],
        createdAt: hoursAgo(5),
        revokedAt: hoursAgo(5),
      },
    });
    // Full, but an hour-old never-used entry exists: evict it, never a used or revoked one.
    expect((await register(request(metadata))).status).toBe(201);
    expect(await db.mcpClient.findUnique({ where: { id: oldest.id } })).toBeNull();
    expect(await db.mcpClient.findUnique({ where: { id: authorized.id } })).not.toBeNull();
    expect(await db.mcpClient.findUnique({ where: { id: revoked.id } })).not.toBeNull();
    expect(
      await db.mcpClient.count({ where: { dynamicRegistration: true, revokedAt: null } })
    ).toBe(5000);
    expect((await register(request(metadata))).status).toBe(503);
  });
});
