import { ROOT_CONTEXT, SpanStatusCode, propagation, trace, type Span } from '@opentelemetry/api';

/**
 * One OpenTelemetry span per /mcp request. It costs nothing until an operator registers a tracer
 * (the API alone is a no-op), so there is no setting to turn on. Attributes are the same bounded
 * labels the metrics use (method, tool, outcome) plus the request id for joining with logs. Never a
 * person, assistant, connection, argument or result: spans are often exported to third parties.
 */
export const MCP_TRACER_NAME = 'opsknight-mcp';

/** Outcomes that mean the server failed, not that the caller asked for something refused. */
const SERVER_FAILURES: ReadonlySet<string> = new Set(['error', 'unavailable']);

const headerGetter = {
  get: (headers: Headers, key: string) => headers.get(key) ?? undefined,
  keys: (headers: Headers) => [...headers.keys()],
};

/**
 * Starts the request span as a child of the caller's trace when the HTTP request carries W3C
 * trace headers and the operator registered a propagator; otherwise as a new trace.
 */
export function startMcpSpan(requestId: string, headers?: Headers): Span {
  return trace
    .getTracer(MCP_TRACER_NAME)
    .startSpan(
      'mcp.request',
      { attributes: { 'mcp.request_id': requestId } },
      headers ? propagation.extract(ROOT_CONTEXT, headers, headerGetter) : undefined
    );
}

/**
 * The 2026-07-28 revision carries trace context in the request's `_meta` rather than in HTTP
 * headers. The body is parsed after the span starts, so that trace is attached as a link.
 */
export function linkMcpTrace(span: Span, meta: unknown) {
  if (!meta || typeof meta !== 'object') return;
  const { traceparent, tracestate } = meta as Record<string, unknown>;
  if (typeof traceparent !== 'string') return;
  const context = trace.getSpanContext(
    propagation.extract(ROOT_CONTEXT, {
      traceparent,
      ...(typeof tracestate === 'string' ? { tracestate } : {}),
    })
  );
  if (context) span.addLink({ context });
}

export function endMcpSpan(
  span: Span,
  result: { method?: string; tool: string; outcome: string; durationMs: number }
) {
  span.setAttributes({
    'mcp.method': result.method ?? 'unknown',
    'mcp.tool': result.tool,
    'mcp.outcome': result.outcome,
    'mcp.duration_ms': Math.round(result.durationMs),
  });
  if (SERVER_FAILURES.has(result.outcome))
    span.setStatus({ code: SpanStatusCode.ERROR, message: result.outcome });
  span.end();
}
