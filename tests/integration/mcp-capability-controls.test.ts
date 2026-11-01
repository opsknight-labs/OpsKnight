import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { CostBudget } from '@/lib/mcp/core/budget';
import { callMcpOperation, type ExecutionContext } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';
import { POST } from '@/app/mcp/route';
import { fixture } from '../helpers/mcp-approval';

const admin = vi.hoisted(() => ({ id: '', tokenVersion: 0, capabilities: ['admin.manage'] }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac')>()),
  getUserPermissions: vi.fn(async () => ({
    id: admin.id,
    capabilities: admin.capabilities,
    isAdmin: admin.capabilities.includes('admin.manage'),
    authenticated: true,
  })),
  getCurrentUser: vi.fn(async () => ({ id: admin.id, tokenVersion: admin.tokenVersion })),
}));

// Every scope any exposable operation needs, so visibility depends only on the capability controls.
const allScopes = [
  ...new Set(
    MCP_CATALOG.filter(
      operation => isMcpExecutable(operation) || isMcpApprovalGated(operation)
    ).flatMap(operation => operation.requiredScopes)
  ),
].filter(scope => scope !== 'admin:manage');

async function connectAll(userId: string, tokenVersion: number) {
  const client = await db.mcpClient.create({
    data: { name: 'Capability client', scopes: allScopes, redirectUris: ['http://localhost/cb'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId,
      userTokenVersion: tokenVersion,
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
    requestId: 'capability-controls-test',
    budget: new CostBudget(),
  });
  return { bearer, ctx };
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
            'io.modelcontextprotocol/clientInfo': { name: 'capability-test', version: '1' },
          },
        },
      }),
    })
  );
  return (await response.json()) as {
    result?: Record<string, unknown> & {
      isError?: boolean;
      content?: { text: string }[];
      structuredContent?: Record<string, unknown>;
    };
    error?: { code: number; message: string };
  };
}

const toolNames = async (bearer: string) =>
  ((await rpc(bearer, 'tools/list')).result?.tools as { name: string }[]).map(tool => tool.name);
// With every prompt disabled the server advertises no prompts capability at all.
const promptNames = async (bearer: string) => {
  const { result, error } = await rpc(bearer, 'prompts/list');
  return error ? [] : (result?.prompts as { name: string }[]).map(prompt => prompt.name);
};
const callTool = (bearer: string, name: string, args: Record<string, unknown>) =>
  rpc(bearer, 'tools/call', { name, arguments: args });
const disable = (disabledCapabilities: string[]) =>
  db.mcpPolicy.update({ where: { id: 'default' }, data: { disabledCapabilities } });

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);

// Suites share one database; never leave capabilities disabled for the next file.
afterAll(async () => {
  await db.mcpPolicy.updateMany({ data: { disabledCapabilities: [] } });
});

