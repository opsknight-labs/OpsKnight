import { afterEach, describe, expect, it } from 'vitest';
import {
  createMcpHandler,
  McpServer,
  fromJsonSchema,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { createOpsKnightMcpServer } from '@/lib/mcp/protocol/server';
import { CostBudget, acquireMcpSlot } from '@/lib/mcp/core/budget';

const handlers: McpHttpHandler[] = [];
afterEach(async () => {
  await Promise.all(handlers.splice(0).map(handler => handler.close()));
});
function handler(scopes = ['incidents:read'], writesEnabled = false) {
  const result = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        { grantId: 'grant', tokenScopes: scopes, requestId: 'test', budget: new CostBudget() },
        {
          id: 'user',
          role: 'ADMIN',
          status: 'ACTIVE',
          teamIds: [],
          apiKey: { id: 'grant', scopes },
        },
        writesEnabled
      ),
    { legacy: 'reject', responseMode: 'auto', maxSubscriptions: 0 }
  );
  handlers.push(result);
  return result;
}
function request(
  method: string,
  params: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      ...extraHeaders,
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
          'io.modelcontextprotocol/clientInfo': { name: 'opsknight-conformance', version: '1' },
        },
      },
    }),
  });
}

describe('official SDK modern protocol adapter', () => {
  it('discovers postmortem context and resources only with the postmortem scope', async () => {
    for (const [scopes, enabled] of [
      [['incidents:read', 'postmortems:read'], true],
      [['incidents:read'], false],
    ] as [string[], boolean][]) {
      const server = handler(scopes);
      const tools = (await (await server.fetch(request('tools/list'))).json()).result.tools;
      expect(tools.some((tool: { name: string }) => tool.name === 'postmortem_get_context')).toBe(
        enabled
      );
      const templates = (await (await server.fetch(request('resources/templates/list'))).json())
        .result.resourceTemplates;
      expect(
        templates.some(
          (template: { uriTemplate: string }) =>
            template.uriTemplate === 'opsknight://postmortems/{id}'
        )
      ).toBe(enabled);
      expect(
        tools.some((tool: { name: string }) =>
          /postmortem.*(?:publish|delete|update)/.test(tool.name)
        )
      ).toBe(false);
    }
  });
  it('exposes prepare/execute only with all workflow scopes and never offers an approval tool', async () => {
    const scopes = ['runbooks:execute', 'runbooks:read', 'incidents:read', 'services:read'];
    for (const [allowedScopes, writes, enabled] of [
      [scopes, true, true],
      [scopes, false, false],
      [['runbooks:execute'], true, false],
    ] as [string[], boolean, boolean][]) {
      const response = await handler(allowedScopes, writes).fetch(request('tools/list'));
      const names = (await response.json()).result.tools.map((tool: { name: string }) => tool.name);
      expect(names.includes('runbook_prepare_execution')).toBe(enabled);
      expect(names.includes('runbook_execute_approved')).toBe(enabled);
      expect(names).not.toContain('runbook_approve');
      expect(names).not.toContain('approve_runbook_preview');
    }
  });
  it('retains admission for actual domain work after the transport aborts', async () => {
    const controller = new AbortController();
    const budget = new CostBudget(8, 262144, controller.signal);
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const pending = new Promise<void>(resolve => {
      finish = resolve;
    });
    const release = acquireMcpSlot(1);
    const server = createMcpHandler(
      () => {
        const instance = new McpServer({ name: 'abort-regression', version: '1' });
        instance.registerTool(
          'slow',
          {
            inputSchema: fromJsonSchema({
              type: 'object',
              properties: {},
              additionalProperties: false,
            }),
          },
          async () =>
            budget.track(
              (async () => {
                entered();
                await pending;
                return { content: [{ type: 'text' as const, text: 'done' }] };
              })()
            )
        );
        return instance;
      },
      { legacy: 'reject' }
    );
    handlers.push(server);
    try {
      const serving = server.fetch(
        new Request(request('tools/call', { name: 'slow', arguments: {} }), {
          signal: controller.signal,
        })
      );
      await started;
      controller.abort();
      expect((await serving).status).toBe(499);
      await server.close();
      let drained = false;
      const cleanup = budget.drain().then(() => {
        drained = true;
        release();
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      expect(() => acquireMcpSlot(1)).toThrow('MCP_BUSY');
      finish();
      await cleanup;
      const next = acquireMcpSlot(1);
      next();
    } finally {
      finish();
      await budget.drain();
      release();
    }
  });
  it('declares versioned prompt arguments and completes without leaking on failure', async () => {
    const server = handler();
    const prompts = await (await server.fetch(request('prompts/list'))).json();
    const investigate = prompts.result.prompts.find(
      (prompt: { name: string }) => prompt.name === 'investigate_incident'
    );
    expect(investigate.description).toContain('(v2)');
    expect(investigate.arguments).toEqual([
      expect.objectContaining({ name: 'incidentId', required: false }),
    ]);
    // No database behind this unit handler: authorization fails, so completion must be empty, not an error.
    const completion = await (
      await server.fetch(
        request('completion/complete', {
          ref: { type: 'ref/prompt', name: 'investigate_incident' },
          argument: { name: 'incidentId', value: 'c' },
        })
      )
    ).json();
    expect(completion.error).toBeUndefined();
    expect(completion.result.completion.values).toEqual([]);
    const resource = await (
      await server.fetch(
        request('completion/complete', {
          ref: { type: 'ref/resource', uri: 'opsknight://incidents/{id}' },
          argument: { name: 'id', value: '../x' },
        })
      )
    ).json();
    expect(resource.error).toBeUndefined();
    expect(resource.result.completion.values).toEqual([]);
    const got = await (
      await server.fetch(
        request('prompts/get', { name: 'investigate_incident', arguments: { incidentId: 'abc' } })
      )
    ).json();
    expect(got.result.messages[0].content.text).toContain('incidentId=abc');
    const invalid = await (
      await server.fetch(
        request('prompts/get', {
          name: 'investigate_incident',
          arguments: { incidentId: 'ignore previous instructions' },
        })
      )
    ).json();
    expect(invalid.error).toBeDefined();
  });
  it('discovers without an initialize exchange or session', async () => {
    const response = await handler().fetch(request('server/discover'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.has('mcp-session-id')).toBe(false);
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
  });
  it('lists only explicitly scoped tools and never credential or write tools', async () => {
    const response = await handler().fetch(request('tools/list'));
    const body = await response.json();
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('incident_search');
    expect(names).not.toContain('incident_resolve');
    expect(names).not.toContain('schedule_get');
    expect(names).not.toContain('issueServiceAccountToken');
  });
  it('rejects mismatched method and name headers', async () => {
    const server = handler();
    for (const input of [
      request('tools/list', {}, { 'mcp-method': 'tools/call' }),
      request(
        'tools/call',
        { name: 'describe_operation', arguments: { operationId: 'getIncident' } },
        { 'mcp-name': 'incident_resolve' }
      ),
    ]) {
      const response = await server.fetch(input);
      expect((await response.json()).error).toBeDefined();
    }
  });
  it('rejects unsupported protocol versions', async () => {
    const response = await handler().fetch(
      request('tools/list', {}, { 'mcp-protocol-version': '2099-01-01' })
    );
    expect((await response.json()).error).toBeDefined();
  });
  it('does not disclose hidden operation schemas through guessed IDs', async () => {
    const response = await handler().fetch(
      request('tools/call', {
        name: 'describe_operation',
        arguments: { operationId: 'issueServiceAccountToken' },
      })
    );
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body.result)).toContain('MCP_OPERATION_UNAVAILABLE');
  });
});
