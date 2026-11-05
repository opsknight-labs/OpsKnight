import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import {
  MCP_AUTH_CONCURRENCY,
  MCP_MAX_OPERATIONS,
  CostBudget,
  acquireMcpAuthenticationSlot,
  acquireMcpSlot,
  mcpSlotUsage,
} from '@/lib/mcp/core/budget';
import { mcpErrorOutcome } from '@/lib/mcp/protocol/metrics';
import { mcpForceDisabled, mcpPolicyInForce } from '@/lib/mcp/core/kill-switch';
import {
  MCP_OAUTH_ENDPOINTS,
  MCP_OAUTH_OUTCOMES,
  mcpOAuthOutcome,
  observeMcpOAuth,
} from '@/lib/mcp/auth/oauth-observability';
import {
  OPERATIONAL_METRICS,
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
} from '@/lib/metrics/operational/registry';
import { planSchema } from '@/lib/mcp/core/plan';

const retention = vi.hoisted(() => ({ cleanupMcpCredentials: vi.fn() }));
vi.mock('@/lib/mcp/auth/retention', () => retention);
const tasks = vi.hoisted(() => ({ cleanupExpiredMcpTasks: vi.fn() }));
vi.mock('@/lib/mcp/protocol/tasks', () => tasks);
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/logger')>()),
  logger: log,
}));
const { runMcpMaintenance } = await import('@/lib/mcp/maintenance');

const metric = (name: string, labels: Record<string, string> = {}) =>
  runtimeOperationalMetrics()
    .get(name as never)
    ?.find(row => {
      const actual = new Map(Object.entries(row.labels));
      return Object.entries(labels).every(([key, value]) => actual.get(key) === value);
    })?.value ?? 0;

beforeEach(() => clearRuntimeOperationalMetrics());
afterEach(() => vi.unstubAllEnvs());

describe('OBS-4: every limit counts under the right outcome', () => {
  it('maps any 429 to rate_limited and a full stream table to busy', () => {
    expect(mcpErrorOutcome(new McpBoundaryError('MCP_SUBSCRIPTIONS_LIMIT', 429))).toBe(
      'rate_limited'
    );
    expect(mcpErrorOutcome(new McpBoundaryError('MCP_OPERATION_BUDGET_EXCEEDED', 429))).toBe(
      'rate_limited'
    );
    expect(mcpErrorOutcome(new McpBoundaryError('MCP_SUBSCRIPTIONS_BUSY', 503))).toBe('busy');
  });

  it('sheds the authentication slot through busy(): counted, retryable, Retry-After 1', () => {
    const held = Array.from({ length: MCP_AUTH_CONCURRENCY }, () => acquireMcpAuthenticationSlot());
    let shed: unknown;
    try {
      acquireMcpAuthenticationSlot();
    } catch (error) {
      shed = error;
    }
    expect(shed).toMatchObject({ code: 'MCP_BUSY', retryable: true, retryAfterSeconds: 1 });
    expect(metric('opsknight_mcp_busy_total')).toBe(1);
    held.forEach(release => release());
  });
});

describe('OBS-7: capacity is visible', () => {
  it('reports per-process caps with the policy limit and publishes the limit gauge', async () => {
    const release = await acquireMcpSlot(3);
    expect(mcpSlotUsage(3)).toEqual({
      inFlight: 1,
      queued: 0,
      authenticating: 0,
      limit: 3,
      queueCap: 6,
      authLimit: MCP_AUTH_CONCURRENCY,
    });
    expect(metric('opsknight_mcp_in_flight_limit')).toBe(3);
    release();
  });
});

describe('OBS-12: one operations cap', () => {
  it('defaults the budget and bounds plans with MCP_MAX_OPERATIONS', () => {
    expect(MCP_MAX_OPERATIONS).toBe(8);
    expect(new CostBudget().maxOperations).toBe(MCP_MAX_OPERATIONS);
    const steps = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `s${index}`,
        operationId: 'x',
        args: {},
      }));
    expect(planSchema.safeParse({ steps: steps(MCP_MAX_OPERATIONS) }).success).toBe(true);
    expect(planSchema.safeParse({ steps: steps(MCP_MAX_OPERATIONS + 1) }).success).toBe(false);
  });
});

