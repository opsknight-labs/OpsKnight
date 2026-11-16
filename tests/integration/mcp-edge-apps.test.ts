// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { POST } from '@/app/mcp/route';

const APPS = 'io.modelcontextprotocol/ui';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  await resetDatabase();
}, 300000);
beforeEach(async () => {
  const policy = { enabled: true, writesEnabled: false, requestsPerMinute: 600, maxOperations: 8 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

async function principal(role: 'ADMIN' | 'RESPONDER' | 'USER', scopes: string[]) {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'Skills', scopes, redirectUris: ['http://localhost/callback'] },
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

let rpcId = 0;
async function rpc(
  bearer: string,
  method: string,
  params: Record<string, unknown> = {},
  extensions: Record<string, unknown> = { [APPS]: { mimeTypes: ['text/html;profile=mcp-app'] } }
) {
  const response = await POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.uri === 'string' ? { 'mcp-name': params.uri } : {}),
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': { extensions },
            'io.modelcontextprotocol/clientInfo': { name: 'skills', version: '1' },
          },
        },
      }),
    })
  );
  const text = await response.text();
  const data = text.startsWith('{')
    ? text
    : text
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('');
  return JSON.parse(data) as {
    result?: Record<string, unknown> & {
      skills?: { uri: string; frontmatter: { name: string } }[];
      contents?: { text?: string; mimeType?: string; _meta?: unknown }[];
      tools?: { name: string; _meta?: { ui?: { resourceUri?: string } } }[];
    };
    error?: { code: number; message: string };
  };
}

const VIEWS: Record<string, string> = {
  incident_get: 'ui://opsknight/incident-card.html',
  incident_get_context: 'ui://opsknight/incident-card.html',
  oncall_now: 'ui://opsknight/oncall-now.html',
  operation_prepare: 'ui://opsknight/approval-card.html',
  operation_get_approval: 'ui://opsknight/approval-card.html',
};
const ALL = ['incidents:read', 'incidents:write', 'schedules:read', 'services:read'];

describe('MCP Apps views', () => {
  it('links the views from their tools only for a client that declared MCP Apps', async () => {
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: true } });
    const admin = await principal('ADMIN', ALL);
    const plain = await rpc(admin.bearer, 'tools/list', {}, {});
    expect(plain.result?.tools?.length).toBeGreaterThan(5);
    expect(JSON.stringify(plain.result)).not.toContain('ui://');
    expect(
      JSON.stringify((await rpc(admin.bearer, 'server/discover', {}, {})).result)
    ).not.toContain(APPS);

    const apps = await rpc(admin.bearer, 'tools/list');
    const linked = Object.fromEntries(
      (apps.result?.tools ?? [])
        .filter(tool => tool._meta?.ui?.resourceUri)
        .map(tool => [tool.name, tool._meta!.ui!.resourceUri])
    );
    expect(linked).toEqual(VIEWS);
    // Everything else about tools/list is the same for both clients.
    const strip = (tools: { name: string; _meta?: Record<string, unknown> }[] = []) =>
      tools.map(({ _meta, ...tool }) => {
        const rest = Object.entries(_meta ?? {}).filter(([key]) => key !== 'ui');
        return rest.length ? { ...tool, _meta: Object.fromEntries(rest) } : tool;
      });
    expect(strip(apps.result?.tools)).toEqual(strip(plain.result?.tools));
    expect(JSON.stringify((await rpc(admin.bearer, 'server/discover')).result)).toContain(APPS);
  });

  it('serves each view as an MCP App resource', async () => {
    const admin = await principal('ADMIN', ALL);
    for (const uri of new Set(Object.values(VIEWS))) {
      const read = await rpc(admin.bearer, 'resources/read', { uri });
      const content = read.result?.contents?.[0];
      expect(content?.mimeType).toBe('text/html;profile=mcp-app');
      expect(content?.text).toMatch(/^<!doctype html>/);
      expect(content?.text).toContain("connect-src 'none'");
    }
    const unsupported = await rpc(admin.bearer, 'resources/read', { uri: VIEWS.incident_get }, {});
    expect(unsupported.error).toBeDefined();
  });

  it('is not served to a client whose MCP Apps MIME types exclude ours', async () => {
    const admin = await principal('ADMIN', ALL);
    const other = await rpc(
      admin.bearer,
      'tools/list',
      {},
      { [APPS]: { mimeTypes: ['text/x-other'] } }
    );
    expect(JSON.stringify(other.result)).not.toContain('ui://');
  });
});
