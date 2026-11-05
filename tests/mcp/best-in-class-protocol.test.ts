import { readFileSync as fsRead } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import {
  MCP_SERVER_INSTRUCTIONS,
  clampPageSize,
  createOpsKnightMcpServer,
  resultLinks,
  toolErrorContent,
  toolErrorText,
} from '@/lib/mcp/protocol/server';
import { CostBudget } from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { MCP_MAX_PAGE_SIZE, domainRejection, mcpPageSize } from '@/lib/mcp/core/execution';
import { executeMcpPlan } from '@/lib/mcp/core/plan';
import { rpcSchema } from '@/lib/mcp/protocol/input';
import { supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import { MCP_CATALOG, isMcpExecutable, mcpContractHash } from '@/lib/mcp/catalog';
import { mcpHttpError } from '@/lib/mcp/auth/http';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';

// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths in this test
const readFileSync = (path: string, encoding: 'utf8') => fsRead(path, encoding);

const allScopes = [...supportedMcpScopes()].filter(scope => scope !== 'admin:manage');
const actorWith = (
  scopes: string[] = allScopes,
  role: AuthorizationActor['role'] = 'ADMIN'
): AuthorizationActor => ({
  id: 'user_1',
  role,
  status: 'ACTIVE',
  teamIds: ['team_a'],
  apiKey: { id: 'grant', scopes },
});
const context = (budget = new CostBudget()) => ({
  grantId: 'grant',
  tokenScopes: allScopes,
  requestId: 'req-1',
  budget,
});

const handlers: McpHttpHandler[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(handlers.splice(0).map(handler => handler.close()));
});

interface Options {
  actor?: AuthorizationActor;
  writes?: boolean;
  sensitive?: boolean;
  disabled?: string[];
  budget?: CostBudget;
}
function rpc(method: string, params: Record<string, unknown> = {}, options: Options = {}) {
  const handler = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        context(options.budget),
        options.actor ?? actorWith(),
        options.writes ?? true,
        options.sensitive ?? true,
        options.disabled ?? []
      ),
    { legacy: 'reject', responseMode: 'json', maxSubscriptions: 0 }
  );
  handlers.push(handler);
  return handler
    .fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'best-in-class', version: '1' },
            },
          },
        }),
      })
    )
    .then(response => response.json());
}
type Tool = {
  name: string;
  title?: string;
  annotations?: Record<string, boolean>;
  inputSchema: Record<string, unknown>;
};
const listTools = async (options: Options = {}) =>
  (await rpc('tools/list', {}, options)).result.tools as Tool[];
const callTool = async (name: string, args: Record<string, unknown>, options: Options = {}) =>
  (await rpc('tools/call', { name, arguments: args }, options)).result;

describe('A1: notifications parse without an id', () => {
  it('accepts a notification and still requires a method', () => {
    expect(rpcSchema.parse({ jsonrpc: '2.0', method: 'notifications/initialized' }).id).toBe(
      undefined
    );
    expect(() => rpcSchema.parse({ jsonrpc: '2.0', id: 1 })).toThrow();
  });
});

describe('A2: whoami', () => {
  it('is listed read-only and cannot be withheld by capability controls', async () => {
    const tools = await listTools({ disabled: ['whoami', 'domain:mcp'] });
    const whoami = tools.find(tool => tool.name === 'whoami');
    expect(whoami?.title).toBe('Who am I');
    expect(whoami?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    // The rest of the mcp domain is withheld, so controls are in force.
    expect(tools.some(tool => tool.name === 'search_capabilities')).toBe(false);
  });

  it('returns the caller identity and access, never an email', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ name: 'Ada' } as never);
    const result = await callTool('whoami', {}, { writes: false, sensitive: false });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      userId: 'user_1',
      displayName: 'Ada',
      role: 'ADMIN',
      teamIds: ['team_a'],
      writesEnabled: false,
      sensitiveReadsEnabled: false,
    });
    expect(result.structuredContent.effectiveScopes).toEqual([...allScopes].sort());
    expect(result.structuredContent.enabledTools).toContain('whoami');
    expect(result.structuredContent.enabledTools).toContain('incident_search');
    expect(result.structuredContent.enabledTools).not.toContain('incident_resolve');
    expect(JSON.stringify(result)).not.toMatch(/email/i);
  });

  it('searches for "my incidents" by its content words', async () => {
    const result = await callTool('search_capabilities', { query: 'my incidents' });
    expect(result.structuredContent.operations.length).toBeGreaterThan(0);
    const source = readFileSync('src/lib/mcp/protocol/capability-search.ts', 'utf8');
    expect(source).not.toMatch(/^\s+'me',$/m);
    expect(source).not.toMatch(/^\s+'my',$/m);
  });
});

