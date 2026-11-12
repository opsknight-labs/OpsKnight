// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { CostBudget } from '@/lib/mcp/core/budget';
import { callMcpOperation, type ExecutionContext } from '@/lib/mcp/core/execution';
import { lockMcpMutationAuthority } from '@/lib/mcp/core/mutation-authority';
import { POST } from '@/app/mcp/route';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';
import { fixture } from '../helpers/mcp-approval';

// Global, per-role and per-assistant restrictions combined (effective-capabilities.ts), checked
// end to end: tools/list, execution and the under-lock recheck must always agree.

const allScopes = [
  ...new Set(
    MCP_CATALOG.filter(
      operation => isMcpExecutable(operation) || isMcpApprovalGated(operation)
    ).flatMap(operation => operation.requiredScopes)
  ),
].filter(scope => scope !== 'admin:manage');

const newClient = (name = 'Scoped client') =>
  db.mcpClient.create({
    data: { name, scopes: allScopes, redirectUris: ['http://localhost/cb'] },
  });

async function connect(role: 'USER' | 'ADMIN', clientId?: string) {
  const user = await createTestUser({ role });
  const client = clientId ?? (await newClient()).id;
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes: allScopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  const token = await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes: allScopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  const ctx = (): ExecutionContext => ({
    grantId: grant.id,
    credentialId: token.id,
    tokenScopes: allScopes,
    requestId: 'scoped-capabilities-test',
    budget: new CostBudget(),
  });
  return { bearer, ctx, clientId: client };
}

let rpcId = 0;
async function rpc(bearer: string, method: string, params: Record<string, unknown> = {}) {
  const response = await POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(method === 'tools/call' ? { 'mcp-name': String(params.name) } : {}),
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
            'io.modelcontextprotocol/clientInfo': { name: 'scoped-test', version: '1' },
          },
        },
      }),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    result?: Record<string, unknown> & { isError?: boolean; content?: { text: string }[] };
    error?: { code: number; message: string };
  };
}

const toolNames = async (bearer: string) =>
  ((await rpc(bearer, 'tools/list')).result?.tools as { name: string }[]).map(tool => tool.name);
const search = (bearer: string) =>
  rpc(bearer, 'tools/call', { name: 'incident_search', arguments: { query: {} } });
const refused = async (bearer: string) => {
  const result = await search(bearer);
  return Boolean(result.error ?? result.result?.isError);
};
const restrictRole = (value: Prisma.InputJsonValue | typeof Prisma.DbNull) =>
  db.mcpPolicy.update({ where: { id: 'default' }, data: { roleDisabledCapabilities: value } });
const restrictClient = (id: string, disabledCapabilities: string[]) =>
  db.mcpClient.update({ where: { id }, data: { disabledCapabilities } });
const lockFor = (ctx: ExecutionContext, capability: string) =>
  db.$transaction(tx =>
    lockMcpMutationAuthority(
      tx,
      { grantId: ctx.grantId, credentialId: ctx.credentialId, tokenScopes: ctx.tokenScopes },
      [],
      [],
      undefined,
      [capability]
    )
  );

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);

// Suites share one database; never leave restrictions behind for the next file.
afterAll(async () => {
  await db.mcpPolicy.updateMany({
    data: { disabledCapabilities: [], roleDisabledCapabilities: Prisma.DbNull },
  });
});

