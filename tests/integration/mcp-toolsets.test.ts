// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { mcpToolsetExclusions } from '@/lib/mcp/catalog/capabilities';
import { resetSubscriptionStateForTests } from '@/lib/mcp/protocol/subscriptions';
import { POST } from '@/app/mcp/route';

const allScopes = [
  ...new Set(
    MCP_CATALOG.filter(
      operation => isMcpExecutable(operation) || isMcpApprovalGated(operation)
    ).flatMap(operation => operation.requiredScopes)
  ),
].filter(scope => scope !== 'admin:manage');

async function connect() {
  const user = await createTestUser({ role: 'ADMIN' });
  const client = await db.mcpClient.create({
    data: { name: 'Toolsets client', scopes: allScopes, redirectUris: ['http://localhost/cb'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes: allScopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes: allScopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  return bearer;
}

let rpcId = 0;
function post(bearer: string, method: string, params: Record<string, unknown>, toolsets?: string) {
  return POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(method === 'tools/call' ? { 'mcp-name': String(params.name) } : {}),
        ...(toolsets === undefined ? {} : { 'x-opsknight-toolsets': toolsets }),
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
            'io.modelcontextprotocol/clientInfo': { name: 'toolsets-test', version: '1' },
          },
        },
      }),
    })
  );
}

type RpcResult = {
  result?: Record<string, unknown> & {
    isError?: boolean;
    content?: { text: string }[];
    structuredContent?: Record<string, unknown>;
  };
  error?: { code: number; message: string };
};
const rpc = async (bearer: string, method: string, params = {}, toolsets?: string) =>
  (await (await post(bearer, method, params, toolsets)).json()) as RpcResult;
const toolNames = async (bearer: string, toolsets?: string) =>
  ((await rpc(bearer, 'tools/list', {}, toolsets)).result?.tools as { name: string }[]).map(
    tool => tool.name
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

beforeEach(async () => {
  resetSubscriptionStateForTests();
  const policy = {
    enabled: true,
    writesEnabled: true,
    sensitiveReadsEnabled: true,
    requestsPerMinute: 600,
    maxOperations: 8,
    disabledCapabilities: [] as string[],
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
});
afterEach(() => resetSubscriptionStateForTests());

describe('X-OpsKnight-Toolsets', () => {
  it('maps names to exclusions that never hide discovery, approvals or prompts', () => {
    expect(mcpToolsetExclusions(null)).toEqual([]);
    expect(mcpToolsetExclusions('incidnets, nope')).toEqual([]);
    const hidden = mcpToolsetExclusions(' Incidents ,nope');
    expect(hidden).toContain('domain:schedules');
    expect(hidden).not.toContain('domain:incidents');
    for (const kept of ['domain:mcp', 'domain:approvals', 'domain:prompts'])
      expect(hidden).not.toContain(kept);
  });

  it('narrows tools/list, and an unknown or misspelt header narrows nothing', async () => {
    const bearer = await connect();
    const all = await toolNames(bearer);
    expect(all).toEqual(expect.arrayContaining(['incident_search', 'schedule_list']));

    const narrowed = await toolNames(bearer, 'incidents');
    expect(narrowed).toContain('incident_search');
    expect(narrowed).not.toContain('schedule_list');
    expect(narrowed.filter(name => name.startsWith('runbook_'))).toEqual([]);
    // Discovery, identity and reviews stay.
    expect(narrowed).toEqual(
      expect.arrayContaining([
        'whoami',
        'search_capabilities',
        'read_operation',
        'call_operation',
        'operation_prepare',
      ])
    );
    expect(narrowed.length).toBeLessThan(all.length);

    expect(await toolNames(bearer, 'incidnets')).toEqual(all);
    expect(await toolNames(bearer, ' , ')).toEqual(all);
  });

  it('refuses a hidden operation through read_operation, call_operation and execute_plan', async () => {
    const bearer = await connect();
    const read = await rpc(
      bearer,
      'tools/call',
      { name: 'read_operation', arguments: { operationId: 'listSchedules', args: { query: {} } } },
      'incidents'
    );
    expect(read.result?.isError).toBe(true);
    expect(read.result?.content?.[0].text).toMatch(
      /^MCP_OPERATION_UNAVAILABLE: .*X-OpsKnight-Toolsets/
    );
    // The same read without the header works, so the refusal is the header's.
    const open = await rpc(bearer, 'tools/call', {
      name: 'read_operation',
      arguments: { operationId: 'listSchedules', args: { query: {} } },
    });
    expect(open.result?.isError).toBeFalsy();

    // Only incidents have direct changes, so call_operation is listed only with incidents shown.
    expect(await toolNames(bearer, 'schedules')).not.toContain('call_operation');
    const viaCall = await rpc(
      bearer,
      'tools/call',
      { name: 'call_operation', arguments: { operationId: 'listSchedules', args: { query: {} } } },
      'incidents'
    );
    expect(viaCall.result?.isError).toBe(true);
    expect(viaCall.result?.structuredContent).toBeUndefined();

    const plan = await rpc(
      bearer,
      'tools/call',
      {
        name: 'execute_plan',
        arguments: {
          steps: [
            { id: 'schedules', operationId: 'listSchedules', args: { query: {} } },
            { id: 'incidents', operationId: 'listIncidents', args: { query: {} } },
          ],
        },
      },
      'incidents'
    );
    const steps = plan.result?.structuredContent?.steps as { id: string; status: string }[];
    expect(steps.find(step => step.id === 'schedules')?.status).toBe('failed');
    expect(steps.find(step => step.id === 'incidents')?.status).toBe('completed');
  });

  it('refuses a listen subscription to a hidden domain', async () => {
    const bearer = await connect();
    const team = await createTestTeam('Toolsets team');
    const service = await createTestService('Toolsets service', team.id);
    const incident = await createTestIncident('Toolsets incident', service.id);
    const notifications = { resourceSubscriptions: [`opsknight://incidents/${incident.id}`] };

    const hidden = await rpc(bearer, 'subscriptions/listen', { notifications }, 'schedules');
    expect(hidden.error?.code).toBe(-32602);

    const shown = await post(bearer, 'subscriptions/listen', { notifications }, 'incidents');
    expect(shown.status).toBe(200);
    expect(shown.headers.get('content-type')).toContain('text/event-stream');
    await shown.body?.cancel();
  });
});
