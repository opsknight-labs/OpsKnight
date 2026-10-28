import { SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { failSpan, startSpan, withSpan } from '@/lib/intelligence/telemetry';
import { installFakeTracer, type FakeSpan } from '../helpers/fake-tracer';

let spans: FakeSpan[];
beforeEach(() => {
  trace.disable();
  spans = installFakeTracer();
});
afterEach(() => trace.disable());

describe('withSpan', () => {
  it('records attributes, returns the result and always ends the span', async () => {
    const result = await withSpan('intelligence.test', { kind: 'X', n: 2 }, async span => {
      span.setAttribute('extra', true);
      return 42;
    });
    expect(result).toBe(42);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ name: 'intelligence.test', ended: true, attributes: { kind: 'X', n: 2, extra: true } });
    expect(spans[0].status).toBeUndefined();
  });

  it('marks failures by error type only and rethrows the original error', async () => {
    const failure = new RangeError('customer secret in message');
    await expect(withSpan('intelligence.test', {}, async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].status).toEqual({ code: SpanStatusCode.ERROR });
    expect(spans[0].attributes['error.type']).toBe('RangeError');
    expect(JSON.stringify(spans[0])).not.toContain('customer secret');
  });
});

describe('startSpan and failSpan', () => {
  it('supports spans that cannot be wrapped in a callback', () => {
    const span = startSpan('intelligence.manual', { a: 1 });
    failSpan(span, 'not an Error');
    span.end();
    expect(spans[0]).toMatchObject({ name: 'intelligence.manual', ended: true, status: { code: SpanStatusCode.ERROR }, attributes: { a: 1, 'error.type': 'unknown' } });
  });
});

describe('without a tracer provider', () => {
  it('is a transparent no-op', async () => {
    trace.disable();
    await expect(withSpan('intelligence.noop', { a: 1 }, async () => 'ok')).resolves.toBe('ok');
    await expect(withSpan('intelligence.noop', {}, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
