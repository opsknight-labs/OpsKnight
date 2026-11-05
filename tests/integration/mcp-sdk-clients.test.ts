// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { sdkHandshake, type LegacyRevision } from '../helpers/mcp-sdk-handshake';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { APP_VERSION } from '@/lib/version';
import { DELETE, GET, POST } from '@/app/mcp/route';

/**
 * CERT-02: a real, published SDK client (not a hand-built envelope) completes the whole handshake
 * at each 2025 revision through the route's own handlers: initialize, tools/list and a tool call. The browser suite repeats this against the
 * built server (tests/e2e/mcp.spec.ts).
 */
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  const policy = { enabled: true, writesEnabled: false, requestsPerMinute: 600, maxOperations: 8 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

const scopes = ['incidents:read', 'services:read'];
async function principal() {
  const user = await createTestUser({ role: 'RESPONDER' });
  const client = await db.mcpClient.create({
    data: { name: 'SDK client', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { user, bearer };
}

/** The route's handlers as the client's fetch, so every byte goes through the real route. */
const methods: string[] = [];
async function route(input: string | URL | Request, init?: RequestInit) {
  const request = new Request(input, init);
  methods.push(request.method);
  if (request.method === 'POST') return POST(request);
  if (request.method === 'DELETE') return DELETE();
  return GET();
}

describe('published SDK client handshakes', () => {
  it.each(['2025-06-18', '2025-11-25'] satisfies LegacyRevision[])(
    'connects at %s, lists tools and calls whoami',
    async revision => {
      const { user, bearer } = await principal();
      methods.length = 0;
      const result = await sdkHandshake({ url: mcpResource(), bearer, revision, fetch: route });
      expect(result.negotiated).toBe(revision);
      expect(result.serverInfo).toMatchObject({ name: 'opsknight', version: APP_VERSION });
      expect(result.toolNames).toEqual(expect.arrayContaining(['whoami', 'read_operation']));
      expect(result.whoami.isError ?? false).toBe(false);
      expect(result.whoami.structuredContent).toMatchObject({ userId: user.id });
      expect(result.sentSessionId).toBe(false);
      // Every message went over POST: the stateless 2025 path needs no session or GET stream.
      expect(methods.filter(method => method === 'POST').length).toBeGreaterThanOrEqual(3);
    }
  );

  it('answers a missing bearer with a resource-metadata challenge, not a protocol error', async () => {
    const response = await POST(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'anonymous', version: '1' },
          },
        }),
      })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('answers a 2025-03-26 initialize with a supported revision or a clean error, never a 500', async () => {
    const { bearer } = await principal();
    const response = await POST(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'older', version: '1' },
          },
        }),
      })
    );
    expect(response.status).toBeLessThan(500);
    const text = await response.text();
    const json = text.includes('data:')
      ? text
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5))
          .join('')
      : text;
    const body = JSON.parse(json) as { result?: { protocolVersion: string }; error?: unknown };
    if (body.result)
      expect(['2025-03-26', '2025-06-18', '2025-11-25']).toContain(body.result.protocolVersion);
    else expect(body.error).toBeTruthy();
  });
});
