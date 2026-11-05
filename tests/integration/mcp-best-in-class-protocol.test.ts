import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { pollChanges, resetSubscriptionStateForTests } from '@/lib/mcp/protocol/subscriptions';
import {
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
} from '@/lib/metrics/operational/registry';
import { DELETE, GET, POST } from '@/app/mcp/route';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);
const basePolicy = {
  enabled: true,
  writesEnabled: true,
  requestsPerMinute: 600,
  maxOperations: 8,
  disabledCapabilities: [] as string[],
};
beforeEach(async () => {
  resetSubscriptionStateForTests();
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: basePolicy, update: basePolicy });
});
afterEach(() => resetSubscriptionStateForTests());

const scopes = ['incidents:read', 'incidents:write', 'services:read', 'schedules:read'];
async function principal(role: 'ADMIN' | 'USER' = 'ADMIN') {
  const user = await createTestUser({ role, name: 'Grace Hopper' });
  const client = await db.mcpClient.create({
    data: { name: 'Best in class', scopes, redirectUris: ['http://localhost/callback'] },
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
  return { user, grant, bearer };
}

let rpcId = 0;
const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'best-in-class', version: '1' },
};
function modern(
  bearer: string,
  method: string,
  params: Record<string, unknown> = {},
  { notification = false } = {}
) {
  return POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(notification ? {} : { id: ++rpcId }),
        method,
        params: { ...params, _meta: MODERN_META },
      }),
    })
  );
}
async function tool(bearer: string, name: string, args: Record<string, unknown>) {
  const response = await modern(bearer, 'tools/call', { name, arguments: args });
  expect(response.status).toBe(200);
  return { response, result: (await response.json()).result };
}

/** A 2025-revision client: no envelope, the negotiated version in the header after initialize. */
function legacy(
  bearer: string,
  version: string,
  message: { method: string; params?: Record<string, unknown>; id?: number }
) {
  return POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(message.method === 'initialize' ? {} : { 'mcp-protocol-version': version }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    })
  );
}
/** A stateless legacy reply may be JSON or a single SSE message. */
async function reply(response: Response) {
  const text = await response.text();
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream'))
    return JSON.parse(text);
  const data = text
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim());
  return JSON.parse(data.at(-1)!);
}
const quotaUsed = async (grantId: string) =>
  (
    await db.rateLimit.aggregate({
      where: { key: { startsWith: `mcp:${grantId}:` } },
      _sum: { count: true },
    })
  )._sum.count ?? 0;

describe('A1: 2025-revision clients and notifications', () => {
  it.each(['2025-06-18', '2025-11-25'])(
    'serves initialize, notifications, tools/list and tools/call to a %s client',
    async version => {
      const { bearer, user, grant } = await principal();
      const init = await legacy(bearer, version, {
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: 'legacy-client', version: '1' },
        },
      });
      expect(init.status).toBe(200);
      const initialized = await reply(init);
      expect(initialized.result.protocolVersion).toBe(version);
      expect(initialized.result.serverInfo.name).toBe('opsknight');
      expect(initialized.result.instructions).toContain('whoami');
      const charged = await quotaUsed(grant.id);
      const notified = await legacy(bearer, version, { method: 'notifications/initialized' });
      expect(notified.status).toBe(202);
      expect(await notified.text()).toBe('');
      // A notification does no work, so it is never charged against the quota.
      expect(await quotaUsed(grant.id)).toBe(charged);
      const list = await reply(await legacy(bearer, version, { id: 2, method: 'tools/list' }));
      const names = (list.result.tools as { name: string }[]).map(item => item.name);
      expect(names).toEqual(expect.arrayContaining(['whoami', 'read_operation', 'incident_get']));
      const whoami = await reply(
        await legacy(bearer, version, {
          id: 3,
          method: 'tools/call',
          params: { name: 'whoami', arguments: {} },
        })
      );
      expect(whoami.result.isError).not.toBe(true);
      expect(whoami.result.structuredContent.userId).toBe(user.id);
    }
  );

  it('acknowledges a modern notification with 202 before any charge', async () => {
    const { bearer, grant } = await principal();
    const before = await quotaUsed(grant.id);
    const response = await modern(
      bearer,
      'notifications/cancelled',
      { requestId: 7, reason: 'user' },
      { notification: true }
    );
    expect(response.status).toBe(202);
    expect(await quotaUsed(grant.id)).toBe(before);
  });

  it('answers session GET and DELETE with 405', async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });
});

