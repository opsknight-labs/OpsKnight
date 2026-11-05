/**
 * DX-6: the generated per-tool reference (docs/v2.2.0/reference/mcp/tools.md). Built from the
 * server's own tools/list and prompts/list, so it lists exactly what assistants are offered; the
 * catalog supplies scopes, domains and the approval workflow. `npm run mcp:docs` writes it and
 * `mcp:docs:check` fails when it drifts.
 */
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createOpsKnightMcpServer } from '../../src/lib/mcp/protocol/server';
import { CostBudget } from '../../src/lib/mcp/core/budget';
import { supportedMcpScopes } from '../../src/lib/mcp/auth/scopes';
import { MCP_CATALOG, isMcpApprovalGated } from '../../src/lib/mcp/catalog';
import { MCP_CAPABILITIES } from '../../src/lib/mcp/catalog/capabilities';
import type { AuthorizationActor } from '../../src/lib/authorization-policy';

export const MCP_TOOLS_PAGE = 'docs/v2.2.0/reference/mcp/tools.md';

type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
};
type ListedTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
};
type ListedPrompt = {
  name: string;
  title?: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
};

/** One RPC against a freshly built server, as an administrator with every scope. */
async function list<T>(method: 'tools/list' | 'prompts/list', writes: boolean, sensitive: boolean) {
  const scopes = [...supportedMcpScopes()].sort();
  const actor: AuthorizationActor = {
    id: 'docs',
    role: 'ADMIN',
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'docs', scopes },
  };
  const handler = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        { grantId: 'docs', tokenScopes: scopes, requestId: 'docs', budget: new CostBudget() },
        actor,
        writes,
        sensitive,
        []
      ),
    { legacy: 'stateless', responseMode: 'json', maxSubscriptions: 0 }
  );
  try {
    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
      })
    );
    const text = await response.text();
    const json = text.includes('data:')
      ? text
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5))
          .join('')
      : text;
    const result = (JSON.parse(json) as { result: Record<string, T[]> }).result;
    return result[method === 'tools/list' ? 'tools' : 'prompts'];
  } finally {
    await handler.close();
  }
}

// Backslashes first, so an escaped pipe in the input cannot end a table cell.
const cell = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function typeOf(schema: JsonSchema): string {
  // Long enums (operation ids) would swamp the table; their members are listed elsewhere.
  if (schema.enum)
    return schema.enum.length > 8
      ? `one of ${schema.enum.length} values`
      : schema.enum.map(value => JSON.stringify(value)).join(' | ');
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(' or ');
  const type = Array.isArray(schema.type) ? schema.type.join(' or ') : (schema.type ?? 'any');
  return type === 'array' && schema.items ? `array of ${typeOf(schema.items)}` : type;
}

const hint = (value: boolean | undefined) => (value === undefined ? '—' : value ? 'yes' : 'no');

