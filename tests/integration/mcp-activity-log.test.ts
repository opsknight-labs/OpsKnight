// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { flushMcpCallLog, mcpCallLogOperationId } from '@/lib/mcp/core/call-log';
import {
  MCP_CLEANUP_BATCH,
  cleanupMcpCredentials,
  purgeMcpCallLog,
} from '@/lib/mcp/auth/retention';
import { listMcpConnectionActivity } from '@/app/(app)/settings/integrations/mcp/activity';
import type { McpViewer } from '@/app/(app)/settings/integrations/mcp/queries';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { POST } from '@/app/mcp/route';

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
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: basePolicy, update: basePolicy });
});

const scopes = ['incidents:read', 'incidents:write', 'services:read'];
async function principal(role: 'ADMIN' | 'USER' = 'USER') {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'Activity client', scopes, redirectUris: ['http://localhost/callback'] },
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
function call(bearer: string, method: string, params: Record<string, unknown> = {}) {
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
        id: ++rpcId,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'activity', version: '1' },
          },
        },
      }),
    })
  );
}

const viewerOf = (user: { id: string }, isAdmin: boolean) =>
  ({
    id: user.id,
    isAdmin,
    canApproveRunbooks: isAdmin,
    readsAllTargets: isAdmin,
    timeZone: 'UTC',
  }) as unknown as McpViewer;

