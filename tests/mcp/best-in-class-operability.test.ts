import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CostBudget,
  MCP_SLOT_WAIT_MS,
  acquireMcpSlot,
  mcpGrantSlotLimit,
  mcpSlotUsage,
  readmitMcpSlot,
} from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import {
  MCP_METRIC_OUTCOMES,
  MCP_METRIC_TOOLS,
  MCP_METRIC_TOOL_LABEL_LIMIT,
  mcpErrorOutcome,
  mcpMetricTool,
  mcpToolErrored,
} from '@/lib/mcp/protocol/metrics';
import {
  OPERATIONAL_METRICS,
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
  validateMetricDefinitions,
} from '@/lib/metrics/operational/registry';
import { MCP_CATALOG } from '@/lib/mcp/catalog';

const execution = vi.hoisted(() => ({ callMcpOperation: vi.fn() }));
vi.mock('@/lib/mcp/core/execution', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/mcp/core/execution')>()),
  callMcpOperation: execution.callMcpOperation,
}));
const { getMcpPostmortemContext } = await import('@/lib/mcp/core/postmortem');
const { completeAuthorizedIds } = await import('@/lib/mcp/protocol/completion');

const { checkMcpSetup } = createRequire(import.meta.url)(
  '../../scripts/mcp/doctor.cjs'
) as typeof import('../../scripts/mcp/doctor.cjs');

afterEach(() => {
  vi.useRealTimers();
  execution.callMcpOperation.mockReset();
});

const context = () => ({
  grantId: 'grant',
  tokenScopes: [],
  requestId: 'req',
  budget: new CostBudget(),
});

