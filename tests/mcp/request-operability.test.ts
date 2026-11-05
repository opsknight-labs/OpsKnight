import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import {
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
  OperationalMetricSnapshot,
} from '@/lib/metrics/operational/registry';

// The route is driven in-process with the principal mocked: these tests cover what the route does
// around authentication (ids, logs, metrics, limits), not authentication itself.
const principal = vi.hoisted(() => ({
  authenticateMcp: vi.fn(),
  chargeMcpRequest: vi.fn(),
  resolveMcpGrantWithPolicy: vi.fn(),
}));
vi.mock('@/lib/mcp/auth/principal', () => principal);
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/logger')>()),
  logger: log,
}));
const budget = vi.hoisted(() => ({ acquireMcpSlot: vi.fn(), budgets: [] as number[] }));
vi.mock('@/lib/mcp/core/budget', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/mcp/core/budget')>();
  budget.acquireMcpSlot.mockImplementation(actual.acquireMcpSlot);
  class RecordingBudget extends actual.CostBudget {
    constructor(...args: ConstructorParameters<typeof actual.CostBudget>) {
      super(...args);
      budget.budgets.push(this.maxOperations);
    }
  }
  return { ...actual, CostBudget: RecordingBudget, acquireMcpSlot: budget.acquireMcpSlot };
});

const { POST } = await import('@/app/mcp/route');

const identity = (overrides: Record<string, unknown> = {}) => ({
  auth: { actor: { id: 'user-1', role: 'RESPONDER', teamIds: [] }, apiKey: { scopes: [] } },
  grantId: 'grant-1',
  clientId: 'client-1',
  credentialId: 'cred-1',
  tokenScopes: [],
  policy: {
    enabled: true,
    writesEnabled: false,
    sensitiveReadsEnabled: false,
    maxInFlight: 4,
    maxOperations: 8,
    requestsPerMinute: 60,
    disabledCapabilities: [],
  },
  ...overrides,
});

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        authorization: `Bearer ${'a'.repeat(40)}`,
        'x-request-id': 'abc',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

const toolCall = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami' } };
const completed = () =>
  log.info.mock.calls
    .filter(([event]) => event === 'mcp.request.completed')
    .map(([, data]) => data);
const counter = (outcome: string, tool: string) =>
  runtimeOperationalMetrics()
    .get('opsknight_mcp_requests_total')
    ?.find(row => row.labels.outcome === outcome && row.labels.tool === tool)?.value ?? 0;
const histogramText = () => new OperationalMetricSnapshot().render();

