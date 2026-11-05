import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { e2eDigest as digest } from '../helpers/mcp-e2e-digest';

/**
 * The credential lifecycle through the BUILT server, with the official SDK client over HTTP: a
 * direct write and its replay, a policy switch hiding the tool, a role change narrowing what a
 * connected client sees on its very next call, refresh-token rotation, reuse detection, and
 * revocation. The OAuth consent flow itself is covered with a real browser in mcp.spec.ts; this
 * file mints the credentials directly so the protocol checks run once, not once per browser.
 *
 * Owned local fixtures only: it refuses any host that is not localhost.
 */

test.describe.configure({ mode: 'serial' });

const db = new PrismaClient();

/** Everything this file creates, removed afterwards so later specs see the database they expect. */
const created = {
  users: [] as string[],
  clients: [] as string[],
  grants: [] as string[],
  services: [] as string[],
  incidents: [] as string[],
};
/** Creates a row and remembers it for cleanUp. */
const track = {
  service: async (args: Parameters<typeof db.service.create>[0]) => {
    const row = await db.service.create(args);
    created.services.push(row.id);
    return row;
  },
  incident: async (args: Parameters<typeof db.incident.create>[0]) => {
    const row = await db.incident.create(args);
    created.incidents.push(row.id);
    return row;
  },
};
async function cleanUp() {
  const attempt = (work: Promise<unknown>) => work.catch(() => undefined);
  await attempt(db.mcpCallLog.deleteMany({ where: { grantId: { in: created.grants } } }));
  await attempt(db.mcpToken.deleteMany({ where: { grantId: { in: created.grants } } }));
  await attempt(db.mcpGrant.deleteMany({ where: { id: { in: created.grants } } }));
  await attempt(db.mcpClient.deleteMany({ where: { id: { in: created.clients } } }));
  await attempt(db.incident.deleteMany({ where: { id: { in: created.incidents } } }));
  await attempt(db.service.deleteMany({ where: { id: { in: created.services } } }));
  await attempt(db.user.deleteMany({ where: { id: { in: created.users } } }));
}

const secret = () => randomBytes(32).toString('base64url');

const SCOPES = ['incidents:read', 'incidents:write', 'services:read', 'schedules:read'];
type Role = 'ADMIN' | 'RESPONDER' | 'USER';

