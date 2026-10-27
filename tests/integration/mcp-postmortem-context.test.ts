import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { CostBudget } from '@/lib/mcp/core/budget';
import { callMcpOperation, type ExecutionContext } from '@/lib/mcp/core/execution';
import { getMcpPostmortemContext } from '@/lib/mcp/core/postmortem';
import { POST } from '@/app/mcp/route';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Owned local PostgreSQL test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_TOKEN_HASH_SECRET = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  const policy = { enabled: true, writesEnabled: false, requestsPerMinute: 600, maxOperations: 8 };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

async function fixture(
  role: 'ADMIN' | 'USER' = 'ADMIN',
  scopes = ['postmortems:read', 'incidents:read']
) {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'Postmortem reader', scopes, redirectUris: ['http://localhost/callback'] },
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
  const token = await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  const service = await createTestService('Postmortem context');
  const incident = await createTestIncident('Resolved incident', service.id, {
    status: 'RESOLVED',
    visibility: 'PRIVATE',
  });
  const postmortem = await db.postmortem.create({
    data: {
      incidentId: incident.id,
      title: 'Original title',
      summary: 'Stored summary',
      rootCause: 'An authored assertion, not independent evidence',
      timeline: [
        {
          secret: 'never-disclose-this',
          note: 'Bearer hidden-token https://example.test/log?signature=secret',
        },
      ],
    },
  });
  await db.postmortem.update({ where: { id: postmortem.id }, data: { title: 'Current title' } });
  await db.postmortemContributor.create({
    data: { postmortemId: postmortem.id, userId: user.id, role: 'AUTHOR' },
  });
  const ctx = (budget = new CostBudget()): ExecutionContext => ({
    grantId: grant.id,
    credentialId: token.id,
    tokenScopes: scopes,
    requestId: 'postmortem-test',
    budget,
  });
  return { user, client, grant, token, bearer, postmortem, incident, ctx };
}

describe('MCP postmortem evidence workflow', () => {
  it('uses native bounded history/contributor projections and redacts snapshots recursively', async () => {
    const f = await fixture();
    const result = await getMcpPostmortemContext(f.ctx(), { id: f.postmortem.id });
    expect(result.postmortem.data).toMatchObject({ data: { title: 'Current title' } });
    expect(result.contributors.data).toMatchObject({
      data: { contributors: [{ userId: f.user.id, role: 'AUTHOR' }] },
    });
    expect(result.versions.data).toMatchObject({
      data: { versions: [{ snapshot: { title: 'Current title' } }] },
    });
    expect(JSON.stringify(result)).not.toMatch(/never-disclose-this|hidden-token|signature=secret/);
    expect(result.interpretation.rootCause).toEqual({ status: 'unknown', confirmed: false });
    const history = result.versions.data as {
      data: { versions: unknown[]; nextBeforeRevision: number };
    };
    expect(history.data.versions).toHaveLength(1);
    const older = await callMcpOperation(f.ctx(), 'listPostmortemVersions', {
      path: { id: f.postmortem.id },
      query: { beforeRevision: history.data.nextBeforeRevision, limit: 1 },
    });
    expect(older.data).toMatchObject({
      data: { versions: [{ snapshot: { title: 'Original title' } }] },
    });
    expect(
      await db.postmortem.findUnique({
        where: { id: f.postmortem.id },
        select: { title: true, status: true },
      })
    ).toEqual({ title: 'Current title', status: 'DRAFT' });
  });
  it('accepts the native incident-ID lookup without creating another postmortem', async () => {
    const f = await fixture();
    expect(
      (await getMcpPostmortemContext(f.ctx(), { id: f.incident.id })).postmortem.data
    ).toMatchObject({ data: { id: f.postmortem.id } });
  });
  it('hides both collections behind the parent resource boundary', async () => {
    const f = await fixture('USER');
    for (const operationId of ['listPostmortemVersions', 'listPostmortemContributors']) {
      await expect(
        callMcpOperation(f.ctx(), operationId, { path: { id: f.postmortem.id } })
      ).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
    }
    await expect(getMcpPostmortemContext(f.ctx(), { id: f.postmortem.id })).rejects.toThrow(
      'MCP_RESOURCE_UNAVAILABLE'
    );
    await db.incidentWatcher.create({ data: { incidentId: f.incident.id, userId: f.user.id } });
    expect(
      (await getMcpPostmortemContext(f.ctx(), { id: f.postmortem.id })).postmortem.data
    ).toMatchObject({ data: { id: f.postmortem.id } });
    await db.incidentWatcher.deleteMany({
      where: { incidentId: f.incident.id, userId: f.user.id },
    });
    await expect(getMcpPostmortemContext(f.ctx(), { id: f.postmortem.id })).rejects.toThrow(
      'MCP_RESOURCE_UNAVAILABLE'
    );
  });
  it('honors fresh scope, grant and account changes', async () => {
    const f = await fixture();
    await db.mcpClient.update({ where: { id: f.client.id }, data: { scopes: ['incidents:read'] } });
    await expect(getMcpPostmortemContext(f.ctx(), { id: f.postmortem.id })).rejects.toThrow(
      'MCP_OPERATION_FORBIDDEN'
    );
    await db.mcpGrant.update({ where: { id: f.grant.id }, data: { revokedAt: new Date() } });
    await expect(getMcpPostmortemContext(f.ctx(), { id: f.postmortem.id })).rejects.toThrow(
      'MCP_INVALID_GRANT'
    );
    const other = await fixture();
    await db.user.update({
      where: { id: other.user.id },
      data: { tokenVersion: { increment: 1 } },
    });
    await expect(getMcpPostmortemContext(other.ctx(), { id: other.postmortem.id })).rejects.toThrow(
      'MCP_INACTIVE_PRINCIPAL'
    );
  });
  it('rejects unknown arguments, oversized history pages and exhausted operation/result budgets', async () => {
    const f = await fixture();
    await expect(
      getMcpPostmortemContext(f.ctx(), { id: f.postmortem.id, approve: true })
    ).rejects.toThrow();
    await expect(
      callMcpOperation(f.ctx(), 'listPostmortemVersions', {
        path: { id: f.postmortem.id },
        query: { limit: 51 },
      })
    ).rejects.toThrow('MCP_INVALID_ARGUMENTS');
    await expect(
      getMcpPostmortemContext(f.ctx(new CostBudget(3)), { id: f.postmortem.id })
    ).rejects.toThrow('MCP_OPERATION_BUDGET_EXCEEDED');
    await expect(
      getMcpPostmortemContext(f.ctx(new CostBudget(8, 100)), { id: f.postmortem.id })
    ).rejects.toThrow('MCP_RESULT_BUDGET_EXCEEDED');
  });
  it('charges four operations over the authenticated modern wire and exposes no postmortem mutation', async () => {
    const f = await fixture();
    const response = await POST(
      new Request(mcpResource(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${f.bearer}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'postmortem_get_context',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'postmortem_get_context',
            arguments: { id: f.postmortem.id },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'postmortem-test', version: '1' },
            },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    const wire = await response.json();
    expect(wire.result.isError).not.toBe(true);
    expect(wire.result.structuredContent.postmortem.data.data.id).toBe(f.postmortem.id);
    const quota = await db.rateLimit.findMany({ where: { key: { contains: f.grant.id } } });
    expect(quota.some(row => row.count === 4)).toBe(true);
    await expect(
      callMcpOperation(f.ctx(), 'publishPostmortem', { path: { id: f.postmortem.id } })
    ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });
});
