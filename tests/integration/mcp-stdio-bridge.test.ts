// @vitest-environment node
// The stdio bridge (sdk/mcp-bridge) as a child process against the real /mcp route handler,
// served in-process over node:http with a seeded personal access token.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { startBridge } from '../helpers/mcp-bridge-process';
import { POST } from '@/app/mcp/route';
import { mcpResource, resetMcpRuntimeForTests } from '@/lib/mcp/auth/config';
import { createMcpPersonalToken } from '@/lib/mcp/auth/personal-tokens';

const origin = 'http://localhost:3000';
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (typeof value === 'string' && !['host', 'connection'].includes(name))
      headers.set(name, value);
  const response = await POST(
    new Request(mcpResource(), { method: req.method, headers, body: Buffer.concat(chunks) })
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body as never).pipe(res);
  else res.end();
});
let base = '';
let token = '';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local PostgreSQL required');
  process.env.MCP_PUBLIC_ORIGIN = origin;
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  delete process.env.ENCRYPTION_KEYS;
  await resetDatabase();
  resetMcpRuntimeForTests();
  await db.mcpPolicy.create({
    data: {
      id: 'default',
      enabled: true,
      requestsPerMinute: 600,
      patEnabled: true,
      patMaxDays: 30,
      patAllowedScopes: ['incidents:read'],
    },
  });
  const user = await createTestUser({ role: 'ADMIN' });
  const created = await db.$transaction(tx =>
    createMcpPersonalToken(
      tx,
      { label: 'bridge', scopes: ['incidents:read'], expiresInDays: 30 },
      { id: user.id, tokenVersion: user.tokenVersion, authenticatedAt: Date.now() }
    )
  );
  if (!created.ok) throw new Error(`token not created: ${created.code}`);
  token = created.token;
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60000);
afterAll(() => {
  server.closeAllConnections();
  return new Promise(done => server.close(done));
});

describe('stdio bridge against the real /mcp route', () => {
  it('initializes, lists tools and calls whoami with a personal access token', async () => {
    const bridge = startBridge(['--url', base], { OPSKNIGHT_TOKEN: token });
    bridge.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'bridge-test', version: '1' },
      },
    });
    expect((await bridge.waitFor(m => m.id === 1)).result?.protocolVersion).toBe('2025-11-25');
    bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    bridge.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    });
    const tools = await bridge.waitFor(m => m.id === 2);
    expect((tools.result?.tools as { name: string }[]).map(tool => tool.name)).toContain('whoami');
    const whoami = await bridge.waitFor(m => m.id === 3);
    expect(whoami.error).toBeUndefined();
    expect(whoami.result?.isError).toBeFalsy();
    // A 2026-07-28 request through the same bridge: the _meta version drives the headers.
    bridge.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'whoami',
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'bridge-test', version: '1' },
        },
      },
    });
    const modern = await bridge.waitFor(m => m.id === 4);
    expect(modern.error).toBeUndefined();
    expect(modern.result?.isError).toBeFalsy();
    expect(await bridge.close()).toBe(0);
    expect(bridge.output()).not.toContain(token);
  });

  it('answers a revoked token with a clear JSON-RPC error', async () => {
    const bridge = startBridge(['--url', base], { OPSKNIGHT_TOKEN: `${token}x` });
    bridge.send({ jsonrpc: '2.0', id: 'r', method: 'tools/list' });
    expect((await bridge.waitFor(m => m.id === 'r')).error?.message).toMatch(/HTTP 401/);
    await bridge.close();
  });
});
