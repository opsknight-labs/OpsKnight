import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

/**
 * One OpenTelemetry span per /mcp request. It costs nothing until an operator registers a tracer
 * (the API alone is a no-op), so there is no setting to turn on. Attributes are the same bounded
 * labels the metrics use (method, tool, outcome) plus the request id for joining with logs. Never a
 * person, assistant, connection, argument or result: spans are often exported to third parties.
 */
export const MCP_TRACER_NAME = 'opsknight-mcp';

/** Outcomes that mean the server failed, not that the caller asked for something refused. */
const SERVER_FAILURES: ReadonlySet<string> = new Set(['error', 'unavailable']);

export function startMcpSpan(requestId: string): Span {
  return trace.getTracer(MCP_TRACER_NAME).startSpan('mcp.request', {
    attributes: { 'mcp.request_id': requestId },
  });
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
