import { mcpCompositeCost } from '@/lib/mcp/core/composites';
import { RESOURCE_LIST_COST } from '@/lib/mcp/protocol/resource-list';
import { endMcpSpan, linkMcpTrace, startMcpSpan } from '@/lib/mcp/protocol/tracing';
import { withMcpRuntime } from '@/lib/mcp/auth/config';
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
  MCP_MAX_OPERATIONS,
  acquireMcpSlot,
  acquireMcpAuthenticationSlot,
  readmitMcpSlot,
} from '@/lib/mcp/core/budget';
import { requireMcp, McpBoundaryError } from '@/lib/mcp/core/errors';
import { readMcpBody } from '@/lib/mcp/protocol/input';
import {
  createOpsKnightMcpServer,
  toolErrorResult,
  toolErrorText,
} from '@/lib/mcp/protocol/server';
import { boundMcpResponse } from '@/lib/mcp/core/response';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import {
  MAX_RESOURCE_SUBSCRIPTIONS,
  MY_PAGES_URI,
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
  createMcpTask,
  getMcpTask,
  taskTargetOf,
  updateMcpTask,
} from '@/lib/mcp/protocol/tasks';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { logger, runWithContext } from '@/lib/logger';
import { trustedMcpRequestId } from '@/lib/mcp/request-id';
import { mcpForceDisabled } from '@/lib/mcp/core/kill-switch';
import { recordMcpGrantCall } from '@/lib/mcp/core/usage';
import { mcpCallLogOperationId, recordMcpCallLog } from '@/lib/mcp/core/call-log';
import { MCP_PROTOCOL_REVISION } from '@/lib/mcp/protocol/revision';
import {
  MCP_TIMED_OUTCOMES,
  mcpErrorOutcome,
  mcpMetricTool,
  mcpToolErrored,
  type McpMetricOutcome,
} from '@/lib/mcp/protocol/metrics';
import { isMcpCapabilityDisabled } from '@/lib/mcp/catalog/capabilities';
import { stepUpScopes } from '@/lib/mcp/auth/step-up';
import { myPagesBus } from '@/lib/mcp/protocol/page-push';
import { mcpClientExtensions } from '@/lib/mcp/protocol/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // One id for the whole request: the one the middleware validated and returns as x-request-id,
  // on every log line, and on every response including errors, so a client error can be matched.
  const requestId = trustedMcpRequestId(request);
  const response = await runWithContext({ requestId, component: 'mcp' }, () =>
    withMcpDatabase(() =>
      withMcpRuntime(() =>
        withBrowserCors(request, browserOrigin => handlePost(request, requestId, browserOrigin))
      )
    )
  );
  return withRequestId(response, requestId);
}

