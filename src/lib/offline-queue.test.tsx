import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueRequest,
  flushQueuedRequests,
  listQueuedRequests,
  removeQueuedRequest,
  resumeAuthRequiredOperations,
  setOfflineQueuePrincipal,
  type QueuedRequest,
} from './offline-queue';
import { MOBILE_PRINCIPAL_MARKER_ID, type MobilePrincipalContext } from './mobile-principal';

type EventHandler = ((event: Event) => void) | null;
type MockRequest<T> = {
  result: T;
  onsuccess: EventHandler;
  onerror: EventHandler;
  error: DOMException | null;
};

type PrincipalRecord = {
  id: '__opsknight_active_principal__';
  kind: 'PRINCIPAL';
  principalId: string;
  authGeneration: string;
  updatedAt: number;
};
type StoredRecord = QueuedRequest | PrincipalRecord;

const requestStore = new Map<string, StoredRecord>();

const createTransaction = () => {
  let pendingRequests = 0;
  let aborted = false;

  const tx = {
    oncomplete: null as EventHandler,
    onerror: null as EventHandler,
    onabort: null as EventHandler,
    error: null as DOMException | null,
    abort: vi.fn(() => {
      aborted = true;
      queueMicrotask(() => {
        tx.onabort?.(new Event('abort'));
      });
    }),
    objectStore: vi.fn(() => store),
  };

  const notifyCompleteIfIdle = () => {
    queueMicrotask(() => {
      if (pendingRequests === 0 && !aborted) {
        tx.oncomplete?.(new Event('complete'));
      }
    });
  };

  const executeRequest = <T,>(fn: () => T): MockRequest<T> => {
    pendingRequests++;
    const request: MockRequest<T> = {
      onsuccess: null,
      onerror: null,
      error: null,
      result: undefined as T,
    };
    queueMicrotask(() => {
      if (aborted) return;
      try {
        request.result = fn();
        request.onsuccess?.(new Event('success'));
      } catch (err) {
        request.error = err as DOMException;
        request.onerror?.(new Event('error'));
      } finally {
        pendingRequests--;
        notifyCompleteIfIdle();
      }
    });
    return request;
  };

  const store = {
    put: vi.fn((item: StoredRecord) => {
      return executeRequest(() => {
        requestStore.set(item.id, item);
        return item.id;
      });
    }),
    get: vi.fn((id: string) => {
      return executeRequest(() => {
        return requestStore.get(id);
      });
    }),
    delete: vi.fn((id: string) => {
      return executeRequest(() => {
        requestStore.delete(id);
        return undefined;
      });
    }),
    getAll: vi.fn(() => {
      return executeRequest(() => {
        return Array.from(requestStore.values());
      });
    }),
    indexNames: { contains: vi.fn(() => true) },
    createIndex: vi.fn(),
  };

  return tx;
};

const mockDb = {
  transaction: vi.fn(() => createTransaction()),
  createObjectStore: vi.fn(() => ({
    indexNames: { contains: vi.fn(() => true) },
    createIndex: vi.fn(),
  })),
  objectStoreNames: { contains: vi.fn(() => true) },
  close: vi.fn(),
};

const originalIndexedDB = global.indexedDB;
const originalFetch = global.fetch;
const userA: MobilePrincipalContext = { principalId: 'user-a', authGeneration: '5' };
const userB: MobilePrincipalContext = { principalId: 'user-b', authGeneration: '2' };

function setPrincipal(context: MobilePrincipalContext) {
  let marker = document.getElementById(MOBILE_PRINCIPAL_MARKER_ID) as HTMLElement | null;
  if (!marker) {
    marker = document.createElement('div');
    marker.id = MOBILE_PRINCIPAL_MARKER_ID;
    document.body.appendChild(marker);
  }
  marker.dataset.principalId = context.principalId;
  marker.dataset.authGeneration = context.authGeneration;
}

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

async function enqueueAckThenResolve(incidentId = 'inc-fifo') {
  await enqueueRequest({
    operation: 'INCIDENT_STATUS',
    url: `/api/incidents/${incidentId}/status`,
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
    idempotencyKey: `ack-${incidentId}`,
    expectedState: 'OPEN',
  });
  await enqueueRequest({
    operation: 'INCIDENT_STATUS',
    url: `/api/incidents/${incidentId}/status`,
    method: 'PATCH',
    body: JSON.stringify({ status: 'RESOLVED' }),
    idempotencyKey: `resolve-${incidentId}`,
    expectedState: 'ACKNOWLEDGED',
  });
}

