import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectPrisma } from '@/lib/prisma';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { POST } from '@/app/mcp/route';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

let accessToken: string;
let incidentId: string;

beforeAll(async () => {
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_DATABASE_POOL_SIZE = '2';
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  await resetDatabase();
  await db.mcpPolicy.create({
    data: { enabled: true, writesEnabled: false, requestsPerMinute: 600 },
  });
  const user = await createTestUser({ role: 'ADMIN' });
  const scopes = ['incidents:read', 'services:read'];
  const client = await db.mcpClient.create({
    data: { name: 'Efficiency', redirectUris: ['http://localhost/callback'], scopes },
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
  accessToken = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(accessToken),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  const service = await createTestService('Efficiency service');
  for (let index = 0; index < 25; index++) {
    const incident = await createTestIncident(`Efficiency incident ${index}`, service.id);
    if (index === 0) incidentId = incident.id;
  }
  for (let index = 0; index < 3; index++)
    await db.incidentEvent.create({ data: { incidentId, message: `Event ${index}` } });
}, 60000);

afterAll(async () => {
  await disconnectPrisma();
  await db.$disconnect();
});

async function call(name: string, args: Record<string, unknown>) {
  const response = await POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
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
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'efficiency', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()).result as {
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown> & {
      data?: { data?: unknown[] };
      evidence?: { limits?: { pageSize: number } };
    };
  };
}

describe('MCP page size evidence', () => {
  it('applies the advertised default and reports the page size actually applied', async () => {
    const defaulted = await call('incident_search', {});
    expect(defaulted.isError).not.toBe(true);
    expect(defaulted.structuredContent!.data!.data).toHaveLength(20);
    expect(defaulted.structuredContent!.evidence!.limits).toEqual({ pageSize: 20 });
    const explicit = await call('incident_search', { query: { limit: 5 } });
    expect(explicit.structuredContent!.data!.data).toHaveLength(5);
    expect(explicit.structuredContent!.evidence!.limits).toEqual({ pageSize: 5 });
    const item = await call('incident_get', { path: { id: incidentId } });
    expect(item.structuredContent!.evidence!.limits).toBeUndefined();
  });
});