function withRequestId(response: Response, requestId: string) {
  try {
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch {
    // Some runtime responses have immutable headers; rebuild around the same body.
    const headers = new Headers(response.headers);
    headers.set('X-Request-Id', requestId);
    return new Response(response.body, { status: response.status, headers });
  }
}

/**
 * Fraction of plain `served` requests that write mcp.request.completed (MCP_LOG_SAMPLE_SERVED,
 * 0 to 1, default 1). Every other outcome is always logged.
 */
function servedSampleRate() {
  const raw = Number(process.env.MCP_LOG_SAMPLE_SERVED ?? '1');
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
}
/** CORS preflight for a browser-hosted client on an allowed origin (Allowed browser origins). */
export const OPTIONS = browserPreflight;

async function handlePost(request: Request, requestId: string, browserOrigin: string | null) {
  const started = performance.now();
  const span = startMcpSpan(requestId, request.headers);
  let outcome: McpMetricOutcome = 'error';
  let tool = 'none';
  let method: string | undefined;
  let release: (() => void) | undefined;
  let releaseAuth: (() => void) | undefined;
  let budget: CostBudget | undefined;
  let rpcId: string | number | null = null;
  // Attribution for the completion log, set as soon as the bearer resolves so 429/busy count too.
  let grantId: string | undefined;
  let clientId: string | undefined;
  let userId: string | undefined;
  let errorCode: string | undefined;
  // Activity log: the catalog operation this call ran, once the body is read.
  let operationId: string | null = null;
  try {
    assertMcpHost(request, false, browserOrigin);
    requireMcp(!mcpForceDisabled(), 'MCP_DISABLED', 503);
    releaseAuth = acquireMcpAuthenticationSlot();
    requireMcp(!request.headers.has('mcp-session-id'), 'MCP_SESSIONS_UNSUPPORTED');
    // Verify bearer authority before accepting a potentially slow upload. Release the
    // authentication slot before reading; only authenticated callers occupy work slots.
    let identity = await authenticateMcp(request, null);
    grantId = identity.grantId;
    clientId = identity.clientId;
    userId = identity.auth.actor.id;
    releaseAuth();
    releaseAuth = undefined;
    // Fairness is per person: all of one user's connections share one slot cap.
    release = await acquireMcpSlot(identity.policy.maxInFlight, {
      ownerId: identity.auth.actor.id,
    });
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
    linkMcpTrace(span, body.params?._meta);
    tool = mcpMetricTool(body.method, body.params?.name);
    if (body.method === 'tools/call')
      operationId = mcpCallLogOperationId(tool, body.params?.arguments);
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
      ownerId: identity.auth.actor.id,
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
        : body.method === 'tools/call'
          ? (mcpCompositeCost(body.params?.name, body.params?.arguments) ?? 1)
          : body.method === 'resources/list'
            ? RESOURCE_LIST_COST
            : 1;
    requireMcp(cost <= MCP_MAX_OPERATIONS, 'MCP_OPERATION_BUDGET_EXCEEDED');
    await chargeMcpRequest(
      { grantId: identity.grantId, userId: identity.auth.actor.id, policy: identity.policy },
      cost
    );
    // A policy saved before the cap existed may hold 9 to 16; the cap is what is enforced.
    budget = new CostBudget(
      Math.min(identity.policy.maxOperations, MCP_MAX_OPERATIONS),
      262144,
      request.signal
    );
    const context = {
      grantId: identity.grantId,
      credentialId: identity.credentialId,
      credentialKind: identity.kind,
      tokenScopes: identity.tokenScopes,
      requestId,
      budget,
      omitResourceLinks: !request.headers.has('mcp-protocol-version'),
      clientExtensions: modern ? mcpClientExtensions(body.params) : {},
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
        const { readOperation, args } = parseSubscriptionUri(uri);
        try {
          await callMcpOperation(context, readOperation, args);
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
    // Step-up (opt-in): a call this connection lacks a grantable permission for gets an HTTP 403
    // insufficient_scope challenge, so a supporting client re-opens consent for just that. A
    // personal access token has no consent to re-open, so it keeps the plain tool error.
    const stepUp =
      identity.policy.scopeStepUpEnabled && identity.kind !== 'PAT'
        ? stepUpScopes(identity.auth.actor, {
            clientScopes: identity.clientScopes,
            policy: identity.policy,
            method: body.method,
            params: body.params,
          })
        : null;
    if (stepUp) {
      outcome = 'protocol_rejected';
      const error = new McpBoundaryError('MCP_INSUFFICIENT_SCOPE', 403);
      error.challengeScope = stepUp.join(' ');
      return mcpHttpError(error);
    }
    const handler = createMcpHandler(
      () =>
        createOpsKnightMcpServer(
          context,
          identity.auth.actor,
          identity.policy.writesEnabled,
          identity.policy.sensitiveReadsEnabled,
          identity.policy.disabledCapabilities,
          identity.policy.responderDirectWritesEnabled
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
        await handler.fetch(request, { parsedBody: body, authInfo: identity.authInfo }),
        budget.maxBytes
      );
      const taskResponse =
        supportsTasks &&
        body.method === 'tools/call' &&
        TASK_CAPABLE_TOOLS.has(String(body.params?.name))
          ? await asTaskResponse(
              response,
              context,
              identity.auth.actor.id,
              String(body.params?.name)
            )
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
    errorCode = error instanceof McpBoundaryError ? error.code : undefined;
    if (
      !(error instanceof McpBoundaryError) ||
      (error.status >= 500 && !['MCP_BUSY', 'MCP_DISABLED'].includes(error.code))
    )
      logger.error('mcp.request.unexpected_error', {
        requestId,
        grantId,
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
            result: toolErrorResult(toolErrorText(error), error, requestId),
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
    const durationMs = performance.now() - started;
    addOperationalMetric('opsknight_mcp_requests_total', 1, { outcome, tool });
    endMcpSpan(span, { method, tool, outcome, durationMs });
    // Rejections are counted above, never timed: a flood of fast 429s must not hide slow calls.
    if (MCP_TIMED_OUTCOMES.has(outcome))
      observeOperationalHistogram('opsknight_mcp_request_duration_seconds', durationMs / 1000, {
        outcome,
        tool,
      });
    // The stable per-request record for log pipelines and SIEMs. Never arguments or results.
    if (outcome !== 'served' || Math.random() < servedSampleRate())
      logger.info('mcp.request.completed', {
        requestId,
        grantId,
        clientId,
        method,
        tool,
        outcome,
        durationMs: Math.round(durationMs),
        ...(errorCode ? { errorCode } : {}),
      });
    // Same bounded labels as the metrics; never the arguments. Notifications do no work.
    if (grantId && outcome !== 'notification')
      recordMcpCallLog({
        grantId,
        clientId: clientId ?? null,
        userId: userId ?? null,
        tool,
        operationId,
        outcome,
        durationMs,
        requestId,
        errorCode: errorCode ?? null,
      });
  }
}

/**
 * A task-capable tool whose result is a durable wait (a started runbook execution, or an approval
 * still PENDING) becomes a task handle for a client that opted in. Errors, non-JSON responses and
 * results that are already final pass through unchanged.
 */
async function asTaskResponse(
  response: Response,
  context: Parameters<typeof createMcpTask>[0],
  actorId: string,
  toolName: string
) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    return null;
  const message = (await response.clone().json()) as {
    id: string | number | null;
    result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
  };
  if (message.result?.isError) return null;
  const target = taskTargetOf(toolName, message.result?.structuredContent);
  if (!target) return null;
  const task = await createMcpTask(context, actorId, toolName, target);
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
  const releaseStream = acquireStreamSlot(identity.grantId, identity.auth.actor.id);
  const untrack = trackSubscription(uris);
  const handler = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        context,
        identity.auth.actor,
        identity.policy.writesEnabled,
        identity.policy.sensitiveReadsEnabled,
        identity.policy.disabledCapabilities,
        identity.policy.responderDirectWritesEnabled
      ),
    {
      legacy: 'reject',
      responseMode: 'auto',
      maxRequestBodySize: 65536,
      maxSubscriptions: 1,
      bus: uris.includes(MY_PAGES_URI)
        ? myPagesBus(mcpEventBus, context, identity.auth.actor.id)
        : mcpEventBus,
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
    response = await handler.fetch(request, { parsedBody: body, authInfo: identity.authInfo });
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
  // Turning MCP off, disabling a subscribed resource's read, a role or team change, or losing
  // access to any subscribed resource ends the stream at the next check.
  const subscriptions = uris.map(uri => parseSubscriptionUri(uri));
  const sameActor = (actor: typeof identity.auth.actor) =>
    actor.id === identity.auth.actor.id &&
    actor.role === identity.auth.actor.role &&
    teamKey(actor) === teamKey(identity.auth.actor);
  let revalidating = false;
  timers.revalidate = setInterval(() => {
    if (revalidating || closed) return;
    revalidating = true;
    void withMcpDatabase(async () => {
      const { policy, auth } = await resolveMcpGrantWithPolicy(
        identity.grantId,
        identity.credentialId
      );
      if (
        !policy?.enabled ||
        subscriptions.some(({ readOperation }) =>
          isMcpCapabilityDisabled(policy.disabledCapabilities, readOperation)
        )
      )
        return false;
      if (!sameActor(auth.actor)) return false;
      // The same person can still lose a resource (moved to another team, made private).
      // Re-read each subscribed resource with fresh authority under a small budget.
      const recheck = new CostBudget(MAX_RESOURCE_SUBSCRIPTIONS, 262144);
      try {
        for (const { readOperation, args } of subscriptions)
          await callMcpOperation({ ...context, budget: recheck }, readOperation, args);
      } finally {
        await recheck.drain();
      }
      return true;
    })
      .then(stillAllowed => {
        if (!stillAllowed) {
          logger.info('mcp.subscription.access_lost', { grantId: identity.grantId });
          void cleanup();
        }
      })
      .catch(() => {
        logger.info('mcp.subscription.access_lost', { grantId: identity.grantId });
        void cleanup();
      })
      .finally(() => {
        revalidating = false;
      });
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
  // Reverse proxies (nginx) must pass events through as they are written, not buffer the stream.
  headers.set('X-Accel-Buffering', 'no');
  return new Response(stream, { status: response.status, headers });
}

function teamKey(actor: { teamIds?: readonly string[] }) {
  return [...(actor.teamIds ?? [])].sort().join(',');
}

export function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
export const DELETE = GET;
