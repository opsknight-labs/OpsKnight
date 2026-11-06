// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { POST } from '@/app/mcp/route';
import { recordSpans } from '../helpers/fake-tracer';

let stop: () => void = () => undefined;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
  const policy = { enabled: true, writesEnabled: false, requestsPerMinute: 600 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
}, 60000);
afterAll(() => stop());

async function bearer() {
  const scopes = ['incidents:read'];
  const user = await createTestUser({ role: 'USER' });
  const client = await db.mcpClient.create({
    data: { name: 'Tracing client', scopes, redirectUris: ['http://localhost/callback'] },
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
  const token = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(token),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { token, user, client, grant };
}

const call = (token: string | null, name: string) =>
  POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'tracing', version: '1' },
          },
        },
      }),
    })
  );

describe('/mcp request spans', () => {
  it('records one span per request with the bounded labels, and no identity', async () => {
    const recorder = recordSpans();
    stop = recorder.stop;
    const { token, user, client, grant } = await bearer();
    const response = await call(token, 'whoami');
    expect(response.status).toBe(200);
    const span = recorder.spans.at(-1)!;
    expect(recorder.spans).toHaveLength(1);
    expect(span.ended).toBe(1);
    expect(span.attributes).toMatchObject({
      'mcp.method': 'tools/call',
      'mcp.tool': 'whoami',
      'mcp.outcome': 'served',
    });
    expect(span.startAttributes['mcp.request_id']).toBe(response.headers.get('x-request-id'));
    // Neither the person, the assistant nor the connection appears anywhere on the span.
    const everything = JSON.stringify([span.startAttributes, span.attributes]);
    for (const id of [user.id, client.id, grant.id, user.email, token])
      expect(everything).not.toContain(id);
  });

  it('records a refused request too, so failures are visible in a trace', async () => {
    const recorder = recordSpans();
    stop = recorder.stop;
    const response = await call(null, 'whoami');
    expect(response.status).toBe(401);
    expect(recorder.spans).toHaveLength(1);
    expect(recorder.spans[0]).toMatchObject({ ended: 1 });
    expect(recorder.spans[0]!.attributes['mcp.outcome']).toBe('unauthenticated');
  });
});
