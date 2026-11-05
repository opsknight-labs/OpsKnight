import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { createOpsKnightMcpServer } from '@/lib/mcp/protocol/server';
import { CostBudget } from '@/lib/mcp/core/budget';
import { supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import type { AuthorizationActor } from '@/lib/authorization-policy';

/**
 * CERT-06: the tool list clients cache, as a reviewed contract. Any rename, schema, annotation or
 * tool-set change (including a role filter leaking a write tool) shows up as a snapshot diff that
 * must be reviewed and committed with `npx vitest run -c vitest.unit.config.ts -u <this file>`.
 * The explicit annotation assertions elsewhere stay; this is in addition to them.
 */
const allScopes = [...supportedMcpScopes()].filter(scope => scope !== 'admin:manage').sort();
const CASES = [
  { name: 'admin-all-scopes', role: 'ADMIN', scopes: allScopes },
  { name: 'responder', role: 'RESPONDER', scopes: [...mcpScopesUsableByRole('RESPONDER')].sort() },
  { name: 'read-only', role: 'USER', scopes: ['incidents:read', 'services:read'] },
] as const;

const handlers: McpHttpHandler[] = [];
afterEach(async () => {
  await Promise.all(handlers.splice(0).map(handler => handler.close()));
});

/** Stable JSON: object keys sorted at every depth, so hashes do not depend on insertion order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const sha = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');

async function listTools(
  role: AuthorizationActor['role'],
  scopes: readonly string[],
  writesEnabled: boolean,
  version: '2026-07-28' | '2025-11-25'
) {
  const actor: AuthorizationActor = {
    id: 'user_1',
    role,
    status: 'ACTIVE',
    teamIds: ['team_a'],
    apiKey: { id: 'grant', scopes },
  };
  const handler = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        { grantId: 'grant', tokenScopes: [...scopes], requestId: 'req', budget: new CostBudget() },
        actor,
        writesEnabled,
        false,
        []
      ),
    { legacy: 'stateless', responseMode: 'json', maxSubscriptions: 0 }
  );
  handlers.push(handler);
  const modern = version === '2026-07-28';
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': version,
        ...(modern ? { 'mcp-method': 'tools/list' } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: modern
          ? {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': version,
                'io.modelcontextprotocol/clientCapabilities': {},
                'io.modelcontextprotocol/clientInfo': { name: 'contract', version: '1' },
              },
            }
          : {},
      }),
    })
  );
  // Legacy revisions may answer as one SSE frame; the message is the same either way.
  const text = await response.text();
  const json = response.headers.get('content-type')?.includes('text/event-stream')
    ? text
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5))
        .join('')
    : text;
  const body = JSON.parse(json) as {
    result: {
      tools: {
        name: string;
        title?: string;
        description?: string;
        annotations?: unknown;
        inputSchema: unknown;
      }[];
    };
  };
  return body.result.tools
    .map(tool => ({
      name: tool.name,
      title: tool.title ?? null,
      annotations: tool.annotations ?? null,
      inputSchemaSha256: sha(tool.inputSchema),
      descriptionSha256: sha(tool.description ?? ''),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

describe('tools/list contract snapshots', () => {
  for (const testCase of CASES)
    for (const writes of [true, false])
      it(`${testCase.name}, changes ${writes ? 'on' : 'off'}`, async () => {
        const tools = await listTools(testCase.role, testCase.scopes, writes, '2026-07-28');
        expect(tools.length).toBeGreaterThan(0);
        await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot(
          `__contracts__/tools-${testCase.name}-${writes ? 'writes' : 'readonly'}.json`
        );
        // A 2025-revision client (served statelessly) sees exactly the same tools.
        expect(await listTools(testCase.role, testCase.scopes, writes, '2025-11-25')).toEqual(
          tools
        );
      });

  it('never offers a read-only session a tool that is not read-only', async () => {
    const tools = await listTools('USER', ['incidents:read', 'services:read'], false, '2026-07-28');
    const writers = tools.filter(
      tool => (tool.annotations as { readOnlyHint?: boolean } | null)?.readOnlyHint === false
    );
    // Generic gateways (call_operation, operation_prepare) self-describe as possibly writing.
    for (const tool of writers)
      expect([
        'call_operation',
        'operation_prepare',
        'operation_commit_approved',
        'runbook_prepare_execution',
        'runbook_execute_approved',
      ]).toContain(tool.name);
  });
});