describe('E2: bounded MCP metrics', () => {
  it('labels every named tool, folds anything else into other, and fits the series estimate', () => {
    const named = MCP_CATALOG.flatMap(operation => (operation.tool ? [operation.tool] : []));
    for (const tool of [...named, 'whoami', 'read_operation', 'execute_plan'])
      expect(mcpMetricTool('tools/call', tool)).toBe(tool);
    expect(mcpMetricTool('tools/call', 'attacker_chosen_name')).toBe('other');
    expect(mcpMetricTool('tools/call', 'none')).toBe('other');
    expect(mcpMetricTool('tools/list', 'incident_get')).toBe('none');
    expect(MCP_METRIC_TOOLS.size).toBeLessThanOrEqual(MCP_METRIC_TOOL_LABEL_LIMIT);
    const counter = OPERATIONAL_METRICS.find(m => m.name === 'opsknight_mcp_requests_total')!;
    expect(counter.labels).toEqual(['outcome', 'tool']);
    expect(counter.estimatedMaxSeries).toBeGreaterThanOrEqual(
      MCP_METRIC_OUTCOMES.length * MCP_METRIC_TOOLS.size
    );
    expect(() => validateMetricDefinitions()).not.toThrow();
  });

  it('maps failures to a fixed outcome set', () => {
    const outcome = (code: string, status: number) =>
      mcpErrorOutcome(new McpBoundaryError(code, status));
    expect(outcome('MCP_RATE_LIMITED', 429)).toBe('rate_limited');
    expect(outcome('MCP_BUSY', 503)).toBe('busy');
    expect(outcome('MCP_DISABLED', 503)).toBe('disabled');
    expect(outcome('MCP_RESULT_BUDGET_EXCEEDED', 413)).toBe('result_too_large');
    expect(outcome('MCP_INVALID_TOKEN', 401)).toBe('unauthenticated');
    expect(outcome('MCP_INVALID_HOST', 403)).toBe('forbidden');
    expect(outcome('MCP_CONTENT_TYPE', 415)).toBe('invalid_request');
    expect(mcpErrorOutcome(new Error('boom'))).toBe('error');
    for (const value of ['rate_limited', 'busy', 'disabled', 'error'])
      expect(MCP_METRIC_OUTCOMES).toContain(value);
  });

  it('recognises an isError tool result in JSON and SSE responses', async () => {
    const failed = { jsonrpc: '2.0', id: 1, result: { isError: true, content: [] } };
    const ok = { jsonrpc: '2.0', id: 1, result: { content: [] } };
    expect(await mcpToolErrored(Response.json(failed))).toBe(true);
    expect(await mcpToolErrored(Response.json(ok))).toBe(false);
    const sse = new Response(`event: message\ndata: ${JSON.stringify(failed)}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
    expect(await mcpToolErrored(sse)).toBe(true);
  });
});

describe('E3: bounded wait for a work slot', () => {
  it('admits a waiter when a slot frees within the wait, first come first served', async () => {
    const first = await acquireMcpSlot(1);
    const order: string[] = [];
    const second = acquireMcpSlot(1).then(release => (order.push('second'), release));
    const third = acquireMcpSlot(1).then(release => (order.push('third'), release));
    expect(mcpSlotUsage()).toEqual({ inFlight: 1, queued: 2 });
    first();
    (await second)();
    (await third)();
    expect(order).toEqual(['second', 'third']);
    expect(mcpSlotUsage()).toEqual({ inFlight: 0, queued: 0 });
  });

  it('sheds with a retryable MCP_BUSY after the wait, and when the queue is full', async () => {
    vi.useFakeTimers();
    clearRuntimeOperationalMetrics();
    const held = await acquireMcpSlot(1);
    const waiting = acquireMcpSlot(1);
    const queued = acquireMcpSlot(1);
    // Queue depth is twice the limit.
    await expect(acquireMcpSlot(1)).rejects.toThrow('MCP_BUSY');
    const settled = Promise.allSettled([waiting, queued]);
    await vi.advanceTimersByTimeAsync(MCP_SLOT_WAIT_MS + 1);
    const [late] = await settled;
    expect(late.status).toBe('rejected');
    const reason = (late as PromiseRejectedResult).reason as McpBoundaryError;
    expect(reason).toMatchObject({ code: 'MCP_BUSY', status: 503, retryable: true });
    expect(reason.retryAfterSeconds).toBe(1);
    expect(runtimeOperationalMetrics().get('opsknight_mcp_busy_total')?.[0]?.value).toBe(3);
    held();
    expect(mcpSlotUsage()).toEqual({ inFlight: 0, queued: 0 });
  });

  it('caps one connection at half the slots so another can still get in', async () => {
    expect(mcpGrantSlotLimit(4)).toBe(2);
    const a1 = await acquireMcpSlot(4, { ownerId: 'a' });
    const a2 = await acquireMcpSlot(4, { ownerId: 'a' });
    await expect(acquireMcpSlot(4, { ownerId: 'a', waitMs: 0 })).rejects.toThrow('MCP_BUSY');
    const b1 = await acquireMcpSlot(4, { ownerId: 'b', waitMs: 0 });
    const a3 = acquireMcpSlot(4, { ownerId: 'a' });
    a1();
    (await a3)();
    a2();
    b1();
    expect(mcpSlotUsage()).toEqual({ inFlight: 0, queued: 0 });
  });
  it('keeps the slot of an admitted request on re-admission instead of handing it to a waiter', async () => {
    vi.useFakeTimers();
    const held = await acquireMcpSlot(1, { ownerId: 'a' });
    const waiter = acquireMcpSlot(1, { ownerId: 'b' });
    const waiterOutcome = waiter.then(
      () => 'admitted',
      () => 'shed'
    );
    // Same limit: the request that already passed admission keeps going without queueing.
    const kept = await readmitMcpSlot(held, 1, { ownerId: 'a' });
    expect(kept).toBe(held);
    expect(mcpSlotUsage()).toEqual({ inFlight: 1, queued: 1 });
    kept();
    expect(await waiterOutcome).toBe('admitted');
    (await waiter)();
    expect(mcpSlotUsage()).toEqual({ inFlight: 0, queued: 0 });
  });

  it('gives the slot up on re-admission when the refreshed limit no longer admits it', async () => {
    const a = await acquireMcpSlot(2, { ownerId: 'a' });
    const b = await acquireMcpSlot(2, { ownerId: 'b' });
    // The administrator lowered maxInFlight to 1 while this request was uploading.
    await expect(readmitMcpSlot(a, 1, { ownerId: 'a', waitMs: 0 })).rejects.toThrow('MCP_BUSY');
    expect(mcpSlotUsage()).toEqual({ inFlight: 1, queued: 0 });
    b();
    expect(mcpSlotUsage()).toEqual({ inFlight: 0, queued: 0 });
  });
});

describe('A4: postmortem context counts each read once', () => {
  it('does not charge the aggregate against the result budget again', async () => {
    execution.callMcpOperation.mockResolvedValue({ data: { data: {} }, evidence: {} });
    const ctx = context();
    const consume = vi.spyOn(ctx.budget, 'consumeResult');
    await getMcpPostmortemContext(ctx, { id: 'pm_1' });
    expect(execution.callMcpOperation).toHaveBeenCalledTimes(4);
    expect(consume).not.toHaveBeenCalled();
  });
});

describe('A11: completion by id prefix or name', () => {
  const rows = [
    { id: 'svc_payments', name: 'Payments API' },
    { id: 'svc_search', name: 'Search' },
    { id: 'abc123', name: 'Checkout' },
  ];
  const page = (data: unknown[]) => ({ data: { data }, evidence: {} });

  it('passes typed text to search and matches names case-insensitively', async () => {
    execution.callMcpOperation.mockResolvedValue(page(rows));
    expect(await completeAuthorizedIds(context(), 'services', 'payments')).toEqual([
      'svc_payments',
    ]);
    expect(execution.callMcpOperation).toHaveBeenCalledWith(expect.anything(), 'listServices', {
      query: { limit: 25, search: 'payments' },
    });
    expect(await completeAuthorizedIds(context(), 'services', 'Payments API')).toEqual([
      'svc_payments',
    ]);
  });

  it('falls back to the first page for an id prefix, and only returns ids', async () => {
    execution.callMcpOperation.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page(rows));
    expect(await completeAuthorizedIds(context(), 'services', 'abc')).toEqual(['abc123']);
    expect(execution.callMcpOperation).toHaveBeenLastCalledWith(expect.anything(), 'listServices', {
      query: { limit: 25 },
    });
  });

  it('never sends search to a list that does not take it, and rejects control characters', async () => {
    execution.callMcpOperation.mockResolvedValue(page([{ id: 'rep_1', name: 'Weekly' }]));
    expect(await completeAuthorizedIds(context(), 'reports', 'week')).toEqual(['rep_1']);
    expect(execution.callMcpOperation).toHaveBeenCalledWith(expect.anything(), 'listSavedReports', {
      query: { limit: 25 },
    });
    expect(await completeAuthorizedIds(context(), 'services', 'a\u0000b')).toEqual([]);
  });
});

describe('E5: doctor explains a 503 by its body', () => {
  const origin = 'https://ops.example.com';
  const install = (body: unknown, headers: Record<string, string> = {}) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/mcp') return Response.json(body, { status: 503, headers });
      return Response.json(
        path.includes('oauth-protected-resource')
          ? { resource: `${origin}/mcp`, authorization_servers: [`${origin}/oauth/mcp`] }
          : {
              issuer: `${origin}/oauth/mcp`,
              authorization_endpoint: `${origin}/oauth/mcp/authorize`,
              token_endpoint: `${origin}/oauth/mcp/token`,
              registration_endpoint: `${origin}/oauth/mcp/register`,
              code_challenge_methods_supported: ['S256'],
            }
      );
    });
  const detail = async (body: unknown, headers?: Record<string, string>) =>
    (await checkMcpSetup(`${origin}/mcp`, install(body, headers))).checks.find(
      (check: { id: string }) => check.id === 'authentication'
    ).message as string;

  it('tells an administrator switch from load and from a fault', async () => {
    expect(await detail({ error: 'MCP_DISABLED' })).toContain('turned off');
    expect(await detail({ error: 'MCP_BUSY' }, { 'retry-after': '1' })).toContain(
      'capacity (in-flight limit reached); retry after 1s'
    );
    expect(await detail({ error: 'MCP_UNAVAILABLE' })).toContain('encryption key');
  });
});

describe('E1: a failed plan step is logged once, without arguments', () => {
  it('logs an unexpected step failure and still reports the step', async () => {
    const { executeMcpPlan } = await import('@/lib/mcp/core/plan');
    const { logger } = await import('@/lib/logger');
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    execution.callMcpOperation.mockRejectedValue(new TypeError('secret-arg'));
    const plan = await executeMcpPlan(context(), {
      steps: [{ id: 'a', operationId: 'listServices', args: {}, dependsOn: [] }],
    });
    expect(plan.steps[0]).toMatchObject({ status: 'failed', error: 'MCP_UNAVAILABLE' });
    expect(log).toHaveBeenCalledWith('mcp.tool.unexpected_error', {
      requestId: 'req',
      tool: 'execute_plan',
      grantId: 'grant',
      errorName: 'TypeError',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-arg');
    log.mockRestore();
  });
});
