// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource, resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';
import { resetMcpAdmissionForTests } from '@/lib/mcp/auth/admission';
import { clearDiscoveryPolicyCache } from '@/lib/mcp/auth/discovery-policy';
import { POST, OPTIONS } from '@/app/mcp/route';
import { POST as token, OPTIONS as tokenPreflight } from '@/app/oauth/mcp/token/route';
import { POST as register } from '@/app/oauth/mcp/register/route';
import {
  GET as protectedResource,
  OPTIONS as protectedResourcePreflight,
} from '@/app/.well-known/oauth-protected-resource/mcp/route';
import { GET as authorizationServer } from '@/app/.well-known/oauth-authorization-server/oauth/mcp/route';
import {
  GET as rootProtectedResource,
  OPTIONS as rootProtectedResourcePreflight,
} from '@/app/.well-known/oauth-protected-resource/route';

// Records what the route hands the SDK per request, then serves it unchanged.
const sdkCalls = vi.hoisted(() => [] as { authInfo?: { scopes: string[]; clientId: string } }[]);
vi.mock('@modelcontextprotocol/server', async importOriginal => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/server')>();
  return {
    ...actual,
    createMcpHandler: (...args: Parameters<typeof actual.createMcpHandler>) => {
      const handler = actual.createMcpHandler(...args);
      return {
        ...handler,
        fetch: (request: Request, options?: Parameters<typeof handler.fetch>[1]) => {
          sdkCalls.push(options as (typeof sdkCalls)[number]);
          return handler.fetch(request, options);
        },
        close: () => handler.close(),
      };
    },
  };
});

const origin = 'http://localhost:3000';
const inspector = 'http://localhost:6274';
const scopes = ['incidents:read', 'services:read'];

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = origin;
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);

const basePolicy = {
  enabled: true,
  dcrEnabled: true,
  dcrScopes: scopes,
  cimdEnabled: true,
  cimdScopes: ['incidents:read'],
  requestsPerMinute: 600,
  allowedBrowserOrigins: [] as string[],
  scopeStepUpEnabled: false,
};
beforeEach(async () => {
  resetMcpRuntimeForTests();
  resetMcpAdmissionForTests();
  clearDiscoveryPolicyCache();
  await db.rateLimit.deleteMany({});
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: basePolicy, update: basePolicy });
});

async function bearerFor(grantScopes = scopes, clientScopes = grantScopes) {
  const user = await createTestUser({ role: 'ADMIN' });
  const client = await db.mcpClient.create({
    data: { name: 'Edges', scopes: clientScopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes: grantScopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes: grantScopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { bearer, user, client, grant };
}

function mcp(headers: Record<string, string>, body?: unknown) {
  return POST(
    new Request(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
        ...headers,
      },
      body: JSON.stringify(body ?? { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
  );
}

describe('INT-10: a request with no token', () => {
  it('gets a plain challenge with the first-connection scopes and no error code', async () => {
    const response = await mcp({});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'MCP_TOKEN_REQUIRED' });
    const challenge = response.headers.get('www-authenticate')!;
    expect(challenge).not.toContain('error=');
    expect(challenge).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
    );
    // The registration ceiling, not the union with the metadata-document ceiling.
    expect(challenge).toContain('scope="incidents:read services:read"');
  });

  it('falls back to the metadata-document ceiling when registration is off', async () => {
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { dcrEnabled: false } });
    clearDiscoveryPolicyCache();
    const challenge = (await mcp({})).headers.get('www-authenticate')!;
    expect(challenge).toContain('scope="incidents:read"');
  });

  it('keeps invalid_token, now with the scope hint, for a bad token', async () => {
    const response = await mcp({ authorization: `Bearer ${'x'.repeat(43)}` });
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate')!;
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain('scope="incidents:read services:read"');
  });

  it('is never counted by the bad-token limiter', async () => {
    const { bearer } = await bearerFor();
    const peer = { 'x-forwarded-for': '203.0.113.9' };
    for (let index = 0; index < 31; index += 1) expect((await mcp(peer)).status).toBe(401);
    expect((await mcp({ ...peer, authorization: `Bearer ${bearer}` })).status).toBe(200);
    // The limiter does see this peer: unknown tokens still count.
    for (let index = 0; index < 31; index += 1)
      await mcp({ ...peer, authorization: `Bearer ${'y'.repeat(43)}` });
    expect((await mcp({ ...peer, authorization: `Bearer ${bearer}` })).status).toBe(429);
  });
});