const rowsFor = async (grantId: string) => {
  await flushMcpCallLog();
  return db.mcpCallLog.findMany({ where: { grantId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
};

describe('D8 one activity row per MCP request, bounded labels only', () => {
  it('records served, tool error, protocol rejection and a boundary error without arguments', async () => {
    const { bearer, grant } = await principal();
    const sentinel = `SENTINEL-${randomBytes(6).toString('hex')}`;
    expect((await call(bearer, 'tools/call', { name: 'whoami', arguments: {} })).status).toBe(200);
    await call(bearer, 'tools/call', {
      name: 'read_operation',
      arguments: { operationId: 'listServices', args: { query: { limit: 1, q: sentinel } } },
    });
    await call(bearer, 'tools/call', {
      name: 'read_operation',
      arguments: { operationId: `notAnOperation${sentinel}`, args: {} },
    });
    // tasks/get without the Tasks capability is a protocol rejection.
    await call(bearer, 'tasks/get', { taskId: sentinel });
    // More plan steps than the per-request budget: refused before any handler runs.
    await call(bearer, 'tools/call', {
      name: 'execute_plan',
      arguments: { steps: Array.from({ length: 9 }, () => ({ note: sentinel })) },
    });

    const rows = await rowsFor(grant.id);
    expect(rows.map(row => [row.tool, row.outcome])).toEqual([
      ['whoami', 'served'],
      ['read_operation', expect.stringMatching(/^(served|tool_error)$/)],
      ['read_operation', 'tool_error'],
      ['none', 'protocol_rejected'],
      ['execute_plan', 'invalid_request'],
    ]);
    expect(rows[1].operationId).toBe('listServices');
    // An operationId that is not exactly a catalog key is never stored.
    expect(rows[2].operationId).toBeNull();
    expect(rows[4].errorCode).toBe('MCP_OPERATION_BUDGET_EXCEEDED');
    for (const row of rows) {
      expect(row.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(row)).not.toContain(sentinel);
    }
  });

  it('maps curated tools to their operation and keeps only exact catalog keys', () => {
    expect(mcpCallLogOperationId('incident_get', {})).toBe('getIncident');
    expect(mcpCallLogOperationId('read_operation', { operationId: 'listServices' })).toBe(
      'listServices'
    );
    expect(mcpCallLogOperationId('read_operation', { operationId: 'listservices' })).toBeNull();
    expect(mcpCallLogOperationId('read_operation', { operationId: 42 })).toBeNull();
    expect(mcpCallLogOperationId('other', null)).toBeNull();
  });

  it('writes nothing for an unauthenticated request', async () => {
    const before = await db.mcpCallLog.count();
    const response = await call('not-a-token', 'tools/call', { name: 'whoami', arguments: {} });
    expect(response.status).toBe(401);
    await flushMcpCallLog();
    expect(await db.mcpCallLog.count()).toBe(before);
  });
});

describe('D8 activity drawer access and paging', () => {
  it('lets the owner and administrators read a connection, and nobody else', async () => {
    const owner = await principal();
    const other = await principal();
    const admin = await createTestUser({ role: 'ADMIN' });
    await call(owner.bearer, 'tools/call', { name: 'whoami', arguments: {} });
    await flushMcpCallLog();
    const mine = await listMcpConnectionActivity(viewerOf(owner.user, false), {
      grantId: owner.grant.id,
    });
    expect(mine.calls).toHaveLength(1);
    expect(mine.historyHref).toBeNull();
    const asAdmin = await listMcpConnectionActivity(viewerOf(admin, true), {
      grantId: owner.grant.id,
    });
    expect(asAdmin.calls).toHaveLength(1);
    expect(asAdmin.historyHref).toBe(`/settings/api-keys?tab=activity&key=mcp%3A${owner.grant.id}`);
    await expect(
      listMcpConnectionActivity(viewerOf(other.user, false), { grantId: owner.grant.id })
    ).rejects.toBeInstanceOf(McpBoundaryError);
    await expect(
      listMcpConnectionActivity(viewerOf(owner.user, false), { grantId: 'missing' })
    ).rejects.toBeInstanceOf(McpBoundaryError);
  });

  it('pages newest first on (at, id) and shows the changes this connection made', async () => {
    const { user, grant } = await principal();
    const start = Date.now() - 3600_000;
    await db.mcpCallLog.createMany({
      data: Array.from({ length: 130 }, (_, index) => ({
        grantId: grant.id,
        at: new Date(start + Math.floor(index / 2) * 1000),
        tool: 'whoami',
        outcome: 'served',
        durationMs: 1,
        requestId: `req-${index}`,
      })),
    });
    await db.auditLog.create({
      data: {
        action: 'incident.acknowledged',
        entityType: 'INCIDENT',
        entityId: 'inc-1',
        actorId: user.id,
        details: { metadata: { apiClientId: `mcp:${grant.id}`, apiGateway: 'api_v2' } },
      },
    });
    await db.auditLog.create({
      data: {
        action: 'incident.resolved',
        entityType: 'INCIDENT',
        entityId: 'inc-2',
        actorId: user.id,
        details: { metadata: { apiClientId: 'mcp:someone-else' } },
      },
    });
    const viewer = viewerOf(user, false);
    const first = await listMcpConnectionActivity(viewer, { grantId: grant.id });
    expect(first.calls).toHaveLength(100);
    expect(first.changes.map(change => change.action)).toEqual(['incident.acknowledged']);
    const second = await listMcpConnectionActivity(viewer, {
      grantId: grant.id,
      cursor: first.next!,
    });
    expect(second.calls).toHaveLength(30);
    expect(second.next).toBeNull();
    const all = [...first.calls, ...second.calls];
    expect(new Set(all.map(row => row.id)).size).toBe(130);
    const keys = all.map(row => `${row.at}|${row.id}`);
    expect(keys).toEqual([...keys].sort().reverse());
  });
});

describe('D8 writes are linked to their audit rows', () => {
  it('records the change under the MCP request id that made it', async () => {
    const { bearer, grant, user } = await principal('ADMIN');
    const team = await createTestTeam('Activity team');
    const service = await createTestService('Activity service', team.id);
    const incident = await createTestIncident('Linked write', service.id);
    const response = await call(bearer, 'tools/call', {
      name: 'incident_acknowledge',
      arguments: {
        path: { id: incident.id },
        body: {},
        idempotencyKey: `ack-${randomBytes(6).toString('hex')}`,
      },
    });
    const body = await response.json();
    expect(body.result?.isError, JSON.stringify(body)).not.toBe(true);
    const [row] = await rowsFor(grant.id);
    expect(row.tool).toBe('incident_acknowledge');
    const activity = await listMcpConnectionActivity(viewerOf(user, true), { grantId: grant.id });
    expect(activity.changes.length).toBeGreaterThan(0);
    // Every change this write made carries the request id shown on its activity row.
    for (const change of activity.changes) expect(change.requestId).toBe(row.requestId);
    expect(activity.calls.map(item => item.requestId)).toContain(row.requestId);
  });
});

describe('D8 activity retention', () => {
  it('deletes activity older than 30 days and keeps newer rows', async () => {
    const { grant } = await principal();
    const day = 86_400_000;
    const row = (age: number) => ({
      grantId: grant.id,
      at: new Date(Date.now() - age),
      tool: 'whoami',
      outcome: 'served',
      durationMs: 1,
      requestId: randomBytes(8).toString('hex'),
    });
    await db.mcpCallLog.createMany({ data: [row(31 * day), row(29 * day), row(day)] });
    const result = await cleanupMcpCredentials();
    expect(result.purgedCallLog).toBeGreaterThanOrEqual(1);
    const left = await db.mcpCallLog.findMany({ where: { grantId: grant.id } });
    expect(left).toHaveLength(2);
    for (const kept of left) expect(Date.now() - kept.at.getTime()).toBeLessThan(30 * day);
  });

  it('purges more than one batch per tick, so a busy deployment cannot outgrow the purge', async () => {
    const { grant } = await principal();
    const at = new Date(Date.now() - 31 * 86_400_000);
    const count = MCP_CLEANUP_BATCH * 2 + 7;
    await db.mcpCallLog.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        grantId: grant.id,
        at,
        tool: 'whoami',
        outcome: 'served',
        durationMs: 1,
        requestId: `old-${index}`,
      })),
    });
    expect(await purgeMcpCallLog()).toBeGreaterThanOrEqual(count);
    expect(await db.mcpCallLog.count({ where: { grantId: grant.id } })).toBe(0);
  });
});
