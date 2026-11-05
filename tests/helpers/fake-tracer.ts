import { trace } from '@opentelemetry/api';

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