describe('INT-02: browser-hosted clients', () => {
  it('still refuses a foreign Origin that is not allowed', async () => {
    const { bearer } = await bearerFor();
    const response = await mcp({ authorization: `Bearer ${bearer}`, origin: inspector });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await OPTIONS(
      new Request(`${origin}/mcp`, { method: 'OPTIONS', headers: { origin: inspector } })
    );
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves an allowed Origin with CORS headers and never allows credentials', async () => {
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { allowedBrowserOrigins: [inspector] },
    });
    clearDiscoveryPolicyCache();
    const { bearer } = await bearerFor();
    const response = await mcp({ authorization: `Bearer ${bearer}`, origin: inspector });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(inspector);
    expect(response.headers.get('vary')).toContain('Origin');
    expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    // The 401 challenge is readable too, so the page can start sign-in.
    const challenge = await mcp({ origin: inspector });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('access-control-allow-origin')).toBe(inspector);
    const preflight = await OPTIONS(
      new Request(`${origin}/mcp`, { method: 'OPTIONS', headers: { origin: inspector } })
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Mcp-Protocol-Version');
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
    // A different origin on the same server is still refused.
    expect(
      (await mcp({ authorization: `Bearer ${bearer}`, origin: 'http://evil.test' })).status
    ).toBe(403);
  });

  it('covers the token and registration endpoints for an allowed Origin', async () => {
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { allowedBrowserOrigins: [inspector] },
    });
    clearDiscoveryPolicyCache();
    const registered = await register(
      new Request(`${origin}/oauth/mcp/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: inspector },
        body: JSON.stringify({ redirect_uris: [`${inspector}/oauth/callback`] }),
      })
    );
    expect(registered.status).toBe(201);
    expect(registered.headers.get('access-control-allow-origin')).toBe(inspector);
    const refused = await token(
      new Request(`${origin}/oauth/mcp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: inspector },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'x',
          refresh_token: 'y',
        }),
      })
    );
    expect(refused.status).not.toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBe(inspector);
    const preflight = await tokenPreflight(
      new Request(`${origin}/oauth/mcp/token`, {
        method: 'OPTIONS',
        headers: { origin: inspector },
      })
    );
    expect(preflight.status).toBe(204);
  });

  it('lets any page read the public discovery documents', async () => {
    expect((await protectedResource()).headers.get('access-control-allow-origin')).toBe('*');
    expect((await authorizationServer()).headers.get('access-control-allow-origin')).toBe('*');
    const preflight = protectedResourcePreflight();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
    // Clients fall back to the root path; a page sending MCP-Protocol-Version preflights it too.
    expect((await rootProtectedResource()).headers.get('access-control-allow-origin')).toBe('*');
    const rootPreflight = rootProtectedResourcePreflight();
    expect(rootPreflight.status).toBe(204);
    expect(rootPreflight.headers.get('access-control-allow-headers')).toContain(
      'Mcp-Protocol-Version'
    );
  });
});

describe('SEC-12: discovery metadata is memoised', () => {
  it('serves repeated requests from memory and sees a cleared change at once', async () => {
    await authorizationServer();
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { dcrEnabled: false } });
    // Still the memoised policy: no read per anonymous request.
    expect((await (await authorizationServer()).json()).registration_endpoint).toBeDefined();
    clearDiscoveryPolicyCache();
    expect((await (await authorizationServer()).json()).registration_endpoint).toBeUndefined();
  });
});

describe('D2: step-up consent', () => {
  const getIncident = (name = 'incident_get', args: unknown = { id: 'missing-incident' }) => ({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const enableStepUp = () =>
    db.mcpPolicy.update({ where: { id: 'default' }, data: { scopeStepUpEnabled: true } });

  it('answers a grantable missing permission with 403 insufficient_scope', async () => {
    await enableStepUp();
    const { bearer } = await bearerFor(['services:read'], ['services:read', 'incidents:read']);
    for (const body of [
      getIncident(),
      getIncident('call_operation', { operationId: 'getIncident', args: { path: { id: 'x' } } }),
      getIncident('execute_plan', {
        steps: [{ operationId: 'getIncident', args: { path: { id: 'x' } } }],
      }),
    ]) {
      const response = await mcp({ authorization: `Bearer ${bearer}` }, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'MCP_INSUFFICIENT_SCOPE' });
      const challenge = response.headers.get('www-authenticate')!;
      expect(challenge).toContain('error="insufficient_scope"');
      // What the connection has plus what the call needs.
      expect(challenge).toContain('scope="services:read incidents:read"');
      expect(challenge).toContain(
        `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
      );
    }
  });

  it('stays a tool error while the switch is off (the default)', async () => {
    const { bearer } = await bearerFor(['services:read'], ['services:read', 'incidents:read']);
    const response = await mcp({ authorization: `Bearer ${bearer}` }, getIncident());
    expect(response.status).toBe(200);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('does not challenge for a permission a new consent could not grant', async () => {
    await enableStepUp();
    // The assistant's ceiling lacks incidents:read: reconnecting would not help.
    const { bearer } = await bearerFor(['services:read']);
    expect((await mcp({ authorization: `Bearer ${bearer}` }, getIncident())).status).toBe(200);
    // An administrator-disabled capability is refused whatever the consent.
    const second = await bearerFor(['services:read'], ['services:read', 'incidents:read']);
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { disabledCapabilities: ['getIncident'] },
    });
    expect((await mcp({ authorization: `Bearer ${second.bearer}` }, getIncident())).status).toBe(
      200
    );
    // A granted call and discovery pass through.
    expect((await mcp({ authorization: `Bearer ${second.bearer}` })).status).toBe(200);
  });

  it('hands the SDK the authenticated token facts as authInfo', async () => {
    const { bearer, client } = await bearerFor();
    sdkCalls.length = 0;
    expect((await mcp({ authorization: `Bearer ${bearer}` })).status).toBe(200);
    expect(sdkCalls.at(-1)?.authInfo).toMatchObject({
      token: bearer,
      clientId: client.id,
      scopes,
      resource: new URL(mcpResource()),
    });
  });
});
