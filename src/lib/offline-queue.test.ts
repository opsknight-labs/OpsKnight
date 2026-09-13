import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueRequest,
  listQueuedRequests,
  removeQueuedRequest,
  flushQueuedRequests,
  resumeAuthRequiredOperations,
} from './offline-queue';

// Manual Mock of IndexedDB
const requestStore = new Map<string, any>();

const mockTransaction = {
  objectStore: vi.fn(),
  oncomplete: null as any,
  onerror: null as any,
  onabort: null as any,
  error: null as any,
  abort: vi.fn(),
};

const mockStore = {
  put: vi.fn((item: any) => {
    requestStore.set(item.id, item);
    const req = { onsuccess: null as any, onerror: null as any, result: item.id };
    queueMicrotask(() => {
      req.onsuccess && req.onsuccess({} as any);
      mockTransaction.oncomplete && mockTransaction.oncomplete({} as any);
    });
    return req;
  }),
  delete: vi.fn((id: string) => {
    requestStore.delete(id);
    const req = { onsuccess: null as any, onerror: null as any, result: undefined };
    queueMicrotask(() => {
      req.onsuccess && req.onsuccess({} as any);
      mockTransaction.oncomplete && mockTransaction.oncomplete({} as any);
    });
    return req;
  }),
  getAll: vi.fn(() => {
    const req = {
      result: Array.from(requestStore.values()),
      onsuccess: null as any,
      onerror: null as any,
      error: null as any,
    };
    queueMicrotask(() => req.onsuccess && req.onsuccess({} as any));
    return req;
  }),
  index: vi.fn(() => ({
    openCursor: vi.fn(() => {
      const values = Array.from(requestStore.values()).sort((a, b) => a.createdAt - b.createdAt);
      let index = 0;
      const request = { result: null as any, onsuccess: null as any };

      const advance = () => {
        if (index < values.length) {
          request.result = {
            value: values[index],
            continue: () => {
              index++;
              advance();
            },
          };
          request.onsuccess && request.onsuccess({} as any);
        } else {
          request.result = null;
          request.onsuccess && request.onsuccess({} as any);
          mockTransaction.oncomplete && mockTransaction.oncomplete({} as any);
        }
      };

      queueMicrotask(advance);
      return request;
    }),
  })),
  indexNames: { contains: vi.fn(() => true) },
  createIndex: vi.fn(),
};

mockTransaction.objectStore.mockImplementation(() => mockStore);

const mockDb = {
  transaction: vi.fn(() => mockTransaction),
  createObjectStore: vi.fn(() => mockStore),
  objectStoreNames: { contains: vi.fn(() => true) },
  close: vi.fn(),
};

const mockOpenRequest = {
  result: mockDb,
  transaction: mockTransaction,
  onupgradeneeded: null as any,
  onsuccess: null as any,
  onerror: null as any,
  error: null as any,
};

const originalIndexedDB = global.indexedDB;
const originalFetch = global.fetch;

function response(status: number, payload: Record<string, unknown> = {}, headers = new Headers()) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    clone() {
      return this;
    },
    async json() {
      return payload;
    },
  } as Response;
}

async function enqueueAckThenResolve() {
  await enqueueRequest({
    operation: 'INCIDENT_STATUS',
    url: '/api/incidents/inc-fifo/status',
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
    idempotencyKey: 'ack-fifo',
    expectedState: 'OPEN',
  });
  await enqueueRequest({
    operation: 'INCIDENT_STATUS',
    url: '/api/incidents/inc-fifo/status',
    method: 'PATCH',
    body: JSON.stringify({ status: 'RESOLVED' }),
    idempotencyKey: 'resolve-fifo',
    expectedState: 'ACKNOWLEDGED',
  });
}