beforeEach(async () => {
  const policy = {
    enabled: true,
    writesEnabled: true,
    sensitiveReadsEnabled: true,
    requestsPerMinute: 600,
    disabledCapabilities: [] as string[],
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});

describe('administrator-disabled MCP capabilities', () => {
  it('removes a disabled curated tool from tools/list and refuses it on every path', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    const { bearer, ctx } = await connectAll(user.id, user.tokenVersion);
    expect(await toolNames(bearer)).toContain('incident_search');
    expect((await callTool(bearer, 'incident_search', { query: {} })).result?.isError).toBeFalsy();

    // Same session credentials, no restart: the next request sees the new policy.
    await disable(['incident_search']);
    const tools = await toolNames(bearer);
    expect(tools).not.toContain('incident_search');
    expect(tools).toContain('incident_get');
    const direct = await callTool(bearer, 'incident_search', { query: {} });
    expect(direct.error ?? direct.result?.isError).toBeTruthy();
    const generic = await callTool(bearer, 'call_operation', {
      operationId: 'listIncidents',
      args: { query: {} },
    });
    expect(generic.result?.isError).toBe(true);
    expect(generic.result?.content?.[0].text).toMatch(/^MCP_CAPABILITY_DISABLED: .*administrator/);
    await expect(callMcpOperation(ctx(), 'listIncidents', { query: {} })).rejects.toThrow(
      'MCP_CAPABILITY_DISABLED'
    );

    await disable([]);
    expect(await toolNames(bearer)).toContain('incident_search');
    expect((await callTool(bearer, 'incident_search', { query: {} })).result?.isError).toBeFalsy();
  });

  it('hides a disabled catalog operation from search and describe and refuses calls and plans', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    const { bearer } = await connectAll(user.id, user.tokenVersion);
    const search = async () =>
      (
        (await callTool(bearer, 'search_capabilities', { query: 'listteams', cursor: 0 })).result
          ?.structuredContent?.operations as { operationId: string }[]
      ).map(operation => operation.operationId);
    expect(await search()).toContain('listTeams');
    expect(
      (await callTool(bearer, 'describe_operation', { operationId: 'listTeams' })).result?.isError
    ).toBeFalsy();

    await disable(['listTeams']);
    expect(await search()).not.toContain('listTeams');
    const described = await callTool(bearer, 'describe_operation', { operationId: 'listTeams' });
    expect(described.result?.isError).toBe(true);
    expect(described.result?.content?.[0].text).toMatch(/^MCP_OPERATION_UNAVAILABLE\b/);
    const called = await callTool(bearer, 'call_operation', {
      operationId: 'listTeams',
      args: { query: {} },
    });
    expect(called.result?.content?.[0].text).toMatch(/^MCP_CAPABILITY_DISABLED/);
    const plan = await callTool(bearer, 'execute_plan', {
      steps: [
        { id: 'teams', operationId: 'listTeams', args: { query: {} } },
        { id: 'services', operationId: 'listServices', args: { query: {} } },
      ],
    });
    const steps = plan.result?.structuredContent?.steps as {
      id: string;
      status: string;
      error?: string;
    }[];
    expect(steps.find(step => step.id === 'teams')).toMatchObject({
      status: 'failed',
      error: 'MCP_CAPABILITY_DISABLED',
    });
    expect(steps.find(step => step.id === 'services')).toMatchObject({ status: 'completed' });

    await disable([]);
    expect(await search()).toContain('listTeams');
  });

  it('applies a whole-domain marker to operations, curated tools and standalone tools', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    const { bearer } = await connectAll(user.id, user.tokenVersion);
    const before = await toolNames(bearer);
    expect(await promptNames(bearer)).toContain('investigate_incident');
    expect(before).toEqual(expect.arrayContaining(['runbook_find', 'runbook_prepare_execution']));

    await disable(['domain:runbooks', 'domain:prompts', 'call_operation', 'removedLongAgo']);
    const after = await toolNames(bearer);
    expect(after.filter(name => name.startsWith('runbook_'))).toEqual([]);
    expect(after).not.toContain('call_operation');
    // The unknown stored entry is ignored, not fatal.
    expect(after).toContain('incident_search');
    expect(await promptNames(bearer)).toEqual([]);
    const search = await callTool(bearer, 'search_capabilities', {
      query: '',
      domain: 'runbooks',
      cursor: 0,
    });
    expect(search.result?.structuredContent?.operations).toEqual([]);
  });

  it('refuses at commit an approval prepared before its operation was disabled', async () => {
    const f = await fixture();
    const input = await f.leadArgs();
    const prepared = await prepareMcpOperation(f.ctx(), input);
    await f.review(prepared);

    await disable(['setTeamLead']);
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_CAPABILITY_DISABLED');
    expect(
      await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: prepared.approvalId } })
    ).toMatchObject({ status: 'APPROVED' });
    expect(await db.team.findUniqueOrThrow({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: null,
    });
    // New requests for it are refused too.
    await expect(prepareMcpOperation(f.ctx(), await f.leadArgs())).rejects.toThrow(
      /MCP_CAPABILITY_DISABLED|MCP_OPERATION_UNAVAILABLE/
    );
    // Disabling the commit tool alone also stops commits.
    await disable(['operation_commit_approved']);
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_CAPABILITY_DISABLED');

    // Re-enabling restores it while the approval is still valid.
    await disable([]);
    expect(
      await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).toMatchObject({ status: 'COMMITTED' });
    expect(await db.team.findUniqueOrThrow({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: f.lead.id,
    });
  });
});

