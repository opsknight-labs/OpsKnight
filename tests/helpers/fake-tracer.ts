import { trace, type TracerProvider } from '@opentelemetry/api';

export type RecordedSpan = {
  name: string;
  startAttributes: Record<string, unknown>;
  attributes: Record<string, unknown>;
  status?: { code: number; message?: string };
  ended: number;
};

/** Registers an in-memory tracer provider; call the returned function to remove it. */
export function recordSpans() {
  const spans: RecordedSpan[] = [];
  const provider = {
    getTracer: () => ({
      startSpan: (name: string, options?: { attributes?: Record<string, unknown> }) => {
        const recorded: RecordedSpan = {
          name,
          startAttributes: { ...(options?.attributes ?? {}) },
          attributes: {},
          ended: 0,
        };
        spans.push(recorded);
        return {
          setAttributes(attributes: Record<string, unknown>) {
            Object.assign(recorded.attributes, attributes);
            return this;
          },
          setStatus(status: { code: number; message?: string }) {
            recorded.status = status;
            return this;
          },
          end() {
            recorded.ended += 1;
          },
        };
      },
      startActiveSpan: () => undefined,
    }),
  } as unknown as TracerProvider;
  trace.disable();
  trace.setGlobalTracerProvider(provider);
  return { spans, stop: () => trace.disable() };
}
