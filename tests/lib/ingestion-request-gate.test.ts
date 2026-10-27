import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ mode: 'postgres', maxInFlightRequests: 2 }));
vi.mock('@/lib/ingestion/config', () => ({ ingestionConfig: () => fixture }));
import { withIngestionRequestSlot } from '@/lib/ingestion/request-gate';

function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function rejectAfterWait(operation: () => Promise<Response>) {
  const response = withIngestionRequestSlot(operation);
  await vi.advanceTimersByTimeAsync(26);
  return response;
}

describe('asynchronous ingestion request backpressure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fixture.mode = 'postgres';
    fixture.maxInFlightRequests = 2;
    globalThis.opsknightIngestionRequestGate = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.opsknightIngestionRequestGate = undefined;
  });
  it('expires queued work without running authentication, body reads or database operations', async () => {
    const a = deferred(),
      b = deferred();
    const first = withIngestionRequestSlot(() => a.promise);
    const second = withIngestionRequestSlot(() => b.promise);
    const excess = vi.fn();
    const response = await rejectAfterWait(excess);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(excess).not.toHaveBeenCalled();
    a.resolve(new Response('accepted', { status: 202 }));
    expect((await first).status).toBe(202);
    expect(
      (await withIngestionRequestSlot(async () => new Response(null, { status: 204 }))).status
    ).toBe(204);
    b.resolve(new Response());
    await second;
    expect(globalThis.opsknightIngestionRequestGate?.active).toBe(0);
  });
  it('holds the slot until the actual operation finishes and releases it on rejection', async () => {
    fixture.maxInFlightRequests = 1;
    const pending = deferred();
    const active = withIngestionRequestSlot(() => pending.promise);
    const failed = expect(active).rejects.toThrow('failed transaction');
    await Promise.resolve();
    expect((await rejectAfterWait(async () => new Response())).status).toBe(503);
    pending.reject(new Error('failed transaction'));
    await failed;
    expect((await withIngestionRequestSlot(async () => new Response())).status).toBe(200);
  });
  it('shares counters across module instances and honors lower capacity without cancelling accepted work', async () => {
    const a = deferred(),
      b = deferred();
    const first = withIngestionRequestSlot(() => a.promise);
    const second = withIngestionRequestSlot(() => b.promise);
    vi.resetModules();
    const other = await import('@/lib/ingestion/request-gate');
    fixture.maxInFlightRequests = 1;
    const queued = other.withIngestionRequestSlot(async () => new Response());
    await vi.advanceTimersByTimeAsync(26);
    expect((await queued).status).toBe(503);
    a.resolve(new Response());
    await first;
    const stillQueued = other.withIngestionRequestSlot(async () => new Response());
    await vi.advanceTimersByTimeAsync(26);
    expect((await stillQueued).status).toBe(503);
    b.resolve(new Response());
    await second;
    expect((await other.withIngestionRequestSlot(async () => new Response())).status).toBe(200);
  });
  it('preserves synchronous mode without concurrency rejection', async () => {
    fixture.mode = 'sync';
    globalThis.opsknightIngestionRequestGate = { active: 100 };
    expect((await withIngestionRequestSlot(async () => new Response('legacy'))).status).toBe(200);
    expect(globalThis.opsknightIngestionRequestGate.active).toBe(100);
  });

  it('hands released permits to FIFO waiters and bounds the unparsed waiting queue', async () => {
    const a = deferred(),
      b = deferred(),
      c = deferred(),
      d = deferred();
    const order: string[] = [];
    const activeA = withIngestionRequestSlot(() => a.promise);
    const activeB = withIngestionRequestSlot(() => b.promise);
    const queuedC = withIngestionRequestSlot(() => {
      order.push('c');
      return c.promise;
    });
    const queuedD = withIngestionRequestSlot(() => {
      order.push('d');
      return d.promise;
    });
    const excess = vi.fn();
    expect((await withIngestionRequestSlot(excess)).status).toBe(503);
    expect(excess).not.toHaveBeenCalled();
    expect(globalThis.opsknightIngestionRequestGate?.waiting).toHaveLength(2);
    expect(order).toEqual([]);
    a.resolve(new Response());
    await activeA;
    expect(order).toEqual(['c']);
    expect(globalThis.opsknightIngestionRequestGate?.active).toBe(2);
    b.resolve(new Response());
    await activeB;
    expect(order).toEqual(['c', 'd']);
    expect(globalThis.opsknightIngestionRequestGate?.active).toBe(2);
    c.resolve(new Response());
    d.resolve(new Response());
    await Promise.all([queuedC, queuedD]);
    expect(globalThis.opsknightIngestionRequestGate?.active).toBe(0);
    expect(globalThis.opsknightIngestionRequestGate?.waiting).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('transfers a failed active operation slot without timing out the active transaction', async () => {
    fixture.maxInFlightRequests = 1;
    const a = deferred();
    const first = withIngestionRequestSlot(() => a.promise);
    const failed = expect(first).rejects.toThrow('failed');
    const operation = vi.fn(async () => new Response(null, { status: 202 }));
    const queued = withIngestionRequestSlot(operation);
    await vi.advanceTimersByTimeAsync(10);
    expect(operation).not.toHaveBeenCalled();
    a.reject(new Error('failed'));
    await failed;
    expect((await queued).status).toBe(202);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(globalThis.opsknightIngestionRequestGate?.active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires a waiter even when the timer callback is delayed by a busy event loop', async () => {
    fixture.maxInFlightRequests = 1;
    let time = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => time);
    try {
      const a = deferred();
      const active = withIngestionRequestSlot(() => a.promise);
      const operation = vi.fn(async () => new Response());
      const queued = withIngestionRequestSlot(operation);
      time = 26;
      a.resolve(new Response());
      await active;
      expect((await queued).status).toBe(503);
      expect(operation).not.toHaveBeenCalled();
      expect(globalThis.opsknightIngestionRequestGate?.active).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it('removes expired queue entries before applying the waiting bound to a new caller', async () => {
    fixture.maxInFlightRequests = 1;
    let time = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => time);
    try {
      const a = deferred();
      const active = withIngestionRequestSlot(() => a.promise);
      const expiredOperation = vi.fn(async () => new Response());
      const expired = withIngestionRequestSlot(expiredOperation);
      time = 26;
      const operation = vi.fn(async () => new Response(null, { status: 202 }));
      const next = withIngestionRequestSlot(operation);
      expect((await expired).status).toBe(503);
      expect(expiredOperation).not.toHaveBeenCalled();
      expect(globalThis.opsknightIngestionRequestGate?.waiting).toHaveLength(1);
      a.resolve(new Response());
      await active;
      expect((await next).status).toBe(202);
      expect(globalThis.opsknightIngestionRequestGate?.active).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('bounded pre-admission body reads', () => {
  afterEach(() => {
    vi.useRealTimers();
    globalThis.opsknightIngestionRequestGate = undefined;
  });
  it('releases a stalled PagerDuty body slot even if stream cancellation never settles', async () => {
    vi.useFakeTimers();
    fixture.mode = 'postgres';
    fixture.maxInFlightRequests = 1;
    const { NextRequest } = await import('next/server');
    const { POST } = await import('@/app/api/integrations/pagerduty/route');
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel,
    });
    const request = new NextRequest(
      'http://localhost/api/integrations/pagerduty?integrationId=owned',
      { method: 'POST', body: stream, duplex: 'half' } as ConstructorParameters<
        typeof NextRequest
      >[1]
    );
    const pending = POST(request);
    await Promise.resolve();
    expect((await rejectAfterWait(async () => new Response())).status).toBe(503);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).status).toBe(500);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(globalThis.opsknightIngestionRequestGate?.active).toBe(0);
    expect((await withIngestionRequestSlot(async () => new Response())).status).toBe(200);
  });
  it('stops an aborted body before any admission can execute', async () => {
    fixture.mode = 'postgres';
    fixture.maxInFlightRequests = 1;
    const { NextRequest } = await import('next/server');
    const { readIntegrationBody } = await import('@/lib/integrations/request-security');
    const cancel = vi.fn();
    const signal = new AbortController();
    const request = new NextRequest('http://localhost/api/events', {
      method: 'POST',
      body: new ReadableStream({ cancel }),
      signal: signal.signal,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    const admission = vi.fn();
    const pending = withIngestionRequestSlot(async () => {
      await readIntegrationBody(request);
      admission();
      return new Response();
    });
    const rejected = expect(pending).rejects.toThrow('body interrupted');
    signal.abort();
    await rejected;
    expect(admission).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(globalThis.opsknightIngestionRequestGate?.active).toBe(0);
  });
});
