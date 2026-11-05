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


export class FakeSpan {
  attributes: Record<string, unknown>;
  status?: { code: number };
  ended = false;
  constructor(
    readonly name: string,
    attributes: Record<string, unknown> = {}
  ) {
    this.attributes = { ...attributes };
  }
  setAttribute(key: string, value: unknown) {
    Object.assign(this.attributes, { [key]: value });
    return this;
  }
  setStatus(status: { code: number }) {
    this.status = status;
    return this;
  }
  end() {
    this.ended = true;
  }
}

export function installFakeTracer() {
  const spans: FakeSpan[] = [];
  const tracer = {
    startSpan(name: string, options?: { attributes?: Record<string, unknown> }) {
      const span = new FakeSpan(name, options?.attributes);
      spans.push(span);
      return span;
    },
    startActiveSpan(name: string, ...args: unknown[]) {
      const work = args.at(-1) as (span: FakeSpan) => unknown;
      const options = args.length > 1 ? (args[0] as { attributes?: Record<string, unknown> }) : undefined;
      const span = new FakeSpan(name, options?.attributes);
      spans.push(span);
      return work(span);
    },
  };
  trace.setGlobalTracerProvider({ getTracer: () => tracer } as never);
  return spans;
}