beforeEach(() => {
  vi.stubEnv('MCP_PUBLIC_ORIGIN', 'http://localhost:3000');
  clearRuntimeOperationalMetrics();
  log.info.mockClear();
  log.error.mockClear();
  principal.authenticateMcp.mockReset();
  principal.chargeMcpRequest.mockReset();
  budget.acquireMcpSlot.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('OBS-5: one request id on every response', () => {
  it('returns the forwarded X-Request-Id on a 401, a 503 and a parse error, and logs it', async () => {
    principal.authenticateMcp.mockRejectedValueOnce(new McpBoundaryError('MCP_INVALID_TOKEN', 401));
    const unauthorized = await call(toolCall);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('X-Request-Id')).toBe('abc');

    principal.authenticateMcp.mockRejectedValueOnce(new Error('database down'));
    const unavailable = await call(toolCall);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('X-Request-Id')).toBe('abc');
    expect(log.error).toHaveBeenCalledWith(
      'mcp.request.unexpected_error',
      expect.objectContaining({ requestId: 'abc' })
    );

    principal.authenticateMcp.mockResolvedValue(identity());
    const parse = await call('{');
    expect(parse.status).toBe(400);
    expect(parse.headers.get('X-Request-Id')).toBe('abc');
  });

  it('ignores a malformed client id and issues its own', async () => {
    principal.authenticateMcp.mockRejectedValueOnce(new McpBoundaryError('MCP_INVALID_TOKEN', 401));
    const response = await call(toolCall, { 'x-request-id': 'bad id with spaces' });
    const id = response.headers.get('X-Request-Id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('OBS-2: mcp.request.completed', () => {
  it('logs grant, client, tool, outcome and duration for a rate-limited call, never arguments', async () => {
    principal.authenticateMcp.mockResolvedValue(identity());
    principal.chargeMcpRequest.mockRejectedValue(
      new McpBoundaryError('MCP_RATE_LIMITED', 429, true, undefined, { retryAfterSeconds: 7 })
    );
    const response = await call({
      ...toolCall,
      params: { name: 'whoami', arguments: { secretNote: 'do-not-log' } },
    });
    expect(response.status).toBe(429);
    const [entry] = completed();
    expect(entry).toMatchObject({
      requestId: 'abc',
      grantId: 'grant-1',
      clientId: 'client-1',
      method: 'tools/call',
      tool: 'whoami',
      outcome: 'rate_limited',
      errorCode: 'MCP_RATE_LIMITED',
    });
    expect(typeof (entry as { durationMs: unknown }).durationMs).toBe('number');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('do-not-log');
  });

  it('logs a 401 without a grant, and samples served requests by MCP_LOG_SAMPLE_SERVED', async () => {
    principal.authenticateMcp.mockRejectedValueOnce(new McpBoundaryError('MCP_INVALID_TOKEN', 401));
    await call(toolCall);
    expect(completed()[0]).toMatchObject({ outcome: 'unauthenticated', grantId: undefined });

    log.info.mockClear();
    principal.authenticateMcp.mockResolvedValue(identity());
    vi.stubEnv('MCP_LOG_SAMPLE_SERVED', '0');
    const ping = await call({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(ping.status).toBe(200);
    expect(counter('served', 'none')).toBe(1);
    expect(completed()).toHaveLength(0);
    vi.stubEnv('MCP_LOG_SAMPLE_SERVED', '1');
    await call({ jsonrpc: '2.0', id: 3, method: 'ping' });
    expect(completed()[0]).toMatchObject({ outcome: 'served', method: 'ping', tool: 'none' });
  });
});

describe('OBS-6: the latency histogram times only work-bearing outcomes', () => {
  it('counts a 429 under rate_limited without observing its latency', async () => {
    principal.authenticateMcp.mockResolvedValue(identity());
    principal.chargeMcpRequest.mockRejectedValue(new McpBoundaryError('MCP_RATE_LIMITED', 429));
    await call({ ...toolCall, params: { name: 'incident_search' } });
    expect(counter('rate_limited', 'incident_search')).toBe(1);
    expect(histogramText()).not.toContain('opsknight_mcp_request_duration_seconds_count');

    principal.chargeMcpRequest.mockResolvedValue(undefined);
    await call({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(histogramText()).toContain(
      'opsknight_mcp_request_duration_seconds_count{outcome="served",tool="none"} 1'
    );
  });
});

describe('OBS-11: MCP_FORCE_DISABLED', () => {
  it('answers MCP_DISABLED before authenticating anyone', async () => {
    vi.stubEnv('MCP_FORCE_DISABLED', 'true');
    principal.authenticateMcp.mockResolvedValue(identity());
    const response = await call(toolCall);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('MCP_DISABLED');
    expect(principal.authenticateMcp).not.toHaveBeenCalled();
    expect(counter('disabled', 'none')).toBe(1);
  });
});

describe('OBS-12 and SEC-5: limits judged per user, operations capped', () => {
  it('admits work slots by the user, not the connection', async () => {
    principal.authenticateMcp.mockResolvedValue(identity());
    await call({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(budget.acquireMcpSlot).toHaveBeenCalledWith(4, { ownerId: 'user-1' });
  });

  it('clamps a stored policy above MCP_MAX_OPERATIONS to the cap', async () => {
    principal.authenticateMcp.mockResolvedValue(
      identity({ policy: { ...identity().policy, maxOperations: 16 } })
    );
    budget.budgets.length = 0;
    await call({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(budget.budgets).toEqual([8]);
  });

  it('refuses a declared cost above MCP_MAX_OPERATIONS even when the stored policy allows 16', async () => {
    principal.authenticateMcp.mockResolvedValue(
      identity({ policy: { ...identity().policy, maxOperations: 16 } })
    );
    const steps = Array.from({ length: 9 }, (_, index) => ({
      id: `s${index}`,
      operationId: 'listIncidents',
      args: {},
    }));
    const response = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'execute_plan', arguments: { steps } },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('MCP_OPERATION_BUDGET_EXCEEDED');
    expect(principal.chargeMcpRequest).not.toHaveBeenCalled();
  });
});
