import { randomUUID } from 'node:crypto';
import { withMcpDatabase } from '@/lib/database-workload';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { authenticateMcp } from '@/lib/mcp/auth/principal';
import { assertMcpHost, mcpHttpError } from '@/lib/mcp/auth/http';
import { CostBudget, acquireMcpSlot, acquireMcpAuthenticationSlot } from '@/lib/mcp/core/budget';
import { requireMcp, McpBoundaryError } from '@/lib/mcp/core/errors';
import { readMcpBody } from '@/lib/mcp/protocol/input';
import { createOpsKnightMcpServer } from '@/lib/mcp/protocol/server';
import { boundMcpResponse } from '@/lib/mcp/core/response';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return withMcpDatabase(() => handlePost(request));
}

async function handlePost(request: Request) {
  const started = performance.now();
  let outcome = 'rejected';
  let release: (() => void) | undefined;
  let releaseAuth: (() => void) | undefined;
  let budget: CostBudget | undefined;
  let rpcId: string | number | null = null;
  try {
    assertMcpHost(request);
    releaseAuth = acquireMcpAuthenticationSlot();
    requireMcp(!request.headers.has('mcp-session-id'), 'MCP_SESSIONS_UNSUPPORTED');
    let body;
    try {
      body = await readMcpBody(request);
    } catch (error) {
      const parseError =
        error instanceof SyntaxError ||
        (error instanceof McpBoundaryError && error.code === 'MCP_INVALID_ENCODING');
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: parseError ? -32700 : -32600,
            message: parseError ? 'Parse error' : 'Invalid MCP request',
          },
        },
        {
          status: error instanceof McpBoundaryError ? error.status : 400,
          headers: { 'Cache-Control': 'private, no-store' },
        }
      );
    }
    rpcId = body.id;
    const steps =
      body.method === 'tools/call' && body.params?.name === 'execute_plan'
        ? (body.params.arguments as { steps?: unknown[] } | undefined)?.steps
        : undefined;
    const cost = Array.isArray(steps)
      ? Math.max(1, steps.length)
      : body.params?.name === 'incident_get_context'
        ? 3
        : body.method === 'tools/call' && body.params?.name === 'postmortem_get_context'
          ? 4
          : 1;
    requireMcp(cost <= 8, 'MCP_OPERATION_BUDGET_EXCEEDED');
    const identity = await authenticateMcp(request, cost);
    release = acquireMcpSlot(identity.policy.maxInFlight);
    releaseAuth();
    budget = new CostBudget(identity.policy.maxOperations, 262144, request.signal);
    const context = {
      grantId: identity.grantId,
      credentialId: identity.credentialId,
      tokenScopes: identity.tokenScopes,
      requestId: randomUUID(),
      budget,
    };
    const handler = createMcpHandler(
      () => createOpsKnightMcpServer(context, identity.auth.actor, identity.policy.writesEnabled),
      {
        legacy: 'reject',
        responseMode: 'auto',
        maxRequestBodySize: 65536,
        maxSubscriptions: 0,
      }
    );
    try {
      const response = await boundMcpResponse(
        await handler.fetch(request, { parsedBody: body }),
        budget.maxBytes
      );
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('X-Request-Id', context.requestId);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      outcome = response.ok ? 'served' : 'protocol_rejected';
      return response;
    } finally {
      await handler.close();
    }
  } catch (error) {
    if (error instanceof McpBoundaryError && error.code === 'MCP_RESULT_BUDGET_EXCEEDED') {
      return Response.json(
        { jsonrpc: '2.0', id: rpcId, error: { code: -32000, message: error.code } },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    return mcpHttpError(error);
  } finally {
    releaseAuth?.();
    // The transport can close before a non-cancellable Prisma operation finishes.
    // Keep the DB-work admission slot until that actual work has settled.
    await budget?.drain();
    release?.();
    addOperationalMetric('opsknight_mcp_requests_total', 1, { outcome });
    observeOperationalHistogram(
      'opsknight_mcp_request_duration_seconds',
      (performance.now() - started) / 1000
    );
  }
}

export function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
export const DELETE = GET;