describe('A3: read_operation', () => {
  it('is annotated read-only and refuses a change before any work', async () => {
    const tools = await listTools();
    expect(tools.find(tool => tool.name === 'read_operation')?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const write = await callTool('read_operation', {
      operationId: 'resolveIncident',
      args: { path: { id: 'inc_1' } },
    });
    expect(write.isError).toBe(true);
    expect(write.content[0].text).toBe(
      'MCP_NOT_A_READ: This operation changes state; use call_operation.'
    );
    const gated = MCP_CATALOG.find(operation => operation.status === 'APPROVAL_REQUIRED')!;
    const approval = await callTool('read_operation', {
      operationId: gated.operationId,
      args: {},
    });
    expect(approval.content[0].text).toContain('use operation_prepare');
  });

  it('is what search and describe point reads to; describe drops audit text', async () => {
    const search = await callTool('search_capabilities', { query: 'services', intent: 'read' });
    const listServices = search.structuredContent.operations.find(
      (operation: { operationId: string }) => operation.operationId === 'listServices'
    );
    expect(listServices.workflow).toBe('read_operation');
    const writes = await callTool('search_capabilities', { query: 'resolve incident' });
    expect(
      writes.structuredContent.operations.find(
        (operation: { operationId: string }) => operation.operationId === 'resolveIncident'
      ).workflow
    ).toBe('call_operation');
    const described = await callTool('describe_operation', { operationId: 'listServices' });
    expect(described.structuredContent.workflow).toBe('read_operation');
    expect(described.structuredContent).not.toHaveProperty('reason');
    expect(described.structuredContent).not.toHaveProperty('mutation');
  });
});

describe('A4: structured errors', () => {
  const problem = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/problem+json', ...headers },
    });

  it('forwards only a registered domain code, field rules and retryability, never detail', async () => {
    const error = await domainRejection(
      problem(400, {
        code: 'VALIDATION_FAILED',
        title: 'Secret title',
        detail: 'customer@example.com leaked',
        retryable: false,
        fields: [
          { field: 'body.title', code: 'too_small', message: 'secret value' },
          { field: 'bad field with spaces', code: 'x' },
          { field: 'body.urgency', code: 'invalid enum!' },
        ],
      })
    );
    expect(error).toMatchObject({ code: 'MCP_DOMAIN_REJECTED', status: 400, retryable: false });
    expect(error.domainCode).toBe('VALIDATION_FAILED');
    expect(error.fields).toEqual([{ field: 'body.title', code: 'too_small' }]);
    const text = toolErrorText(error);
    expect(text).toBe('MCP_DOMAIN_REJECTED (VALIDATION_FAILED): Not retryable.');
    const content = toolErrorContent(error, 'req-9');
    expect(content).toEqual({
      error: {
        code: 'MCP_DOMAIN_REJECTED',
        domainCode: 'VALIDATION_FAILED',
        fields: [{ field: 'body.title', code: 'too_small' }],
        retryable: false,
        requestId: 'req-9',
      },
    });
    expect(JSON.stringify(content)).not.toMatch(/Secret|leaked|secret value/);
  });

  it('drops an unregistered code and keeps a 429 wait', async () => {
    const error = await domainRejection(
      problem(429, { code: 'MADE_UP_CODE' }, { 'retry-after': '17' })
    );
    expect(error.domainCode).toBeUndefined();
    expect(error.retryAfterSeconds).toBe(17);
    expect(toolErrorText(error)).toBe('MCP_DOMAIN_REJECTED: Retryable after 17s.');
    const missing = await domainRejection(problem(404, { code: 'NOT_FOUND' }));
    expect(missing.code).toBe('MCP_RESOURCE_UNAVAILABLE');
  });

  it('has hints for the refusals an assistant must explain', () => {
    for (const code of [
      'MCP_OPERATION_FORBIDDEN',
      'MCP_OPERATION_DISABLED',
      'MCP_RESOURCE_UNAVAILABLE',
      'MCP_DEADLINE_EXCEEDED',
      'MCP_OPERATION_BUDGET_EXCEEDED',
      'MCP_RESULT_BUDGET_EXCEEDED',
    ])
      expect(toolErrorText(new McpBoundaryError(code, 400)).startsWith(`${code}: `), code).toBe(
        true
      );
  });

  it('gives every tool error structured content with the request id', async () => {
    const result = await callTool('describe_operation', { operationId: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({
      code: 'MCP_OPERATION_UNAVAILABLE',
      requestId: 'req-1',
    });
    expect(result.structuredContent.error.hint).toContain('search_capabilities');
  });

  it('turns an oversized result into a hinted tool error, not a transport failure', async () => {
    const result = await callTool(
      'describe_operation',
      { operationId: 'createIncident' },
      { budget: new CostBudget(8, 4096) }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'MCP_RESULT_BUDGET_EXCEEDED: Result too large; lower query.limit or narrow the filters. Not retryable as-is.'
    );
    const fits = await callTool('describe_operation', { operationId: 'createIncident' });
    expect(fits.isError).not.toBe(true);
  });

  it('names the failing plan path, never the value, and keeps a step hint', async () => {
    const invalid = await callTool('execute_plan', {
      steps: [{ id: 'bad id!', operationId: 'listServices', args: {} }],
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain('MCP_UNAVAILABLE');
    const plan = await executeMcpPlan(context(), {
      steps: [
        {
          id: 'one',
          operationId: 'listServices',
          args: { query: { bogus: 'secret-value' } },
          dependsOn: [],
        },
      ],
    });
    expect(plan.steps[0]).toMatchObject({ status: 'failed', error: 'MCP_INVALID_ARGUMENTS' });
    expect(plan.steps[0].hint).toMatch(/\/query .*\(bogus\)/);
    expect(JSON.stringify(plan)).not.toContain('secret-value');
  });

  it('sends the real Retry-After on 429', async () => {
    const limited = mcpHttpError(
      new McpBoundaryError('MCP_RATE_LIMITED', 429, true, undefined, { retryAfterSeconds: 37 })
    );
    expect(limited.headers.get('retry-after')).toBe('37');
    expect(mcpHttpError(new McpBoundaryError('MCP_DISABLED', 503)).headers.get('retry-after')).toBe(
      '5'
    );
  });
});

describe('A5: page size in the wire view', () => {
  it('advertises at most MCP_MAX_PAGE_SIZE on every list read, without touching the contract', async () => {
    const tools = await listTools();
    const lists = MCP_CATALOG.filter(
      operation =>
        isMcpExecutable(operation) &&
        operation.kind === 'list' &&
        (operation.inputSchema.properties.query as { properties?: { limit?: unknown } })?.properties
          ?.limit
    );
    expect(lists.length).toBeGreaterThan(10);
    for (const operation of lists) {
      const before = mcpContractHash(operation);
      const wire = clampPageSize(operation, operation.inputSchema);
      const limit = (
        wire.properties as Record<string, { properties: Record<string, Record<string, unknown>> }>
      ).query.properties.limit;
      expect(limit.maximum, operation.operationId).toBeLessThanOrEqual(MCP_MAX_PAGE_SIZE);
      expect(limit.minimum).toBe(1);
      expect(String(limit.description)).toContain('nextCursor');
      expect(mcpContractHash(operation)).toBe(before);
      expect(before).toBe(operation.contractSha256);
    }
    const search = tools.find(tool => tool.name === 'incident_search')!;
    expect(
      (search.inputSchema.properties as { query: { properties: { limit: { maximum: number } } } })
        .query.properties.limit.maximum
    ).toBe(MCP_MAX_PAGE_SIZE);
    const described = await callTool('describe_operation', { operationId: 'listSavedReports' });
    expect(described.structuredContent.inputSchema.properties.query.properties.limit.maximum).toBe(
      MCP_MAX_PAGE_SIZE
    );
  });

  it('advertises the default page size execution actually applies', () => {
    const base = MCP_CATALOG.find(
      operation =>
        isMcpExecutable(operation) &&
        operation.kind === 'list' &&
        (operation.inputSchema.properties.query as { properties?: { limit?: unknown } })?.properties
          ?.limit
    )!;
    for (const canonical of [undefined, 10, 50, 100]) {
      const query = base.inputSchema.properties.query as { properties: Record<string, unknown> };
      const operation = {
        ...base,
        inputSchema: {
          ...base.inputSchema,
          properties: {
            ...base.inputSchema.properties,
            query: {
              ...query,
              properties: {
                ...query.properties,
                limit: {
                  type: 'integer',
                  ...(canonical === undefined ? {} : { default: canonical }),
                },
              },
            },
          },
        },
      } as typeof base;
      const wire = clampPageSize(operation, operation.inputSchema);
      const limit = (
        wire.properties as Record<string, { properties: Record<string, Record<string, unknown>> }>
      ).query.properties.limit;
      // What describe_operation says an omitted limit means is what execution applies.
      expect(limit.default, String(canonical)).toBe(mcpPageSize(operation, null));
    }
  });
});

describe('A6: titles and annotations', () => {
  it('gives every tool a title', async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThan(25);
    for (const tool of tools) expect(tool.title?.trim(), tool.name).toBeTruthy();
    for (const tool of tools) expect(tool.title, tool.name).not.toBe(tool.name);
  });

  it('pins the reviewed annotations of the curated writes and the built-in reads', async () => {
    const tools = new Map((await listTools()).map(tool => [tool.name, tool.annotations]));
    expect(tools.get('incident_add_note')).toMatchObject({
      destructiveHint: false,
      openWorldHint: false,
    });
    for (const name of ['incident_acknowledge', 'incident_assign', 'incident_resolve'])
      expect(tools.get(name), name).toMatchObject({ destructiveHint: true, openWorldHint: true });
    expect(tools.get('incident_create')).toMatchObject({
      destructiveHint: false,
      openWorldHint: true,
    });
    for (const name of [
      'incident_get_context',
      'search_capabilities',
      'describe_operation',
      'execute_plan',
      'read_operation',
    ])
      expect(tools.get(name), name).toMatchObject({ readOnlyHint: true, idempotentHint: true });
  });
});

describe('A7: instructions and approval wording', () => {
  it('stays within 300 bytes', () => {
    expect(Buffer.byteLength(MCP_SERVER_INSTRUCTIONS)).toBeLessThanOrEqual(300);
  });

  it('never says a different person must approve', () => {
    for (const file of [
      'src/lib/mcp/protocol/server.ts',
      'src/lib/mcp/approvals/operation.ts',
      'src/lib/mcp/approvals/runbook.ts',
      'src/lib/mcp/catalog/capabilities.ts',
      'src/components/settings/mcp/sections/McpApprovalsSection.tsx',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(
        /different authorized|independently approved|different administrator|different person than|other than the requester|cannot approve their own/
      );
    }
  });
});

describe('A8: prompts follow their tools', () => {
  const promptNames = async (options: Options) =>
    ((await rpc('prompts/list', {}, options)).result.prompts as { name: string; title: string }[])
      .map(prompt => prompt.name)
      .sort();

  it('registers a prompt only when the tools it directs to are available', async () => {
    const all = await promptNames({});
    expect(all).toEqual([
      'explain_escalation',
      'investigate_incident',
      'prepare_postmortem',
      'preview_remediation',
      'review_automation_rule',
      'summarize_shift',
    ]);
    const incidentsOnly = await promptNames({ actor: actorWith(['incidents:read']) });
    expect(incidentsOnly).toEqual(['investigate_incident']);
    const withheld = await promptNames({ disabled: ['incident_get_context'] });
    expect(withheld).not.toContain('investigate_incident');
    expect(withheld).not.toContain('prepare_postmortem');
    expect(withheld).toContain('summarize_shift');
  });
});

describe('A10: result links', () => {
  it('links a single entity to its resource and page, only when the resource is readable', () => {
    vi.stubEnv('MCP_PUBLIC_ORIGIN', 'https://ops.example.com');
    const links = resultLinks(
      'getIncident',
      { path: { id: 'inc_1' } },
      {},
      new Set(['incidents'] as const)
    );
    expect(links).toEqual([
      {
        type: 'resource_link',
        uri: 'opsknight://incidents/inc_1',
        name: 'incidents/inc_1',
        mimeType: 'application/json',
      },
      {
        type: 'resource_link',
        uri: 'https://ops.example.com/incidents/inc_1',
        name: 'Open in OpsKnight',
        mimeType: 'text/html',
        annotations: { audience: ['user'] },
      },
    ]);
    expect(
      resultLinks(
        'createIncident',
        {},
        { data: { data: { id: 'inc_2' } } },
        new Set(['incidents'] as const)
      )[0].uri
    ).toBe('opsknight://incidents/inc_2');
    // Not readable here, a list, or an id that is not an identifier: no links.
    expect(resultLinks('getIncident', { path: { id: 'inc_1' } }, {}, new Set())).toEqual([]);
    expect(resultLinks('listIncidents', {}, {}, new Set(['incidents'] as const))).toEqual([]);
    expect(
      resultLinks('getIncident', { path: { id: '../x' } }, {}, new Set(['incidents'] as const))
    ).toEqual([]);
    vi.unstubAllEnvs();
  });
});

describe('E1: unexpected tool errors are logged without arguments', () => {
  it('logs the request id, tool, grant and Prisma code', async () => {
    const error = Object.assign(new Error('pool timeout with secret-arg'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2024',
    });
    vi.spyOn(prisma.user, 'findUnique').mockRejectedValue(error);
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const result = await callTool('whoami', {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toEqual({ code: 'MCP_UNAVAILABLE', requestId: 'req-1' });
    expect(log).toHaveBeenCalledWith('mcp.tool.unexpected_error', {
      requestId: 'req-1',
      tool: 'whoami',
      grantId: 'grant',
      errorName: 'PrismaClientKnownRequestError',
      prismaCode: 'P2024',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-arg');
  });

  it('does not log an expected refusal', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    await callTool('describe_operation', { operationId: 'nope' });
    expect(log).not.toHaveBeenCalled();
  });
});