describe('offline-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestStore.clear();
    document.body.innerHTML = '';
    setPrincipal(userA);

    global.indexedDB = {
      open: vi.fn(() => {
        const request = {
          result: mockDb,
          transaction: null as IDBTransaction | null,
          onupgradeneeded: null as EventHandler,
          onsuccess: null as EventHandler,
          onerror: null as EventHandler,
          error: null as DOMException | null,
        };
        queueMicrotask(() => request.onsuccess?.(new Event('success')));
        return request;
      }),
    } as unknown as IDBFactory;
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    global.indexedDB = originalIndexedDB;
    global.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  it('enqueues a principal-bound request without exposing the principal marker as a command', async () => {
    const id = await enqueueRequest({
      url: '/api/test',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });

    const list = await listQueuedRequests();
    expect(id).toBeTruthy();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id,
      principalId: userA.principalId,
      authGeneration: userA.authGeneration,
      url: '/api/test',
      state: 'PENDING',
    });
    expect(list[0].headers['Idempotency-Key']).toBeTruthy();
    expect(requestStore.get('__opsknight_active_principal__')).toMatchObject({
      kind: 'PRINCIPAL',
      principalId: userA.principalId,
    });
  });

  it('lists and removes only queued request records', async () => {
    const first = await enqueueRequest({ url: '/api/1', method: 'GET' });
    await enqueueRequest({ url: '/api/2', method: 'GET' });

    expect((await listQueuedRequests()).map(item => item.url)).toEqual(['/api/1', '/api/2']);
    await removeQueuedRequest(first);
    expect((await listQueuedRequests()).map(item => item.url)).toEqual(['/api/2']);
  });

  it('destroys another principal generation queue before replay', async () => {
    const id = await enqueueRequest({
      operation: 'INCIDENT_STATUS',
      url: '/api/incidents/inc-a/status',
      method: 'PATCH',
      idempotencyKey: 'a-command',
    });
    expect(requestStore.has(id)).toBe(true);

    setPrincipal(userB);
    await setOfflineQueuePrincipal(userB);

    expect(requestStore.has(id)).toBe(false);
    expect(await listQueuedRequests()).toEqual([]);
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
    expect(queued[0]).toMatchObject({ id, state: 'AUTH_REQUIRED', idempotencyKey: 'ack-inc-1' });

    expect(await resumeAuthRequiredOperations()).toBe(1);
    queued = await listQueuedRequests();
    expect(queued[0]).toMatchObject({
      state: 'PENDING',
      idempotencyKey: 'ack-inc-1',
      expectedState: 'OPEN',
    });

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

  it('keeps ACK then RESOLVE ordered inside one incident lane during 429 backoff', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      response(429, { error: 'Rate limited' }, new Headers({ 'retry-after': '30' }))
    );

    await flushQueuedRequests();
    await flushQueuedRequests();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('PENDING');
    expect(queue[0].nextAttemptAt).toBeGreaterThan(Date.now());
    expect(queue[1]).toMatchObject({ state: 'PENDING', retryCount: 0 });
  });

  it('keeps ACK then RESOLVE ordered inside one incident lane after ambiguous transport loss', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('radio changed network'));

    await flushQueuedRequests();
    await flushQueuedRequests();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('PENDING');
    expect(queue[0].nextAttemptAt).toBeGreaterThan(Date.now());
    expect(queue[1]).toMatchObject({ state: 'PENDING', retryCount: 0 });
  });

  it('blocks dependent RESOLVE when its ACK requires authentication', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockResolvedValueOnce(response(401, { error: 'Sign in required' }));

    await flushQueuedRequests();
    await flushQueuedRequests();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('AUTH_REQUIRED');
    expect(queue[1]).toMatchObject({ state: 'PENDING', retryCount: 0 });
  });

  it('blocks dependent RESOLVE when its ACK conflicts with newer incident state', async () => {
    await enqueueAckThenResolve();
    vi.mocked(global.fetch).mockResolvedValueOnce(response(409, { error: 'Incident changed' }));

    await flushQueuedRequests();
    await flushQueuedRequests();

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    const queue = await listQueuedRequests();
    expect(queue[0].state).toBe('CONFLICT');
    expect(queue[1]).toMatchObject({ state: 'PENDING', retryCount: 0 });
  });

  it('allows an unrelated incident lane to progress while another incident backs off', async () => {
    await enqueueRequest({
      operation: 'INCIDENT_STATUS',
      url: '/api/incidents/incident-a/status',
      method: 'PATCH',
      idempotencyKey: 'ack-a',
    });
    await enqueueRequest({
      operation: 'INCIDENT_STATUS',
      url: '/api/incidents/incident-b/status',
      method: 'PATCH',
      idempotencyKey: 'ack-b',
    });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        response(429, { error: 'Rate limited' }, new Headers({ 'retry-after': '30' }))
      )
      .mockResolvedValueOnce(response(200));

    await flushQueuedRequests();

    const queue = await listQueuedRequests();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);
    expect(queue.find(item => item.idempotencyKey === 'ack-a')?.state).toBe('PENDING');
    expect(queue.find(item => item.idempotencyKey === 'ack-b')?.state).toBe('SUCCEEDED');
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

  it('recovers gracefully from request timeout abort without crashing or losing queue items', async () => {
    const id = await enqueueRequest({
      operation: 'INCIDENT_STATUS',
      url: '/api/incidents/inc-timeout/status',
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
      idempotencyKey: 'ack-timeout',
    });
    vi.mocked(global.fetch).mockRejectedValueOnce(
      new DOMException('The user aborted a request.', 'AbortError')
    );

    await flushQueuedRequests();
    const queue = await listQueuedRequests();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id,
      state: 'PENDING',
      retryCount: 1,
    });
    expect(queue[0].lastError).toMatch(/aborted|Network unavailable/i);
  });

  it('handles never-settling network fetch via timeout abort and preserves item in PENDING state', async () => {
    vi.useFakeTimers();
    const id = await enqueueRequest({
      operation: 'INCIDENT_STATUS',
      url: '/api/incidents/inc-hang/status',
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
      idempotencyKey: 'ack-hang',
    });

    vi.mocked(global.fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
        }
      });
    });

    const flushPromise = flushQueuedRequests();
    await vi.advanceTimersByTimeAsync(15_000);
    await flushPromise;

    const queue = await listQueuedRequests();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id,
      state: 'PENDING',
      retryCount: 1,
    });
    vi.useRealTimers();
  });
});
