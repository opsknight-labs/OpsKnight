import { withMcpRuntime } from '@/lib/mcp/auth/config';
import { randomUUID } from 'node:crypto';
import { withMcpDatabase } from '@/lib/database-workload';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  authenticateMcp,
  chargeMcpRequest,
  resolveMcpGrantWithPolicy,
} from '@/lib/mcp/auth/principal';
import { assertMcpHost, mcpHttpError } from '@/lib/mcp/auth/http';
import { browserPreflight, withBrowserCors } from '@/lib/mcp/auth/cors';
import {
  CostBudget,
  acquireMcpSlot,
  acquireMcpAuthenticationSlot,
  readmitMcpSlot,
} from '@/lib/mcp/core/budget';
import { requireMcp, McpBoundaryError } from '@/lib/mcp/core/errors';
import { readMcpBody } from '@/lib/mcp/protocol/input';
import {
  createOpsKnightMcpServer,
  toolErrorContent,
  toolErrorText,
} from '@/lib/mcp/protocol/server';
import { boundMcpResponse } from '@/lib/mcp/core/response';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import {
  MAX_RESOURCE_SUBSCRIPTIONS,
  STREAM_LIFETIME_MS,
  acquireStreamSlot,
  mcpEventBus,
  parseSubscriptionUri,
  revalidateIntervalMs,
  trackSubscription,
} from '@/lib/mcp/protocol/subscriptions';
import {
  TASK_CAPABLE_TOOLS,
  TASKS_EXTENSION,
  cancelMcpTask,
  clientSupportsTasks,
  createRunbookExecutionTask,
  getMcpTask,
  updateMcpTask,
} from '@/lib/mcp/protocol/tasks';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { logger, runWithContext } from '@/lib/logger';
import { recordMcpGrantCall } from '@/lib/mcp/core/usage';
import { MCP_PROTOCOL_REVISION } from '@/lib/mcp/protocol/revision';
import {
  mcpErrorOutcome,
  mcpMetricTool,
  mcpToolErrored,
  type McpMetricOutcome,
} from '@/lib/mcp/protocol/metrics';
import { isMcpCapabilityDisabled } from '@/lib/mcp/catalog/capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  // Every log line of this request carries the id returned to the client as X-Request-Id.
  const requestId = randomUUID();
  return runWithContext({ requestId, component: 'mcp' }, () =>
    withMcpDatabase(() =>
      withMcpRuntime(() =>
        withBrowserCors(request, browserOrigin => handlePost(request, requestId, browserOrigin))
      )
    )
  );
}
/** CORS preflight for a browser-hosted client on an allowed origin (Allowed browser origins). */
export const OPTIONS = browserPreflight;

