/**
 * Tool-selection eval: does a model pick the right OpsKnight MCP tool for realistic asks?
 *
 *   npm run mcp:eval                      # dry run: validate the dataset against the current tool list
 *   ANTHROPIC_API_KEY=... npm run mcp:eval -- [--model=claude-haiku-5-5] [--limit=N]
 *
 * The tool list is built in-process for each persona, the way tests/mcp/tools-list-contract.test.ts
 * builds it, so the eval always sees exactly what a connected assistant would. With a key it sends
 * one Messages API request per task (plain fetch) and scores the first tool the model calls ("none"
 * when it answers or asks a question instead); for operation_prepare the operationId must match too.
 * Tasks: tests/mcp/evals/tool-selection.jsonl.
 */
import { readFileSync } from 'node:fs';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createOpsKnightMcpServer } from '@/lib/mcp/protocol/server';
import { CostBudget } from '@/lib/mcp/core/budget';
import { supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import { MCP_CATALOG, isMcpApprovalGated } from '@/lib/mcp/catalog';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const DATASET = 'tests/mcp/evals/tool-selection.jsonl';
const PERSONAS = { responder: 'RESPONDER', team_lead: 'RESPONDER', admin: 'ADMIN' } as const;
const CATEGORIES = ['read', 'change', 'ambiguous'] as const;

type Persona = keyof typeof PERSONAS;
type Task = {
  id: string;
  persona: Persona;
  category: (typeof CATEGORIES)[number];
  prompt: string;
  expected: string[];
  operationId?: string;
};
type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> };

export function loadTasks(path = DATASET): Task[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- repository dataset path
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as Task);
}

/** tools/list for one persona with writes allowed, exactly as the server answers it. */
export async function listTools(persona: Persona): Promise<Tool[]> {
  const role = PERSONAS[persona];
  const scopes =
    role === 'ADMIN'
      ? [...supportedMcpScopes()].filter(scope => scope !== 'admin:manage')
      : [...mcpScopesUsableByRole(role)];
  const actor: AuthorizationActor = {
    id: 'eval-user',
    role,
    status: 'ACTIVE',
    teamIds: ['eval-team'],
    apiKey: { id: 'eval-grant', scopes },
  };
  const handler = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        { grantId: 'eval-grant', tokenScopes: scopes, requestId: 'eval', budget: new CostBudget() },
        actor,
        true,
        false,
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
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'tool-selection-eval', version: '1' },
            },
          },
        }),
      })
    );
    return ((await response.json()) as { result: { tools: Tool[] } }).result.tools;
  } finally {
    await handler.close();
  }
}

/** Every problem with the dataset against the current tool list and catalog; empty when valid. */
export function validateTasks(tasks: Task[], tools: Record<Persona, Tool[]>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const gated = new Set(MCP_CATALOG.filter(isMcpApprovalGated).map(op => op.operationId));
  for (const task of tasks) {
    const where = `task ${task.id ?? '?'}`;
    if (!task.id || ids.has(task.id)) problems.push(`${where}: missing or duplicate id`);
    ids.add(task.id);
    if (!(task.persona in PERSONAS)) problems.push(`${where}: unknown persona ${task.persona}`);
    if (!CATEGORIES.includes(task.category)) problems.push(`${where}: unknown category`);
    if (!task.prompt?.trim()) problems.push(`${where}: empty prompt`);
    if (!Array.isArray(task.expected) || !task.expected.length)
      problems.push(`${where}: no expected tool`);
    const names = new Set((tools[task.persona] ?? []).map(tool => tool.name));
    for (const name of task.expected ?? [])
      if (name !== 'none' && !names.has(name))
        problems.push(`${where}: expected tool ${name} is not offered to ${task.persona}`);
    if (task.expected?.includes('operation_prepare') !== Boolean(task.operationId))
      problems.push(`${where}: operationId goes with operation_prepare, and only with it`);
    if (task.operationId && !gated.has(task.operationId))
      problems.push(`${where}: ${task.operationId} is not an approval-gated operation`);
  }
  return problems;
}

const SYSTEM =
  "You are an assistant connected to the user's OpsKnight incident-management installation " +
  'through MCP. Use a tool when one fits the request. If the request is too vague to act on, ' +
  'ask one short clarifying question instead of calling a tool.';

/** One Messages API call; returns the first tool the model chose, or "none". */
async function choose(task: Task, tools: Tool[], model: string, apiKey: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description ?? '',
        input_schema: tool.inputSchema,
      })),
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: task.prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Messages API ${response.status}: ${await response.text()}`);
  const message = (await response.json()) as {
    content: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
  };
  const call = message.content.find(block => block.type === 'tool_use');
  return { tool: call?.name ?? 'none', operationId: call?.input?.operationId };
}

function argument(name: string) {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const tasks = loadTasks();
  const tools = Object.fromEntries(
    await Promise.all(
      (Object.keys(PERSONAS) as Persona[]).map(async persona => [persona, await listTools(persona)])
    )
  ) as Record<Persona, Tool[]>;
  const problems = validateTasks(tasks, tools);
  if (problems.length) {
    problems.forEach(problem => console.error(`INVALID  ${problem}`));
    process.exitCode = 1;
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log(
      `Dry run: ${tasks.length} tasks valid against the current tool list ` +
        `(${Object.entries(tools)
          .map(([persona, list]) => `${persona} ${list.length} tools`)
          .join(', ')}). Set ANTHROPIC_API_KEY to score a model.`
    );
    return;
  }
  const model = argument('model') ?? process.env.MCP_EVAL_MODEL ?? 'claude-haiku-5-5';
  const limit = Number(argument('limit') ?? tasks.length);
  const score = new Map<string, { pass: number; total: number }>();
  for (const task of tasks.slice(0, limit)) {
    const picked = await choose(task, tools[task.persona], model, apiKey);
    const ok =
      task.expected.includes(picked.tool) &&
      (!task.operationId ||
        picked.tool !== 'operation_prepare' ||
        picked.operationId === task.operationId);
    for (const key of [task.category, 'overall']) {
      const row = score.get(key) ?? { pass: 0, total: 0 };
      row.total += 1;
      if (ok) row.pass += 1;
      score.set(key, row);
    }
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${task.id}  picked ${picked.tool}` +
        `${picked.operationId ? ` (${String(picked.operationId)})` : ''}; expected ${task.expected.join(' | ')}` +
        `${task.operationId ? ` (${task.operationId})` : ''}`
    );
  }
  console.log(`\nModel ${model}`);
  for (const [key, row] of score)
    console.log(
      `${key.padEnd(10)} ${row.pass}/${row.total} (${Math.round((100 * row.pass) / row.total)}%)`
    );
}

if (require.main === module)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
