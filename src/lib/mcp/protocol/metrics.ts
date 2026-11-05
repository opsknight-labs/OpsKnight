import { MCP_CATALOG } from '../catalog';
import { McpBoundaryError } from '../core/errors';

/** Every value the `outcome` label of opsknight_mcp_requests_total can take. */
export const MCP_METRIC_OUTCOMES = [
  'served',
  'task_created',
  'tool_error',
  'notification',
  'protocol_rejected',
  'subscription_opened',
  'subscription_rejected',
  'unauthenticated',
  'forbidden',
  'rate_limited',
  'busy',
  'result_too_large',
  'disabled',
  'unavailable',
  'invalid_request',
  'error',
] as const;
export type McpMetricOutcome = (typeof MCP_METRIC_OUTCOMES)[number];

/**
 * Outcomes whose request reached domain work. Only these are timed, so sub-millisecond rejections
 * (429, 401, busy) cannot pull the latency percentiles of served calls down.
 */
export const MCP_TIMED_OUTCOMES: ReadonlySet<McpMetricOutcome> = new Set([
  'served',
  'tool_error',
  'task_created',
  'result_too_large',
]);

/** Upper bound on distinct `tool` label values; a test pins the actual set below it. */
export const MCP_METRIC_TOOL_LABEL_LIMIT = 48;

const STANDALONE_TOOLS = [
  'whoami',
  'search_capabilities',
  'describe_operation',
  'read_operation',
  'call_operation',
  'execute_plan',
  'incident_get_context',
  'postmortem_get_context',
  'operation_prepare',
  'operation_get_approval',
  'operation_commit_approved',
  'runbook_prepare_execution',
  'runbook_execute_approved',
  'runbook_get_approval',
];

/** The bounded tool label values: named tools, `other` for anything else and `none` off tools/call. */
export const MCP_METRIC_TOOLS: ReadonlySet<string> = new Set([
  ...STANDALONE_TOOLS,
  ...MCP_CATALOG.flatMap(operation => (operation.tool ? [operation.tool] : [])),
  'other',
  'none',
]);

/** The tool label for one request: never a caller-chosen string outside the fixed set. */
export function mcpMetricTool(method: string, name: unknown) {
  if (method !== 'tools/call') return 'none';
  return typeof name === 'string' && MCP_METRIC_TOOLS.has(name) && name !== 'none' ? name : 'other';
}

/** The outcome label for a request that failed before or outside a tool result. */
export function mcpErrorOutcome(error: unknown): McpMetricOutcome {
  if (!(error instanceof McpBoundaryError)) return 'error';
  switch (error.code) {
    case 'MCP_RATE_LIMITED':
      return 'rate_limited';
    case 'MCP_BUSY':
    case 'MCP_SUBSCRIPTIONS_BUSY':
      return 'busy';
    case 'MCP_RESULT_BUDGET_EXCEEDED':
      return 'result_too_large';
    case 'MCP_DISABLED':
      return 'disabled';
    case 'MCP_UNAVAILABLE':
      return 'unavailable';
  }
  // Every 429 is a limit the caller hit (quota, subscription cap, plan budget), whatever its code.
  if (error.status === 429) return 'rate_limited';
  if (error.status === 401) return 'unauthenticated';
  if (error.status === 403) return 'forbidden';
  if (error.status >= 500) return 'unavailable';
  return 'invalid_request';
}

/** Whether a buffered tools/call response carries an isError tool result (JSON or one SSE frame). */
export async function mcpToolErrored(response: Response) {
  const type = response.headers.get('content-type') ?? '';
  try {
    const text = await response.clone().text();
    const messages = type.includes('text/event-stream')
      ? text
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => JSON.parse(line.slice(5)) as unknown)
      : [JSON.parse(text) as unknown];
    return messages.some(
      message => (message as { result?: { isError?: unknown } })?.result?.isError === true
    );
  } catch {
    return false;
  }
}
