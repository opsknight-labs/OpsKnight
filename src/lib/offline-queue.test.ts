import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueRequest,
  listQueuedRequests,
  removeQueuedRequest,
  flushQueuedRequests,
} from './offline-queue';

// Manual Mock of IndexedDB
const requestStore = new Map<string, any>();

const mockStore = {
  put: vi.fn(item => {
    requestStore.set(item.id, item);
    const req = { onsuccess: null as any };
    queueMicrotask(() => {
      req.onsuccess && req.onsuccess({} as any);
      mockTransaction.oncomplete && mockTransaction.oncomplete({} as any);
    });
    return req;
  }),
  delete: vi.fn(id => {
    requestStore.delete(id);
    const req = { onsuccess: null as any };
    queueMicrotask(() => {
      req.onsuccess && req.onsuccess({} as any);
      mockTransaction.oncomplete && mockTransaction.oncomplete({} as any);
    });
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
};

const mockTransaction = {
  objectStore: vi.fn(() => mockStore),
  oncomplete: null as any,
  onerror: null as any,
  abort: vi.fn(),
};

const mockDb = {
  transaction: vi.fn(() => {
    return mockTransaction;
  }),
  createObjectStore: vi.fn(() => mockStore),
  objectStoreNames: { contains: vi.fn(() => true) },
};

const mockOpenRequest = {
  result: mockDb,
  onupgradeneeded: null as any,
  onsuccess: null as any,
  onerror: null as any,
};

// Mock global indexedDB
const originalIndexedDB = global.indexedDB;

describe('offline-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestStore.clear();

    global.indexedDB = {
      open: vi.fn(() => {
        setTimeout(() => mockOpenRequest.onsuccess && mockOpenRequest.onsuccess({} as any), 0);
        return mockOpenRequest;
      }),
    } as any;

    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    // Restore if we messed with globals
    // global.indexedDB = originalIndexedDB;
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
  });

  it('should list queued requests', async () => {
    await enqueueRequest({ url: '/api/1', method: 'GET' });
    await enqueueRequest({ url: '/api/2', method: 'GET' });

    // Wait for async db ops
    await new Promise(resolve => setTimeout(resolve, 50));

    const list = await listQueuedRequests();
    expect(list).toHaveLength(2);
    expect(list[0].url).toBe('/api/1');
    expect(list[1].url).toBe('/api/2');
  });

  it('should remove a queued request', async () => {
    const id = await enqueueRequest({ url: '/api/1', method: 'GET' });
    await new Promise(resolve => setTimeout(resolve, 20));

    await removeQueuedRequest(id);
    await new Promise(resolve => setTimeout(resolve, 20));

    const list = await listQueuedRequests();
    expect(list).toHaveLength(0);
  });
});
