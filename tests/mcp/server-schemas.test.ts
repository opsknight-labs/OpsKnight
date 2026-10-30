import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer, createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { createOpsKnightMcpServer, operationPrepareSchema } from '@/lib/mcp/protocol/server';
import { CostBudget } from '@/lib/mcp/core/budget';
import { supportedMcpScopes } from '@/lib/mcp/auth/scopes';

const scopes = [...supportedMcpScopes()].filter(scope => scope !== 'admin:manage');
const actor = {
  id: 'user',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
  apiKey: { id: 'grant', scopes },
};
const context = () => ({
  grantId: 'grant',
  tokenScopes: scopes,
  requestId: 'test',
  budget: new CostBudget(),
});

/** Tool name to the inputSchema object handed to the SDK for one server construction. */
function registeredSchemas() {
  const spy = vi.spyOn(McpServer.prototype, 'registerTool');
  try {
    createOpsKnightMcpServer(context(), actor, true, true);
    return new Map(
      spy.mock.calls.map(([name, config]) => [
        name,
        (config as { inputSchema?: unknown }).inputSchema,
      ])
    );
  } finally {
    spy.mockRestore();
  }
}

const handlers: McpHttpHandler[] = [];
afterEach(async () => {
  await Promise.all(handlers.splice(0).map(handler => handler.close()));
});
function call(name: string, args: Record<string, unknown>) {
  const handler = createMcpHandler(() => createOpsKnightMcpServer(context(), actor, true, true), {
    legacy: 'reject',
    responseMode: 'auto',
    maxSubscriptions: 0,
  });
  handlers.push(handler);
  return handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'schema-test', version: '1' },
          },
        },
      }),
    })
  );
}

describe('per-request MCP server construction', () => {
  // The SDK compiles every tool schema into a process-wide cache keyed by object identity and never
  // evicts it; a fresh schema object per request is a leak of its compiled validator.
  it('hands the SDK the same schema objects on every construction', () => {
    const first = registeredSchemas();
    const second = registeredSchemas();
    expect(first.size).toBeGreaterThan(25);
    for (const [name, schema] of first) {
      expect(schema, name).toBeDefined();
      expect(second.get(name), name).toBe(schema);
    }
  });

  it('caches operation_prepare schemas by operation set, bounded', () => {
    const schema = operationPrepareSchema(['b', 'a']);
    expect(operationPrepareSchema(['a', 'b'])).toBe(schema);
    expect(operationPrepareSchema(['a'])).not.toBe(schema);
    // Touch the entry so it is most recently used, then overflow the cache with other sets.
    for (let index = 0; index < 64; index++) {
      operationPrepareSchema(['a', 'b']);
      operationPrepareSchema([`other-${index}`]);
    }
    expect(operationPrepareSchema(['a', 'b'])).toBe(schema);
    const evicted = operationPrepareSchema(['other-0']);
    expect(operationPrepareSchema(['other-0'])).toBe(evicted);
  });
});

describe('defaulted tool fields', () => {
  it('lets search_capabilities omit cursor', async () => {
    const body = await (await call('search_capabilities', { query: 'incident' })).json();
    expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
    expect(body.result.structuredContent.operations.length).toBeGreaterThan(0);
  });

  it('lets runbook_prepare_execution omit parameters', async () => {
    const schema = registeredSchemas().get('runbook_prepare_execution') as {
      '~standard': { validate: (value: unknown) => { issues?: unknown[] } };
    };
    const args = { runbookId: 'rb_1', body: {}, idempotencyKey: 'key-1' };
    expect(schema['~standard'].validate(args).issues).toBeUndefined();
    const body = await (await call('runbook_prepare_execution', args)).json();
    expect(JSON.stringify(body)).not.toContain('Input validation error');
  });
});