describe('offline-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestStore.clear();
    mockTransaction.oncomplete = null;
    mockTransaction.onerror = null;
    mockTransaction.onabort = null;
    mockTransaction.error = null;
    mockTransaction.objectStore.mockImplementation(() => mockStore);

    global.indexedDB = {
      open: vi.fn(() => {
        setTimeout(() => mockOpenRequest.onsuccess && mockOpenRequest.onsuccess({} as any), 0);
        return mockOpenRequest;
      }),
    } as any;

    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.indexedDB = originalIndexedDB;
    global.fetch = originalFetch;
  });

  it('should enqueue a request', async () => {
    const id = await enqueueRequest({
      url: '/api/test',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(requestStore.size).toBe(1);
    expect(requestStore.get(id).url).toBe('/api/test');
    expect(requestStore.get(id).state).toBe('PENDING');
    expect(requestStore.get(id).headers['Idempotency-Key']).toBeTruthy();
  });

  it('should list queued requests', async () => {
    await enqueueRequest({ url: '/api/1', method: 'GET' });
    await enqueueRequest({ url: '/api/2', method: 'GET' });

    const list = await listQueuedRequests();
    expect(list).toHaveLength(2);
    expect(list[0].url).toBe('/api/1');
    expect(list[1].url).toBe('/api/2');
  });

  it('should remove a queued request', async () => {
    const id = await enqueueRequest({ url: '/api/1', method: 'GET' });

    await removeQueuedRequest(id);

    const list = await listQueuedRequests();
    expect(list).toHaveLength(0);
  });

  it('resumes AUTH_REQUIRED operations after authentication and replays the original idempotency key', async () => {
    const id = await enqueueRequest({
      operation: 'INCIDENT_STATUS',
      url: '/api/incidents/inc-1/status',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
      idempotencyKey: 'ack-inc-1',
      expectedState: 'OPEN',
    });

    vi.mocked(global.fetch).mockResolvedValueOnce(
      response(401, { error: 'Session expired', code: 'AUTH_REQUIRED' })
    );

    await flushQueuedRequests();
    let queued = await listQueuedRequests();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe(id);
    expect(queued[0].state).toBe('AUTH_REQUIRED');
    expect(queued[0].idempotencyKey).toBe('ack-inc-1');

    const resumed = await resumeAuthRequiredOperations();
    expect(resumed).toBe(1);

    queued = await listQueuedRequests();
    expect(queued[0].state).toBe('PENDING');
    expect(queued[0].idempotencyKey).toBe('ack-inc-1');
    expect(queued[0].expectedState).toBe('OPEN');

    vi.mocked(global.fetch).mockResolvedValueOnce(response(200));

    await flushQueuedRequests();
    queued = await listQueuedRequests();
    expect(queued[0].state).toBe('SUCCEEDED');
    expect(vi.mocked(global.fetch)).toHaveBeenLastCalledWith(
      '/api/incidents/inc-1/status',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'ack-inc-1' }),
        credentials: 'include',
      })
    );
  });

  it('does not let RESOLVE leapfrog an ACK backing off after 429', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      response(429, { error: 'Rate limited' }, new Headers({ 'retry-after': '30' }))
    );

    await flushQueuedRequests();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);

    await flushQueuedRequests();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);

    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('PENDING');
    expect(queue[0].nextAttemptAt).toBeGreaterThan(Date.now());
    expect(queue[1].state).toBe('PENDING');
    expect(queue[1].retryCount).toBe(0);
  });

  it('does not let RESOLVE leapfrog an ACK after an ambiguous network failure', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('radio changed network'));

    await flushQueuedRequests();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);

    await flushQueuedRequests();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);

    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('PENDING');
    expect(queue[0].nextAttemptAt).toBeGreaterThan(Date.now());
    expect(queue[1].state).toBe('PENDING');
    expect(queue[1].retryCount).toBe(0);
  });

  it('does not let RESOLVE leapfrog an AUTH_REQUIRED ACK', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockResolvedValueOnce(response(401, { error: 'Sign in required' }));

    await flushQueuedRequests();
    await flushQueuedRequests();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('AUTH_REQUIRED');
    expect(queue[1].state).toBe('PENDING');
    expect(queue[1].retryCount).toBe(0);
  });

  it('does not let RESOLVE leapfrog a conflicting ACK', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockResolvedValueOnce(response(409, { error: 'Incident changed' }));

    await flushQueuedRequests();
    await flushQueuedRequests();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('CONFLICT');
    expect(queue[1].state).toBe('PENDING');
    expect(queue[1].retryCount).toBe(0);
  });

  it('classifies 403 as terminal FORBIDDEN and never revives it after login', async () => {
    await enqueueRequest({
      operation: 'INCIDENT_STATUS',
      url: '/api/incidents/inc-forbidden/status',
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
      idempotencyKey: 'ack-forbidden',
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(response(403, { error: 'Not authorized' }));

    await flushQueuedRequests();
    let queue = await listQueuedRequests();
    expect(queue[0].state).toBe('FORBIDDEN');

    expect(await resumeAuthRequiredOperations()).toBe(0);
    queue = await listQueuedRequests();
    expect(queue[0].state).toBe('FORBIDDEN');
  });
});