describe('A2: whoami and "me"', () => {
  it('returns the caller identity and resolves assigneeId "me" to the caller', async () => {
    const { bearer, user } = await principal();
    const team = await createTestTeam('Mine team');
    const service = await createTestService('Mine service', team.id);
    const mine = await createTestIncident('Mine', service.id, { assigneeId: user.id });
    const theirs = await createTestIncident('Theirs', service.id);
    await db.user.update({ where: { id: user.id }, data: { timeZone: 'Asia/Kolkata' } });
    await db.teamMember.create({ data: { teamId: team.id, userId: user.id } });
    const { result: whoami } = await tool(bearer, 'whoami', {});
    expect(whoami.structuredContent).toMatchObject({
      userId: user.id,
      displayName: 'Grace Hopper',
      role: 'ADMIN',
      writesEnabled: true,
      timeZone: 'Asia/Kolkata',
      teamIds: [team.id],
      teams: [{ id: team.id, name: team.name }],
    });
    expect(JSON.stringify(whoami)).not.toContain(user.email);
    const { result } = await tool(bearer, 'incident_search', {
      query: { assigneeId: 'me', limit: 50 },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const ids = (result.structuredContent.data.data as { id: string }[]).map(row => row.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });
});

describe('A3: read_operation and the call_operation deprecation', () => {
  it('serves a read without changes and tells call_operation readers where to go', async () => {
    const { bearer } = await principal();
    const { result } = await tool(bearer, 'read_operation', {
      operationId: 'listServices',
      args: { query: { limit: 5 } },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent.evidence.warnings.join(' ')).not.toContain('deprecated');
    const legacyRead = await tool(bearer, 'call_operation', {
      operationId: 'listServices',
      args: { query: { limit: 5 } },
    });
    expect(legacyRead.result.isError).not.toBe(true);
    expect(legacyRead.result.structuredContent.evidence.warnings).toContain(
      'Reads through call_operation are deprecated; use read_operation, which never changes anything.'
    );
  });
});

describe('A4: domain rejections explain themselves', () => {
  it('forwards the registered domain code and the request id', async () => {
    const { bearer } = await principal();
    const team = await createTestTeam('Resolved team');
    const service = await createTestService('Resolved service', team.id);
    const incident = await createTestIncident('Done', service.id, { status: 'RESOLVED' });
    const { response, result } = await tool(bearer, 'incident_acknowledge', {
      path: { id: incident.id },
      body: {},
      idempotencyKey: `ack-resolved-${randomBytes(6).toString('hex')}`,
    });
    expect(result.isError).toBe(true);
    const error = result.structuredContent.error;
    expect(error.code).toBe('MCP_DOMAIN_REJECTED');
    expect(error.domainCode).toMatch(/^[A-Z_]+$/);
    expect(result.content[0].text).toContain(`(${error.domainCode})`);
    expect(error.requestId).toBe(response.headers.get('x-request-id'));
    // Only bounded, registry-checked facts; the problem's title, detail and message never.
    expect(Object.keys(error).sort()).toEqual(['code', 'domainCode', 'requestId', 'retryable']);
  });

  it('sends the real Retry-After when the per-minute quota is spent', async () => {
    const { bearer } = await principal();
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { requestsPerMinute: 1 } });
    expect((await modern(bearer, 'tools/list')).status).toBe(200);
    const limited = await modern(bearer, 'tools/list');
    expect(limited.status).toBe(429);
    const now = Date.now();
    const expected = Math.ceil((Math.ceil(now / 60000) * 60000 - now) / 1000);
    const retry = Number(limited.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(Math.max(1, expected - 1));
    expect(retry).toBeLessThanOrEqual(Math.min(60, expected + 1));
  });
});

describe('A7: prepare tells the assistant what to do next', () => {
  it('returns nextSteps and whether the requester may approve it', async () => {
    const f = await fixture();
    const { result } = await tool(f.bearer, 'operation_prepare', await f.leadArgs());
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'REQUIRES_NATIVE_APPROVAL',
      selfApprovable: true,
      nextSteps: {
        shareWithUser: result.structuredContent.reviewUrl,
        poll: {
          tool: 'operation_get_approval',
          afterSeconds: 30,
          stopAt: result.structuredContent.expiresAt,
        },
        onApproved: 'operation_commit_approved',
      },
    });
    expect(result.structuredContent.warnings.join(' ')).not.toContain('different');
  });
});

describe('A10: single-entity results link back', () => {
  it('adds a resource link and a page link for the user', async () => {
    const { bearer } = await principal();
    const team = await createTestTeam('Link team');
    const service = await createTestService('Link service', team.id);
    const incident = await createTestIncident('Linked', service.id);
    const { result } = await tool(bearer, 'incident_get', { path: { id: incident.id } });
    expect(result.isError).not.toBe(true);
    expect(result.content.slice(1)).toEqual([
      expect.objectContaining({
        type: 'resource_link',
        uri: `opsknight://incidents/${incident.id}`,
      }),
      expect.objectContaining({
        type: 'resource_link',
        uri: `http://localhost:3000/incidents/${incident.id}`,
        annotations: { audience: ['user'] },
      }),
    ]);
    const { result: list } = await tool(bearer, 'incident_search', { query: { limit: 1 } });
    expect(list.content).toHaveLength(1);
  });
});

describe('A11: completion by name', () => {
  it('suggests the ids of rows whose name contains the typed text', async () => {
    const { bearer } = await principal();
    const team = await createTestTeam('Completion team');
    const wanted = await createTestService('Payments Gateway', team.id);
    await createTestService('Search Indexer', team.id);
    const response = await modern(bearer, 'completion/complete', {
      ref: { type: 'ref/resource', uri: 'opsknight://services/{id}' },
      argument: { name: 'id', value: 'gateway' },
    });
    const values = (await response.json()).result.completion.values as string[];
    expect(values).toEqual([wanted.id]);
  });
});

describe('E2: request metrics', () => {
  it('counts a tool error as tool_error with its bounded tool label', async () => {
    const { bearer } = await principal();
    clearRuntimeOperationalMetrics();
    await tool(bearer, 'describe_operation', { operationId: 'nope' });
    await tool(bearer, 'whoami', {});
    await modern(bearer, 'tools/call', { name: 'made_up_tool', arguments: {} });
    const rows = runtimeOperationalMetrics().get('opsknight_mcp_requests_total') ?? [];
    const value = (outcome: string, name: string) =>
      rows.find(row => row.labels.outcome === outcome && row.labels.tool === name)?.value;
    expect(value('tool_error', 'describe_operation')).toBe(1);
    expect(value('served', 'whoami')).toBe(1);
    expect(rows.some(row => row.labels.tool === 'made_up_tool')).toBe(false);
    expect(rows.some(row => row.labels.tool === 'other')).toBe(true);
  });
});

describe('E5: listen streams honour the MCP switch and capability controls', () => {
  async function ended(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: false; value: undefined }>(resolve =>
          setTimeout(() => resolve({ done: false, value: undefined }), 250)
        ),
      ]);
      if (chunk.done) return true;
    }
    return false;
  }

  it.each([
    ['turning MCP off', { enabled: false }],
    ['disabling the subscribed read', { disabledCapabilities: ['getIncident'] }],
  ])('closes the stream after %s', async (_label, change) => {
    resetSubscriptionStateForTests(150);
    const { bearer } = await principal();
    const team = await createTestTeam('Listen team');
    const service = await createTestService('Listen service', team.id);
    const incident = await createTestIncident('Watched', service.id);
    const response = await modern(bearer, 'subscriptions/listen', {
      notifications: { resourceSubscriptions: [`opsknight://incidents/${incident.id}`] },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await pollChanges();
    await db.mcpPolicy.update({ where: { id: 'default' }, data: change });
    expect(await ended(reader)).toBe(true);
  });

  it('keeps the stream open while nothing relevant changes', async () => {
    resetSubscriptionStateForTests(150);
    const { bearer } = await principal();
    const team = await createTestTeam('Steady team');
    const service = await createTestService('Steady service', team.id);
    const incident = await createTestIncident('Steady', service.id);
    const response = await modern(bearer, 'subscriptions/listen', {
      notifications: { resourceSubscriptions: [`opsknight://incidents/${incident.id}`] },
    });
    const reader = response.body!.getReader();
    await db.mcpPolicy.update({
      where: { id: 'default' },
      data: { disabledCapabilities: ['getService'] },
    });
    const first = await Promise.race([
      reader.read().then(chunk => (chunk.done ? 'ended' : 'data')),
      new Promise(resolve => setTimeout(() => resolve('open'), 800)),
    ]);
    expect(first).not.toBe('ended');
    await reader.cancel();
  });
});

describe('E5: deep health reports the MCP route', () => {
  it('includes the MCP database round trip, switch and slot usage', async () => {
    vi.stubEnv('PROMETHEUS_SCRAPE_TOKEN', 'health-token-for-tests');
    try {
      const { GET: deep } = await import('@/app/api/health/deep/route');
      const response = await deep(
        new Request('http://localhost/api/health/deep', {
          headers: { authorization: 'Bearer health-token-for-tests' },
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      const health = body.data ?? body;
      expect(health.mcp).toMatchObject({
        status: 'ok',
        enabled: true,
        inFlight: 0,
        queued: 0,
      });
      expect(typeof health.mcp.latencyMs).toBe('number');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
