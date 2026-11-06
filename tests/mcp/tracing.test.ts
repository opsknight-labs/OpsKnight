import { SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { endMcpSpan, startMcpSpan } from '@/lib/mcp/protocol/tracing';
import { recordSpans } from '../helpers/fake-tracer';

afterEach(() => trace.disable());

describe('MCP request spans', () => {
  it('start with the request id and finish with bounded labels, once', () => {
    const { spans } = recordSpans();
    const span = startMcpSpan('req-123');
    endMcpSpan(span, { method: 'tools/call', tool: 'whoami', outcome: 'served', durationMs: 12.6 });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: 'mcp.request',
      startAttributes: { 'mcp.request_id': 'req-123' },
      attributes: {
        'mcp.method': 'tools/call',
        'mcp.tool': 'whoami',
        'mcp.outcome': 'served',
        'mcp.duration_ms': 13,
      },
      ended: 1,
    });
    expect(spans[0]!.status).toBeUndefined();
  });

  it('marks only server failures as errors, not refusals the caller caused', () => {
    const { spans } = recordSpans();
    for (const outcome of [
      'error',
      'unavailable',
      'tool_error',
      'rate_limited',
      'forbidden',
      'busy',
    ])
      endMcpSpan(startMcpSpan(`r-${outcome}`), { tool: 'none', outcome, durationMs: 1 });
    const failed = spans.filter(span => span.status?.code === SpanStatusCode.ERROR);
    expect(failed.map(span => span.attributes['mcp.outcome']).sort()).toEqual([
      'error',
      'unavailable',
    ]);
  });

  it('never carries a person, assistant, connection, argument or result', () => {
    const { spans } = recordSpans();
    endMcpSpan(startMcpSpan('req-1'), {
      method: undefined,
      tool: 'incident_search',
      outcome: 'served',
      durationMs: 5,
    });
    const keys = Object.keys({ ...spans[0]!.startAttributes, ...spans[0]!.attributes });
    expect(
      keys.filter(key => /user|client|grant|actor|email|arg|param|result|token/i.test(key))
    ).toEqual([]);
    expect(spans[0]!.attributes['mcp.method']).toBe('unknown');
  });

  it('is a harmless no-op when no tracer is registered', () => {
    trace.disable();
    expect(() =>
      endMcpSpan(startMcpSpan('req-none'), { tool: 'none', outcome: 'error', durationMs: 0 })
    ).not.toThrow();
  });
});