async function handlePost(request: Request, requestId: string, browserOrigin: string | null) {
  const started = performance.now();
  let outcome: McpMetricOutcome = 'error';
  let tool = 'none';
  let method: string | undefined;
  let release: (() => void) | undefined;
  let releaseAuth: (() => void) | undefined;
  let budget: CostBudget | undefined;
  let rpcId: string | number | null = null;
  try {
    assertMcpHost(request, false, browserOrigin);
    releaseAuth = acquireMcpAuthenticationSlot();
    requireMcp(!request.headers.has('mcp-session-id'), 'MCP_SESSIONS_UNSUPPORTED');
    // Verify bearer authority before accepting a potentially slow upload. Release the
    // authentication slot before reading; only authenticated callers occupy work slots.
    let identity = await authenticateMcp(request, null);
    releaseAuth();
    releaseAuth = undefined;
    release = await acquireMcpSlot(identity.policy.maxInFlight, { grantId: identity.grantId });
    let body;
    try {
      body = await readMcpBody(request);
    } catch (error) {
      outcome = 'protocol_rejected';
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
    method = body.method;
    tool = mcpMetricTool(body.method, body.params?.name);
    // A notification (no id) gets no response and does no work: acknowledge it before any
    // quota is charged. notifications/initialized and notifications/cancelled arrive this way.
    if (body.id === undefined) {
      outcome = 'notification';
      return new Response(null, {
        status: 202,
        headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
      });
    }
    // A caller can pause its upload while permissions, credentials or policy change.
    // Refresh the complete authority snapshot before even permission-filtered discovery.
    identity = await authenticateMcp(request, null);
    // Judge the held slot by the refreshed limit; it is kept while that limit still admits it.
    release = await readmitMcpSlot(release, identity.policy.maxInFlight, {
      grantId: identity.grantId,
    });
    rpcId = body.id;
    // Older revisions are served statelessly by the SDK: 2025-11-25, 2025-06-18 and best-effort
    // 2025-03-26 (also 2024-11-05 and 2024-10-07 over plain POST; their HTTP+SSE transport is not
    // served, GET /mcp is 405). A POST without MCP-Protocol-Version is treated as 2025-03-26.
    // Tasks and listen are 2026-07-28 only.
    const modern = request.headers.get('mcp-protocol-version') === MCP_PROTOCOL_REVISION;
    const steps =
      body.method === 'tools/call' && body.params?.name === 'execute_plan'
        ? (body.params.arguments as { steps?: unknown[] } | undefined)?.steps
        : undefined;
    const listening = modern && body.method === 'subscriptions/listen';
    const taskMethod = ['tasks/get', 'tasks/update', 'tasks/cancel'].includes(body.method);
    const supportsTasks = modern && clientSupportsTasks(body.params);
    if (
      (taskMethod ||
        (listening &&
          (body.params as { notifications?: { taskIds?: unknown } })?.notifications?.taskIds !==
            undefined)) &&
      !supportsTasks
    ) {
      outcome = 'protocol_rejected';
      return Response.json(
        {
          jsonrpc: '2.0',
          id: rpcId,
          error: {
            code: -32021,
            message: 'Missing required client capability',
            data: { requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } },
          },
        },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    const subscribedUris = listening ? listenUris(body.params) : [];
    const cost = listening
      ? 1 + subscribedUris.length
      : Array.isArray(steps)
        ? Math.max(1, steps.length)
        : body.params?.name === 'incident_get_context'
          ? 3
          : body.method === 'tools/call' && body.params?.name === 'postmortem_get_context'
            ? 4
            : 1;
    requireMcp(cost <= 8, 'MCP_OPERATION_BUDGET_EXCEEDED');
    await chargeMcpRequest(identity, cost);
    budget = new CostBudget(identity.policy.maxOperations, 262144, request.signal);
    const context = {
      grantId: identity.grantId,
      credentialId: identity.credentialId,
      tokenScopes: identity.tokenScopes,
      requestId,
      budget,
    };
    if (taskMethod) {
      // The SDK has no handlers for the 2026-07-28 Tasks extension; the route serves it directly
      // with the same authentication, admission and budget as every other request.
      requireMcp(
        request.headers.get('mcp-method') === body.method &&
          request.headers.get('mcp-protocol-version') === MCP_PROTOCOL_REVISION,
        'MCP_INVALID_HEADERS'
      );
      const taskId = (body.params as { taskId?: unknown } | undefined)?.taskId;
      try {
        const result =
          body.method === 'tasks/get'
            ? await getMcpTask(context, taskId)
            : body.method === 'tasks/cancel'
              ? await cancelMcpTask(context, taskId)
              : await updateMcpTask(context, taskId);
        outcome = 'served';
        return Response.json(
          { jsonrpc: '2.0', id: rpcId, result },
          {
            status: 200,
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Request-Id': context.requestId,
              'X-Content-Type-Options': 'nosniff',
            },
          }
        );
      } catch (error) {
        if (error instanceof McpBoundaryError && error.code === 'MCP_TASK_NOT_FOUND') {
          outcome = 'protocol_rejected';
          return rpcError(rpcId, -32602, 'Invalid params: unknown task');
        }
        throw error;
      }
    }
    if (listening) {
      // Authorize every URI now; a notification must never reveal a resource the caller cannot read.
      for (const uri of subscribedUris) {
        const { readOperation, id } = parseSubscriptionUri(uri);
        try {
          await callMcpOperation(context, readOperation, { path: { id } });
        } catch {
          outcome = 'subscription_rejected';
          return rpcError(rpcId, -32602, 'Invalid params: resource unavailable');
        }
      }
      // The stream must not hold database-work admission for its lifetime.
      await budget.drain();
      release();
      release = undefined;
      outcome = 'subscription_opened';
      return await openListenStream(request, body, context, identity, subscribedUris);
    }
    const handler = createMcpHandler(
      () =>
        createOpsKnightMcpServer(
          context,
          identity.auth.actor,
          identity.policy.writesEnabled,
          identity.policy.sensitiveReadsEnabled,
          identity.policy.disabledCapabilities
        ),
      {
        // Pre-2026 clients: one fresh server per request, no session.
        legacy: 'stateless',
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
      const taskResponse =
        supportsTasks &&
        body.method === 'tools/call' &&
        TASK_CAPABLE_TOOLS.has(String(body.params?.name))
          ? await asTaskResponse(response, context, identity.auth.actor.id)
          : null;
      if (taskResponse) {
        outcome = 'task_created';
        return taskResponse;
      }
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('X-Request-Id', context.requestId);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      outcome = !response.ok
        ? 'protocol_rejected'
        : body.method === 'tools/call' && (await mcpToolErrored(response))
          ? 'tool_error'
          : 'served';
      return response;
    } finally {
      await handler.close();
      // "Last call" for the admin lists: any answered tool call, throttled per grant.
      if (body.method === 'tools/call') await recordMcpGrantCall(identity.grantId, tool);
    }
  } catch (error) {
    outcome = mcpErrorOutcome(error);
    if (
      !(error instanceof McpBoundaryError) ||
      (error.status >= 500 && !['MCP_BUSY', 'MCP_DISABLED'].includes(error.code))
    )
      logger.error('mcp.request.unexpected_error', {
        requestId,
        tool,
        errorName: error instanceof Error ? error.name : typeof error,
        ...(error instanceof McpBoundaryError ? { code: error.code } : {}),
      });
    if (error instanceof McpBoundaryError && error.code === 'MCP_RESULT_BUDGET_EXCEEDED') {
      // A tool call that outgrew the wire budget is the assistant's to fix (a smaller page), so
      // it is a tool error with a hint; the HTTP 413 stays a last resort for other methods.
      if (method === 'tools/call')
        return Response.json(
          {
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              content: [{ type: 'text', text: toolErrorText(error) }],
              structuredContent: toolErrorContent(error, requestId),
              isError: true,
            },
          },
          {
            status: 200,
            headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
          }
        );
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
    addOperationalMetric('opsknight_mcp_requests_total', 1, { outcome, tool });
    observeOperationalHistogram(
      'opsknight_mcp_request_duration_seconds',
      (performance.now() - started) / 1000,
      { tool }
    );
  }
}

/**
 * A task-capable tool that durably started work becomes a task handle for a client that opted in.
 * Errors and non-JSON responses pass through unchanged.
 */
async function asTaskResponse(
  response: Response,
  context: Parameters<typeof createRunbookExecutionTask>[0],
  actorId: string
) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    return null;
  const message = (await response.clone().json()) as {
    id: string | number | null;
    result?: { isError?: boolean; structuredContent?: { executionId?: unknown } };
  };
  const executionId = message.result?.structuredContent?.executionId;
  if (message.result?.isError || typeof executionId !== 'string') return null;
  const task = await createRunbookExecutionTask(context, actorId, executionId);
  return Response.json(
    { jsonrpc: '2.0', id: message.id, result: task },
    {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Request-Id': context.requestId,
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}

function rpcError(id: string | number | null, code: number, message: string) {
  return Response.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
  );
}

function listenUris(params: unknown) {
  const notifications = (
    params as { notifications?: { resourceSubscriptions?: unknown } } | undefined
  )?.notifications;
  const uris = notifications?.resourceSubscriptions;
  if (uris === undefined) return [];
  requireMcp(
    Array.isArray(uris) &&
      uris.length <= MAX_RESOURCE_SUBSCRIPTIONS &&
      uris.every(uri => typeof uri === 'string'),
    'MCP_INVALID_SUBSCRIPTION'
  );
  for (const uri of uris) parseSubscriptionUri(uri);
  return [...new Set(uris as string[])];
}

async function openListenStream(
  request: Request,
  body: Awaited<ReturnType<typeof readMcpBody>>,
  context: Parameters<typeof createOpsKnightMcpServer>[0],
  identity: Awaited<ReturnType<typeof authenticateMcp>>,
  uris: string[]
) {
  const releaseStream = acquireStreamSlot(identity.grantId);
  const untrack = trackSubscription(uris);
  const handler = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        context,
        identity.auth.actor,
        identity.policy.writesEnabled,
        identity.policy.sensitiveReadsEnabled,
        identity.policy.disabledCapabilities
      ),
    {
      legacy: 'reject',
      responseMode: 'auto',
      maxRequestBodySize: 65536,
      maxSubscriptions: 1,
      bus: mcpEventBus,
      keepAliveMs: 15000,
    }
  );
  const timers: { lifetime?: NodeJS.Timeout; revalidate?: NodeJS.Timeout } = {};
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timers.lifetime);
    clearInterval(timers.revalidate);
    releaseStream();
    untrack();
    await handler.close();
  };
  let response: Response;
  try {
    response = await handler.fetch(request, { parsedBody: body });
  } catch (error) {
    await cleanup();
    throw error;
  }
  if (!response.body) {
    await cleanup();
    return response;
  }
  // Notifications are hints; ending a stream is always safe because clients re-read on reconnect.
  timers.lifetime = setTimeout(() => void cleanup(), STREAM_LIFETIME_MS);
  // Turning MCP off, or disabling a subscribed resource's read, ends the stream at the next check.
  const readOperations = uris.map(uri => parseSubscriptionUri(uri).readOperation);
  timers.revalidate = setInterval(() => {
    void withMcpDatabase(() => resolveMcpGrantWithPolicy(identity.grantId, identity.credentialId))
      .then(({ policy }) => {
        if (
          !policy?.enabled ||
          readOperations.some(operationId =>
            isMcpCapabilityDisabled(policy.disabledCapabilities, operationId)
          )
        )
          void cleanup();
      })
      .catch(() => void cleanup());
  }, revalidateIntervalMs());
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          await cleanup();
        } else controller.enqueue(value);
      } catch {
        controller.close();
        await cleanup();
      }
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
      await cleanup();
    },
  });
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Request-Id', context.requestId);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(stream, { status: response.status, headers });
}

export function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
export const DELETE = GET;
