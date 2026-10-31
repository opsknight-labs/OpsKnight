import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { GET as authorize } from '@/app/oauth/mcp/authorize/route';
import { POST as exchange } from '@/app/oauth/mcp/token/route';
import { resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';
import { DEFAULT_ASSISTANT_SCOPES } from '@/lib/mcp/auth/client-policy';

const CLAUDE_CODE_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
const CALLBACK = 'http://localhost:51505/callback';
vi.mock('@/lib/mcp/auth/cimd-transport', async original => ({
  ...(await original<typeof import('@/lib/mcp/auth/cimd-transport')>()),
  fetchPinnedMetadata: vi.fn(async () => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      client_id: CLAUDE_CODE_ID,
      client_name: 'Claude Code',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })),
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', async original => {
  const real = await original<typeof import('@/lib/logger')>();
  return { ...real, logger: { ...real.logger, warn } };
});
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
const verifier = randomBytes(32).toString('base64url');

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
  warn.mockClear();
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'mcp:' } } });
  await db.mcpConsentRequest.deleteMany();
  await db.mcpGrant.deleteMany();
  await db.mcpClient.deleteMany();
  await db.mcpPolicy.deleteMany();
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
  const user = await createTestUser({ role: 'ADMIN' });
  actor.id = user.id;
  actor.tokenVersion = user.tokenVersion;
});

function authorizeQuery(extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLAUDE_CODE_ID,
    redirect_uri: CALLBACK,
    scope: 'incidents:read',
    state: randomBytes(24).toString('base64url'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...extra,
  });
}
const call = (query: URLSearchParams) =>
  authorize(new Request(`${origin}/oauth/mcp/authorize?${query}`));
const reference = async (response: Response) =>
  /Reference: ([A-Za-z_]+)/.exec(await response.text())?.[1];

describe('OAuth requests from real assistants', () => {
  it('ignores standard and unknown extra authorize parameters (RFC 6749 §3.1)', async () => {
    const response = await call(
      authorizeQuery({
        prompt: 'consent',
        login_hint: 'someone@example.com',
        nonce: 'n-0S6_WzA2Mj',
        ui_locales: 'en',
        vendor_extension: 'x',
      })
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/oauth/mcp/consent');
  });

  it('says the assistant is not allowed, never "unavailable", when automatic connections are off', async () => {
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { dcrEnabled: false, cimdEnabled: false },
    });
    const response = await call(authorizeQuery());
    expect(await reference(response)).toBe('invalid_client');
    expect(response.status).not.toBe(503);
    expect(warn).toHaveBeenCalledWith(
      'mcp.cimd.client_denied',
      expect.objectContaining({ reason: 'automatic_connections_off' })
    );
  });

  it('reports a malformed request as a bad request and logs which fields were wrong', async () => {
    const query = authorizeQuery();
    query.delete('code_challenge');
    const response = await call(query);
    expect(response.status).toBe(400);
    expect(await reference(response)).toBe('invalid_request');
    expect(warn).toHaveBeenCalledWith('mcp.authorize.invalid_request', {
      fields: ['code_challenge'],
    });
  });

  it('ignores unknown token request parameters', async () => {
    const response = await call(authorizeQuery());
    const consent = new URL(response.headers.get('location')!);
    const { decideMcpConsent } = await import('@/app/(app)/settings/integrations/mcp/actions');
    const form = new FormData();
    form.set('id', consent.searchParams.get('id')!);
    form.set('decision', 'allow');
    form.append('scope', 'incidents:read');
    actor.location = '';
    await decideMcpConsent(form);
    const code = new URL(actor.location).searchParams.get('code')!;
    const token = await exchange(
      new Request(`${origin}/oauth/mcp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLAUDE_CODE_ID,
          code,
          code_verifier: verifier,
          redirect_uri: CALLBACK,
          vendor_extension: 'x',
        }),
      })
    );
    expect(token.status).toBe(200);
  });
});