describe('OBS-11: MCP_FORCE_DISABLED', () => {
  it('overrides an enabled policy only when set to true', () => {
    expect(mcpPolicyInForce({ enabled: true })).toBe(true);
    vi.stubEnv('MCP_FORCE_DISABLED', 'TRUE');
    expect(mcpForceDisabled()).toBe(true);
    expect(mcpPolicyInForce({ enabled: true })).toBe(false);
    vi.stubEnv('MCP_FORCE_DISABLED', 'false');
    expect(mcpPolicyInForce({ enabled: true })).toBe(true);
    expect(mcpPolicyInForce(null)).toBe(false);
  });
});

describe('OBS-3: OAuth endpoint outcomes', () => {
  it('derives the outcome from what was actually sent', async () => {
    const json = (status: number, error?: string) =>
      Response.json(error ? { error } : {}, { status });
    expect(await mcpOAuthOutcome(json(200))).toBe('issued');
    expect(await mcpOAuthOutcome(json(400, 'invalid_grant'))).toBe('invalid_grant');
    expect(await mcpOAuthOutcome(json(401, 'invalid_client'))).toBe('invalid_client');
    expect(await mcpOAuthOutcome(json(400, 'invalid_client_metadata'))).toBe('invalid_client');
    expect(await mcpOAuthOutcome(json(400, 'invalid_scope'))).toBe('invalid_scope');
    expect(await mcpOAuthOutcome(json(429, 'MCP_RATE_LIMITED'))).toBe('rate_limited');
    expect(await mcpOAuthOutcome(json(503, 'temporarily_unavailable'))).toBe('unavailable');
    expect(await mcpOAuthOutcome(json(503, 'MCP_DISABLED'))).toBe('unavailable');
    expect(await mcpOAuthOutcome(json(500, 'server_error'))).toBe('server_error');
    expect(await mcpOAuthOutcome(json(415, 'invalid_request'))).toBe('invalid_request');
    const redirect = (location: string) =>
      new Response(null, { status: 302, headers: { location } });
    expect(await mcpOAuthOutcome(redirect('https://x.test/cb?code=1'))).toBe('issued');
    expect(await mcpOAuthOutcome(redirect('https://x.test/cb?error=invalid_scope'))).toBe(
      'invalid_scope'
    );
  });

  it('counts each response once, sets X-Request-Id and keeps the series bound honest', async () => {
    const request = new Request('http://localhost/oauth/mcp/token', {
      headers: { 'x-request-id': 'req-9' },
    });
    const response = await observeMcpOAuth('token', request, async () =>
      Response.json({ error: 'invalid_grant' }, { status: 400 })
    );
    expect(response.headers.get('X-Request-Id')).toBe('req-9');
    expect(
      metric('opsknight_mcp_oauth_requests_total', { endpoint: 'token', outcome: 'invalid_grant' })
    ).toBe(1);
    const definition = OPERATIONAL_METRICS.find(
      entry => entry.name === 'opsknight_mcp_oauth_requests_total'
    )!;
    expect(definition.estimatedMaxSeries).toBe(
      MCP_OAUTH_ENDPOINTS.length * MCP_OAUTH_OUTCOMES.length
    );
  });
});

describe('OBS-8: MCP maintenance failures are logged and counted', () => {
  it('runs each task on its own and logs only the error name and Prisma code', async () => {
    retention.cleanupMcpCredentials.mockRejectedValueOnce(
      Object.assign(new Error('SELECT secret FROM x'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2028',
      })
    );
    tasks.cleanupExpiredMcpTasks.mockResolvedValueOnce(3);
    const result = await runMcpMaintenance();
    expect(result).toEqual({ credentials: null, tasks: 3 });
    expect(tasks.cleanupExpiredMcpTasks).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('[Cron] MCP maintenance failed', {
      task: 'credentials',
      name: 'PrismaClientKnownRequestError',
      code: 'P2028',
    });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('SELECT');
    expect(
      metric('opsknight_mcp_maintenance_runs_total', { task: 'credentials', result: 'failed' })
    ).toBe(1);
    expect(
      metric('opsknight_mcp_maintenance_runs_total', { task: 'tasks', result: 'success' })
    ).toBe(1);
  });
});