/** `verifiedAt` is the date the hand-written docs were last checked (MCP_DOCS_VERIFIED_AT). */
export async function renderTools(verifiedAt: string) {
  // The same server under each policy combination: a tool missing without changes (or without
  // sensitive reads) needs that switch on.
  const [full, base, writesOnly, sensitiveOnly, prompts] = await Promise.all([
    list<ListedTool>('tools/list', true, true),
    list<ListedTool>('tools/list', false, false),
    list<ListedTool>('tools/list', true, false),
    list<ListedTool>('tools/list', false, true),
    list<ListedPrompt>('prompts/list', true, true),
  ]);
  const withoutChanges = new Set(sensitiveOnly.map(tool => tool.name));
  const withoutSensitive = new Set(writesOnly.map(tool => tool.name));
  const capability = new Map(MCP_CAPABILITIES.map(entry => [entry.id, entry]));
  const operationFor = new Map(
    MCP_CATALOG.filter(operation => operation.tool).map(operation => [operation.tool!, operation])
  );
  const domainOf = (name: string) =>
    operationFor.get(name)?.domain ?? capability.get(name)?.domain ?? 'mcp';
  const domains = [...new Set(full.map(tool => domainOf(tool.name)))].sort();

  const lines = [
    '---',
    'title: MCP tool reference',
    'order: 3',
    "description: Every tool and prompt the OpsKnight MCP server offers, with its hints, scopes, requirements and inputs. Generated from the server's own tool list.",
    'type: reference',
    'product_area: mcp',
    'audience: [developer, administrator]',
    'verification:',
    '  level: source',
    `  verified_at: ${verifiedAt}`,
    '  evidence:',
    '    - src/lib/mcp/protocol/server.ts',
    '    - src/lib/mcp/catalog/capabilities.ts',
    '    - scripts/mcp/docs-tools.ts',
    '---',
    '',
    '# MCP tool reference',
    '',
    '<!-- Generated by npm run mcp:docs from the server tool list; do not edit by hand. -->',
    '',
    `The server offers up to **${full.length} tools** and **${prompts.length} prompts**. What a session sees is narrower: its consented scopes, the person's role, the administrator's policy and exposed capabilities all filter the list. With changes and sensitive reads off, ${base.length} remain. Scopes are explained in the [permissions reference](permissions.md); the operations behind \`read_operation\`, \`call_operation\` and \`operation_prepare\` are counted there.`,
    '',
    'Requirements: **Changes** means the tool is offered only when the policy allows changes; **Sensitive reads** means only when sensitive reads are on; **Approval** means the change waits for a person to approve it in OpsKnight.',
    '',
  ];
  for (const domain of domains) {
    lines.push(`## ${domain}`, '');
    for (const tool of full
      .filter(entry => domainOf(entry.name) === domain)
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const operation = operationFor.get(tool.name);
      const needs = [
        withoutChanges.has(tool.name) ? null : 'Changes',
        withoutSensitive.has(tool.name) ? null : 'Sensitive reads',
        (operation && isMcpApprovalGated(operation)) || capability.get(tool.name)?.approval
          ? 'Approval'
          : null,
      ].filter(Boolean);
      lines.push(
        `### \`${tool.name}\``,
        '',
        ...(tool.title ? [`**${cell(tool.title)}.** ${cell(tool.description ?? '')}`, ''] : []),
        `| Read only | Destructive | Idempotent | Scopes | Requires |`,
        '| --- | --- | --- | --- | --- |',
        `| ${hint(tool.annotations?.readOnlyHint)} | ${hint(tool.annotations?.destructiveHint)} | ${hint(tool.annotations?.idempotentHint)} | ${
          operation?.requiredScopes.length
            ? operation.requiredScopes.map(scope => `\`${scope}\``).join(', ')
            : 'none of its own (an operation it reads or runs needs its scopes)'
        } | ${needs.join(', ') || '—'} |`,
        ''
      );
      const properties = Object.entries(tool.inputSchema.properties ?? {});
      if (properties.length) {
        const required = new Set(tool.inputSchema.required ?? []);
        lines.push(
          '| Parameter | Type | Required | Description |',
          '| --- | --- | --- | --- |',
          ...properties.map(
            ([name, schema]) =>
              `| \`${name}\` | ${cell(typeOf(schema))} | ${required.has(name) ? 'yes' : 'no'} | ${cell(schema.description ?? '')} |`
          ),
          ''
        );
      } else lines.push('No parameters.', '');
    }
  }
  lines.push(
    '## Prompts',
    '',
    'Prompts are guidance only and grant no authority. Each is offered only when the tools it relies on are.',
    '',
    '| Prompt | Title | Arguments |',
    '| --- | --- | --- |',
    ...prompts
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map(
        prompt =>
          `| \`${prompt.name}\` | ${cell(prompt.title ?? '')} | ${
            (prompt.arguments ?? [])
              .map(arg => `\`${arg.name}\`${arg.required ? ' (required)' : ''}`)
              .join(', ') || '—'
          } |`
      ),
    ''
  );
  return lines.join('\n');
}