async function connection(origin: string, role: Role) {
  const tag = randomBytes(4).toString('hex');
  const user = await db.user.create({
    data: {
      email: `lifecycle-${tag}@example.test`,
      name: `[MCP-E2E] lifecycle ${tag}`,
      passwordHash: 'not-a-login',
      role,
      status: 'ACTIVE',
    },
  });
  const client = await db.mcpClient.create({
    data: {
      name: `[MCP-E2E] lifecycle client ${tag}`,
      scopes: SCOPES,
      redirectUris: ['http://127.0.0.1:8799/callback'],
    },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes: SCOPES,
      resource: `${origin}/mcp`,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const access = secret();
  const refresh = secret();
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes: SCOPES,
      accessHash: digest(access),
      refreshHash: digest(refresh),
      accessExpiresAt: new Date(Date.now() + 300_000),
      refreshExpiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  created.users.push(user.id);
  created.clients.push(client.id);
  created.grants.push(grant.id);
  return { user, client, grant, access, refresh };
}

async function open(origin: string, bearer: string) {
  const client = new Client({ name: 'opsknight-lifecycle', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    })
  );
  return client;
}
const textOf = (result: unknown) =>
  JSON.stringify((result as { content?: unknown }).content ?? result);

async function setPolicy(data: { writesEnabled: boolean }) {
  const policy = { enabled: true, requestsPerMinute: 6000, ...data };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
}

let origin = '';
let previousPolicy: { enabled: boolean; writesEnabled: boolean; requestsPerMinute: number } | null =
  null;

test.beforeAll(async ({ baseURL }) => {
  origin = baseURL!;
  // Owned local fixtures only; this never accepts live credentials.
  expect(['localhost', '127.0.0.1']).toContain(new URL(origin).hostname);
  const existing = await db.mcpPolicy.findUnique({ where: { id: 'default' } });
  previousPolicy = existing && {
    enabled: existing.enabled,
    writesEnabled: existing.writesEnabled,
    requestsPerMinute: existing.requestsPerMinute,
  };
});
test.afterAll(async () => {
  // One ordered hook: put the policy back exactly as it was (restored if it existed, removed if
  // this file made it), remove what the tests created, then disconnect.
  if (previousPolicy) await db.mcpPolicy.update({ where: { id: 'default' }, data: previousPolicy });
  else await db.mcpPolicy.deleteMany({ where: { id: 'default' } }).catch(() => undefined);
  await cleanUp();
  await db.$disconnect();
});
test.beforeEach(({ browserName }) => {
  // Protocol behaviour does not depend on the browser; run it once.
  test.skip(browserName !== 'chromium', 'protocol checks run once');
});

test('an unauthenticated call is told where to sign in, not what exists', async ({ request }) => {
  await setPolicy({ writesEnabled: true });
  const response = await request.post('/mcp', {
    headers: { accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(response.status()).toBe(401);
  expect(response.headers()['www-authenticate']).toMatch(/resource_metadata=/);
  expect(await response.text()).not.toMatch(/incident_search|whoami/);
});

test('a direct write works through the SDK client and a replay does not repeat it', async () => {
  await setPolicy({ writesEnabled: true });
  const { user, access } = await connection(origin, 'ADMIN');
  const service = await track.service({
    data: { name: `[MCP-E2E] svc ${randomBytes(3).toString('hex')}` },
  });
  const incident = await track.incident({
    data: {
      title: '[MCP-E2E] write target',
      serviceId: service.id,
      status: 'OPEN',
      urgency: 'HIGH',
    },
  });
  const client = await open(origin, access);
  try {
    const tools = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of [
      'whoami',
      'incident_search',
      'incident_acknowledge',
      'oncall_now',
      'service_get_changes',
    ])
      expect(tools, name).toContain(name);
    const me = (await client.callTool({ name: 'whoami', arguments: {} })) as {
      structuredContent?: { userId?: string };
    };
    expect(me.structuredContent?.userId).toBe(user.id);

    const key = `lifecycle-${randomBytes(8).toString('hex')}`;
    const args = { path: { id: incident.id }, body: {}, idempotencyKey: key };
    const first = await client.callTool({ name: 'incident_acknowledge', arguments: args });
    expect((first as { isError?: boolean }).isError ?? false).toBe(false);
    const acknowledged = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(acknowledged.status).toBe('ACKNOWLEDGED');
    const events = await db.incidentEvent.count({ where: { incidentId: incident.id } });

    const replay = await client.callTool({ name: 'incident_acknowledge', arguments: args });
    expect((replay as { isError?: boolean }).isError ?? false).toBe(false);
    // Same key, same outcome, no second event.
    expect(await db.incidentEvent.count({ where: { incidentId: incident.id } })).toBe(events);
  } finally {
    await client.close();
  }
});

test('turning changes off hides the write tool and refuses the call on the next request', async () => {
  await setPolicy({ writesEnabled: true });
  const { access } = await connection(origin, 'ADMIN');
  const client = await open(origin, access);
  try {
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain(
      'incident_acknowledge'
    );
    await setPolicy({ writesEnabled: false });
    expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain(
      'incident_acknowledge'
    );
    const service = await track.service({
      data: { name: `[MCP-E2E] off ${randomBytes(3).toString('hex')}` },
    });
    const incident = await track.incident({
      data: {
        title: '[MCP-E2E] must stay open',
        serviceId: service.id,
        status: 'OPEN',
        urgency: 'HIGH',
      },
    });
    const refused = await client
      .callTool({
        name: 'incident_acknowledge',
        arguments: {
          path: { id: incident.id },
          body: {},
          idempotencyKey: `off-${randomBytes(8).toString('hex')}`,
        },
      })
      .then(
        result => (result as { isError?: boolean }).isError === true,
        () => true
      );
    expect(refused).toBe(true);
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'OPEN'
    );
  } finally {
    await client.close();
    await setPolicy({ writesEnabled: true });
  }
});

test('a role change narrows what a connected client sees on its very next call', async () => {
  await setPolicy({ writesEnabled: false });
  const { user, access } = await connection(origin, 'RESPONDER');
  const tag = randomBytes(3).toString('hex');
  const service = await track.service({ data: { name: `[MCP-E2E] scope ${tag}` } });
  const mine = await track.incident({
    data: {
      title: `[MCP-E2E] mine ${tag}`,
      serviceId: service.id,
      assigneeId: user.id,
      urgency: 'HIGH',
    },
  });
  const other = await track.incident({
    data: { title: `[MCP-E2E] not mine ${tag}`, serviceId: service.id, urgency: 'HIGH' },
  });
  const client = await open(origin, access);
  try {
    const titles = async () =>
      textOf(
        await client.callTool({
          name: 'incident_search',
          arguments: { query: { search: `[MCP-E2E]`, limit: 50 } },
        })
      );
    const before = await titles();
    expect(before).toContain(mine.id);
    expect(before).toContain(other.id);
    // Demoted while connected: no reconnect, no new token.
    await db.user.update({ where: { id: user.id }, data: { role: 'USER' } });
    const after = await titles();
    expect(after).toContain(mine.id);
    expect(after).not.toContain(other.id);
  } finally {
    await client.close();
  }
});

test('refresh rotates the token, retires the old one, and replaying it revokes the grant', async ({
  request,
}) => {
  await setPolicy({ writesEnabled: false });
  const { client: oauthClient, grant, access, refresh } = await connection(origin, 'RESPONDER');
  const refreshWith = (token: string) =>
    request.post('/oauth/mcp/token', {
      form: {
        grant_type: 'refresh_token',
        client_id: oauthClient.id,
        refresh_token: token,
        resource: `${origin}/mcp`,
      },
    });

  const rotated = await refreshWith(refresh);
  expect(rotated.status()).toBe(200);
  const next = (await rotated.json()) as { access_token: string; refresh_token: string };
  expect(next.access_token).not.toBe(access);
  expect(next.refresh_token).not.toBe(refresh);

  // The new token works; the one it replaced is retired immediately.
  const fresh = await open(origin, next.access_token);
  try {
    expect(textOf(await fresh.callTool({ name: 'whoami', arguments: {} }))).toBeTruthy();
    const stale = await request.post('/mcp', {
      headers: {
        authorization: `Bearer ${access}`,
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(stale.status()).toBe(401);

    // Replaying the already-used refresh token after its successor was used is theft: the whole
    // grant ends, including the token that was just issued.
    const replay = await refreshWith(refresh);
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    expect(
      (await db.mcpGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt
    ).not.toBeNull();
    expect(
      await db.auditLog.count({ where: { action: 'mcp.grant.reuse_detected', entityId: grant.id } })
    ).toBe(1);
    await expect(fresh.callTool({ name: 'whoami', arguments: {} })).rejects.toThrow();
  } finally {
    await fresh.close().catch(() => undefined);
  }
});

test('revoking a connection ends it on the next request', async ({ request }) => {
  await setPolicy({ writesEnabled: false });
  const { grant, access } = await connection(origin, 'RESPONDER');
  const client = await open(origin, access);
  try {
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await db.mcpGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    // The connected client's very next request fails…
    await expect(client.listTools()).rejects.toThrow();
  } finally {
    await client.close().catch(() => undefined);
  }
  // …and so does a fresh one with the same token: nothing lingers.
  const again = await request.post('/mcp', {
    headers: {
      authorization: `Bearer ${access}`,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(again.status()).toBe(401);
});
