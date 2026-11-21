import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

// Resolved per call so a tracer provider registered after this module loads is still picked up.
const tracer = () => trace.getTracer('opsknight.intelligence', '1.0');

type Attributes = Record<string, string | number | boolean>;

/**
 * Runs `work` inside a span. Without a registered tracer provider the OpenTelemetry API hands back
 * non-recording spans, so this costs almost nothing and changes no behaviour when tracing is off.
 * Attributes must be bounded categories or numbers: never incident ids, prompts, answers or errors'
 * messages, which can contain customer data. A failure is recorded by its type only.
 */
export async function withSpan<T>(name: string, attributes: Attributes, work: (span: Span) => Promise<T>): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async span => {
    try {
      return await work(span);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute('error.type', error instanceof Error ? error.name : 'unknown');
      throw error;
    } finally {
      span.end();
    }
  });
}

/** For code that cannot be wrapped in a callback, such as an async generator. */
export function startSpan(name: string, attributes: Attributes): Span {
  return tracer().startSpan(name, { attributes });
}

export function failSpan(span: Span, error: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.setAttribute('error.type', error instanceof Error ? error.name : 'unknown');
}
