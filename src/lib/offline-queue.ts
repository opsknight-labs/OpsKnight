'use client';

type QueuedRequest = {
  id: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  createdAt: number;
};

const DB_NAME = 'opsknight-offline';
const STORE_NAME = 'request-queue';
const hasIndexedDb = () => typeof indexedDB !== 'undefined';

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T) => {
  if (!hasIndexedDb()) {
    throw new Error('IndexedDB not available');
  }
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const enqueueRequest = async (request: Omit<QueuedRequest, 'id' | 'createdAt'>) => {
  if (!hasIndexedDb()) {
    return '';
  }
  const id = generateId();
  const headers = {
    ...request.headers,
    'Idempotency-Key': id,
  };
  const payload: QueuedRequest = {
    id,
    createdAt: Date.now(),
    ...request,
    headers,
  };

  await withStore('readwrite', store => {
    store.put(payload);
  });

  if (typeof window !== 'undefined') {
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const registration = await navigator.serviceWorker.ready;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (registration as any).sync.register('opsknight-sync');
      }
    } catch {
      // Background sync not available, rely on manual flush.
    }
  }

  return payload.id;
};

export const listQueuedRequests = async () => {
  if (!hasIndexedDb()) {
    return [];
  }
  const items: QueuedRequest[] = [];
  await withStore('readonly', store => {
    const index = store.index('createdAt');
    const request = index.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        items.push(cursor.value as QueuedRequest);
        cursor.continue();
      }
    };
  });
  return items;
};

export const removeQueuedRequest = async (id: string) => {
  if (!hasIndexedDb()) {
    return;
  }
  await withStore('readwrite', store => {
    store.delete(id);
  });
};

const isRetryableStatus = (status: number) => {
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  return false;
};

export const flushQueuedRequests = async () => {
  if (!hasIndexedDb()) {
    return { flushed: 0, remaining: 0 };
  }
  if (typeof window !== 'undefined' && !navigator.onLine) {
    return { flushed: 0, remaining: (await listQueuedRequests()).length };
  }

  const queue = await listQueuedRequests();
  let flushed = 0;

  // Process sequentially (FIFO) to preserve ordering of dependent actions (e.g. Ack -> Resolve)
  for (const item of queue) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body ?? undefined,
        credentials: 'include',
      });

      if (response.ok) {
        await removeQueuedRequest(item.id);
        flushed += 1;
      } else if (!isRetryableStatus(response.status)) {
        // Permanent failure (e.g., 400 Bad Request, 401 Unauthorized, 404 Not Found), remove it
        await removeQueuedRequest(item.id);
      }
    } catch {
      // Network error, leave in queue
      break;
    }
  }

  return { flushed, remaining: (await listQueuedRequests()).length };
};
