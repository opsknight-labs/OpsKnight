import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { GET as authorize } from '@/app/oauth/mcp/authorize/route';
import { POST as exchange } from '@/app/oauth/mcp/token/route';
import { POST as register } from '@/app/oauth/mcp/register/route';
import { GET as protectedResource } from '@/app/.well-known/oauth-protected-resource/mcp/route';
import { resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';
import { DEFAULT_ASSISTANT_SCOPES } from '@/lib/mcp/auth/client-policy';

// The documents Claude publishes (fetched 2026-10-30), served instead of a network fetch.
const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CLAUDE_CODE_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const published: Record<string, object> = {
  [CLAUDE_ID]: {
    client_id: CLAUDE_ID,
    client_name: 'Claude',
    client_uri: 'https://claude.ai',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    grant_types: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    ],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
  [CLAUDE_CODE_ID]: {
    client_id: CLAUDE_CODE_ID,
    client_name: 'Claude Code',
    client_uri: 'https://claude.ai',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
};
vi.mock('@/lib/mcp/auth/cimd-transport', async original => ({
  ...(await original<typeof import('@/lib/mcp/auth/cimd-transport')>()),
  fetchPinnedMetadata: vi.fn(async (url: URL) => ({
    status: published[url.href] ? 200 : 404,
    contentType: 'application/json',
    body: JSON.stringify(published[url.href] ?? {}),
  })),
}));

const actor = vi.hoisted(() => ({ id: '', status: 'ACTIVE', tokenVersion: 0, location: '' }));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(async () => actor),
  getUserPermissions: vi.fn(async () => ({ ...actor, capabilities: [] })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    actor.location = url;
  }),
}));

const origin = 'http://localhost:3000';

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
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.deleteMany();
  // Exactly what the one-click "Turn on" stores.
  await db.mcpPolicy.create({
    data: {
      enabled: true,
      dcrEnabled: true,
      dcrScopes: DEFAULT_ASSISTANT_SCOPES,
      cimdEnabled: true,
      cimdAllowedHosts: [],
      cimdScopes: DEFAULT_ASSISTANT_SCOPES,
    },
  });
});

/** Runs the flow the way Claude does: every advertised scope, the resource, PKCE, consent, token. */
async function connectLikeClaude(clientId: string, callback: string) {
  const user = await createTestUser({ role: 'ADMIN' });
  actor.id = user.id;
  actor.tokenVersion = user.tokenVersion;
  const advertised = (await (await protectedResource()).json()) as {
    resource: string;
    scopes_supported: string[];
  };
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    scope: advertised.scopes_supported.join(' '),
    state: randomBytes(24).toString('base64url'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: advertised.resource,
  });
  const authorized = await authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
  if (authorized.status !== 307) return { authorized };
  const consent = new URL(authorized.headers.get('location')!);
  expect(consent.pathname).toBe('/oauth/mcp/consent');
  const { decideMcpConsent } = await import('@/app/(app)/settings/integrations/mcp/actions');
  const form = new FormData();
  form.set('id', consent.searchParams.get('id')!);
  form.set('decision', 'allow');
  // An administrator keeps every offered permission selected.
  const pending = await db.mcpConsentRequest.findUniqueOrThrow({
    where: { id: consent.searchParams.get('id')! },
  });
  for (const scope of pending.scopes) form.append('scope', scope);
  actor.location = '';
  await decideMcpConsent(form);
  const back = new URL(actor.location);
  expect(back.origin + back.pathname).toBe(new URL(callback).origin + new URL(callback).pathname);
  expect(back.searchParams.get('state')).toBe(query.get('state'));
  const token = await exchange(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: back.searchParams.get('code')!,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: advertised.resource,
      }),
    })
  );
  expect(token.status).toBe(200);
  const tokens = (await token.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
  };
  const refreshed = await exchange(
    new Request(`${origin}/oauth/mcp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      }),
    })
  );
  expect(refreshed.status).toBe(200);
  const { access_token } = (await refreshed.json()) as { access_token: string };
  const { authenticateMcp } = await import('@/lib/mcp/auth/principal');
  const principal = await authenticateMcp(
    new Request(`${origin}/mcp`, { headers: { authorization: `Bearer ${access_token}` } }),
    1
  );
  return { authorized, tokens, principal };
}

describe('connecting Claude after the one-click setup', () => {
  it('connects claude.ai, Desktop and mobile through its published metadata document', async () => {
    const { principal, tokens } = await connectLikeClaude(
      CLAUDE_ID,
      'https://claude.ai/api/mcp/auth_callback'
    );
    expect(principal).toBeTruthy();
    expect(tokens!.scope.split(' ').sort()).toEqual([...DEFAULT_ASSISTANT_SCOPES].sort());
    expect(await db.mcpClient.findUnique({ where: { id: CLAUDE_ID } })).toMatchObject({
      name: 'Claude',
    });
  });

  it.each(['http://localhost:53172/callback', 'http://127.0.0.1:8765/callback'])(
    'connects Claude Code on whatever loopback port it picked (%s)',
    async callback => {
      const { principal } = await connectLikeClaude(CLAUDE_CODE_ID, callback);
      expect(principal).toBeTruthy();
    }
  );

  it('still refuses a loopback path or host the document does not list', async () => {
    for (const callback of [
      'http://localhost:53172/other',
      'http://localhost.evil.example/callback',
    ]) {
      const { authorized } = await connectLikeClaude(CLAUDE_CODE_ID, callback);
      expect(authorized.status).toBe(400);
      expect(authorized.headers.get('content-type')).toContain('text/html');
    }
  });

  it('accepts a new loopback port for a client that registered itself with another', async () => {
    const registered = await register(
      new Request(`${origin}/oauth/mcp/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude Code',
          redirect_uris: ['http://localhost:8765/callback'],
          token_endpoint_auth_method: 'none',
        }),
      })
    );
    const { client_id } = (await registered.json()) as { client_id: string };
    const { principal } = await connectLikeClaude(client_id, 'http://localhost:40123/callback');
    expect(principal).toBeTruthy();
  });
});