beforeEach(async () => {
  const policy = {
    enabled: true,
    writesEnabled: true,
    sensitiveReadsEnabled: true,
    requestsPerMinute: 600,
    disabledCapabilities: [] as string[],
    roleDisabledCapabilities: Prisma.DbNull,
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

describe('per-role and per-assistant MCP capability restrictions', () => {
  it('a USER-role restriction hides and refuses a tool for users but not administrators', async () => {
    const user = await connect('USER');
    const admin = await connect('ADMIN');
    expect(await toolNames(user.bearer)).toContain('incident_search');

    await restrictRole({ USER: ['incident_search'] });
    expect(await toolNames(user.bearer)).not.toContain('incident_search');
    expect(await toolNames(user.bearer)).toContain('incident_get');
    expect(await refused(user.bearer)).toBe(true);
    await expect(callMcpOperation(user.ctx(), 'listIncidents', { query: {} })).rejects.toThrow(
      'MCP_CAPABILITY_DISABLED'
    );
    await expect(lockFor(user.ctx(), 'listIncidents')).rejects.toThrow('MCP_CAPABILITY_DISABLED');

    expect(await toolNames(admin.bearer)).toContain('incident_search');
    expect(await refused(admin.bearer)).toBe(false);
    await expect(lockFor(admin.ctx(), 'listIncidents')).resolves.toBeTruthy();

    // Removing the restriction re-exposes it on the next request.
    await restrictRole({ USER: [] });
    expect(await toolNames(user.bearer)).toContain('incident_search');
    expect(await refused(user.bearer)).toBe(false);
  });

  it('an assistant restriction applies to everyone using that assistant and no one else', async () => {
    const restricted = await newClient('Restricted assistant');
    const first = await connect('ADMIN', restricted.id);
    const second = await connect('USER', restricted.id);
    const other = await connect('USER');

    await restrictClient(restricted.id, ['domain:incidents']);
    for (const person of [first, second]) {
      expect(await toolNames(person.bearer)).not.toContain('incident_search');
      expect(await refused(person.bearer)).toBe(true);
      await expect(lockFor(person.ctx(), 'listIncidents')).rejects.toThrow(
        'MCP_CAPABILITY_DISABLED'
      );
    }
    expect(await toolNames(other.bearer)).toContain('incident_search');
    expect(await refused(other.bearer)).toBe(false);

    await restrictClient(restricted.id, []);
    expect(await refused(first.bearer)).toBe(false);
    expect(await refused(second.bearer)).toBe(false);
  });

  it('a restriction added after listing is enforced at execution and under the lock', async () => {
    const user = await connect('USER');
    expect(await toolNames(user.bearer)).toContain('incident_search');
    await expect(lockFor(user.ctx(), 'listIncidents')).resolves.toBeTruthy();

    await restrictClient(user.clientId, ['listIncidents']);
    expect(await refused(user.bearer)).toBe(true);
    await expect(callMcpOperation(user.ctx(), 'listIncidents', { query: {} })).rejects.toThrow(
      'MCP_CAPABILITY_DISABLED'
    );
    await expect(lockFor(user.ctx(), 'listIncidents')).rejects.toThrow('MCP_CAPABILITY_DISABLED');

    await restrictClient(user.clientId, []);
    await restrictRole({ USER: ['listIncidents'] });
    await expect(lockFor(user.ctx(), 'listIncidents')).rejects.toThrow('MCP_CAPABILITY_DISABLED');
  });

  it('refuses at commit an approval whose assistant was restricted after it was prepared', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    await f.review(prepared);
    const { clientId } = await db.mcpGrant.findUniqueOrThrow({ where: { id: f.ctx().grantId } });

    await restrictClient(clientId, ['setTeamLead']);
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_CAPABILITY_DISABLED');
    await restrictClient(clientId, []);
    // The fixture's requester is an ADMIN: a USER-role restriction does not apply to it.
    await restrictRole({ USER: ['setTeamLead'] });
    expect(
      await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).toMatchObject({ status: 'COMMITTED' });
  });

  it('malformed stored role restrictions never crash a request and never lock out admins', async () => {
    const user = await connect('USER');
    const admin = await connect('ADMIN');
    for (const value of ['garbage', [1, 2], { USER: 'listIncidents' }, { USER: [1] }]) {
      await restrictRole(value);
      // Fails closed for the role it may name: the request succeeds with nothing to use.
      expect(await toolNames(user.bearer)).not.toContain('incident_search');
      expect(await refused(user.bearer)).toBe(true);
      expect(await toolNames(admin.bearer)).toContain('incident_search');
      expect(await refused(admin.bearer)).toBe(false);
    }
    // Another role's broken entry does not affect this one; unknown ids are ignored.
    await restrictRole({ RESPONDER: 'x', USER: ['removedLongAgo'], NOT_A_ROLE: ['listIncidents'] });
    expect(await refused(user.bearer)).toBe(false);
  });
});