describe('updateMcpDisabledCapabilities', () => {
  const load = async () =>
    (await import('@/app/(app)/settings/integrations/mcp/capability-actions'))
      .updateMcpDisabledCapabilities;

  it('refuses a non-administrator and changes nothing', async () => {
    const user = await createTestUser({ role: 'USER' });
    Object.assign(admin, { id: user.id, tokenVersion: user.tokenVersion, capabilities: [] });
    const update = await load();
    await expect(update({ disabled: ['listTeams'], baseline: [] })).rejects.toThrow(
      'MCP_ADMIN_REQUIRED'
    );
    expect(
      (await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).disabledCapabilities
    ).toEqual([]);
  });

  it('refuses a stale administrator session even with the capability claim', async () => {
    const user = await createTestUser({ role: 'USER' });
    Object.assign(admin, {
      id: user.id,
      tokenVersion: user.tokenVersion,
      capabilities: ['admin.manage'],
    });
    const update = await load();
    await expect(update({ disabled: ['listTeams'], baseline: [] })).rejects.toThrow(
      'MCP_ADMIN_REQUIRED'
    );
  });

  it('validates, normalises, audits the diff and detects concurrent edits', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    Object.assign(admin, {
      id: user.id,
      tokenVersion: user.tokenVersion,
      capabilities: ['admin.manage'],
    });
    const update = await load();

    expect(await update({ disabled: ['listTeams', 'nope'], baseline: [] })).toEqual({
      ok: false,
      code: 'MCP_INVALID_CAPABILITY',
      invalid: ['nope'],
    });
    await expect(update({ disabled: ['bad entry!'], baseline: [] })).rejects.toThrow();

    const saved = await update({
      disabled: ['incident_search', 'listTeams', 'domain:runbooks', 'runbook_find'],
      baseline: [],
    });
    expect(saved).toEqual({
      ok: true,
      disabled: ['domain:runbooks', 'listIncidents', 'listTeams'],
      added: ['domain:runbooks', 'listIncidents', 'listTeams'],
      removed: [],
    });
    expect(
      (await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } })).disabledCapabilities
    ).toEqual(['domain:runbooks', 'listIncidents', 'listTeams']);

    // An editor that loaded the old list must not silently overwrite the new one.
    expect(await update({ disabled: ['getService'], baseline: [] })).toEqual({
      ok: false,
      code: 'MCP_POLICY_CONFLICT',
      disabled: ['domain:runbooks', 'listIncidents', 'listTeams'],
    });

    const second = await update({
      disabled: ['domain:runbooks', 'getService', 'listIncidents'],
      baseline: ['domain:runbooks', 'listIncidents', 'listTeams'],
    });
    expect(second).toMatchObject({ ok: true, added: ['getService'], removed: ['listTeams'] });

    const audits = await db.auditLog.findMany({
      where: { action: 'mcp.policy.capabilities_updated', actorId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits[0].details).toMatchObject({
      metadata: { added: ['domain:runbooks', 'listIncidents', 'listTeams'], removed: [] },
      oldValue: { disabledCapabilities: [] },
      newValue: { disabledCapabilities: ['domain:runbooks', 'listIncidents', 'listTeams'] },
    });
    expect(audits[1].details).toMatchObject({
      metadata: { added: ['getService'], removed: ['listTeams'] },
    });
  });
});
