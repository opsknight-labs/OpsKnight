'use client';

export type OfflineQueueState =
  | 'PENDING'
  | 'SENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CONFLICT'
  | 'AUTH_REQUIRED';

export type OfflineOperation = 'INCIDENT_STATUS' | 'NOTIFICATION_STATE' | 'GENERIC';

export type QueuedRequest = {
  id: string;
  operation: OfflineOperation;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  createdAt: number;
  updatedAt: number;
  idempotencyKey: string;
  state: OfflineQueueState;
  retryCount: number;
  lastAttemptAt?: number | null;
  lastError?: string | null;
  expectedState?: string | null;
  completedAt?: number | null;
};

export type EnqueueRequestInput = {
  operation?: OfflineOperation;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** Reuse the key from an ambiguous online attempt so replay is side-effect safe. */
  idempotencyKey?: string;
  expectedState?: string | null;
};

const DB_NAME = 'opsknight-offline';
const STORE_NAME = 'request-queue';
const DB_VERSION = 2;
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const hasIndexedDb = () => typeof indexedDB !== 'undefined';

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

function normalizeStoredRequest(value: Partial<QueuedRequest> & { id: string; url: string; method: string }) {
  const now = Date.now();
  const headers = value.headers ?? {};
  const idempotencyKey =
    value.idempotencyKey || headers['Idempotency-Key'] || headers['idempotency-key'] || value.id;

  return {
    id: value.id,
    operation: value.operation ?? 'GENERIC',
    url: value.url,
    method: value.method,
    headers: { ...headers, 'Idempotency-Key': idempotencyKey },
    body: value.body ?? null,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? value.createdAt ?? now,
    idempotencyKey,
    state: value.state ?? 'PENDING',
    retryCount: value.retryCount ?? 0,
    lastAttemptAt: value.lastAttemptAt ?? null,
    lastError: value.lastError ?? null,
    expectedState: value.expectedState ?? null,
    completedAt: value.completedAt ?? null,
  } satisfies QueuedRequest;
}

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });

      if (store && !store.indexNames.contains('createdAt')) {
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (store && !store.indexNames.contains('state')) {
        store.createIndex('state', 'state', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T) => {
  if (!hasIndexedDb()) throw new Error('IndexedDB not available');
  const db = await openDb();

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = fn(store);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
};

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function putQueuedRequest(item: QueuedRequest) {
  await withStore('readwrite', store => {
    store.put(item);
  });
}

export const enqueueRequest = async (request: EnqueueRequestInput) => {
  if (!hasIndexedDb()) return '';

  const id = generateId();
  const idempotencyKey = request.idempotencyKey?.trim() || id;
  const now = Date.now();
  const payload: QueuedRequest = {
    id,
    operation: request.operation ?? 'GENERIC',
    url: request.url,
    method: request.method,
    headers: {
      ...request.headers,
      'Idempotency-Key': idempotencyKey,
    },
    body: request.body ?? null,
    createdAt: now,
    updatedAt: now,
    idempotencyKey,
    state: 'PENDING',
    retryCount: 0,
    lastAttemptAt: null,
    lastError: null,
    expectedState: request.expectedState ?? null,
    completedAt: null,
  };

  await putQueuedRequest(payload);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('opsknight:offline-queue-changed'));
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const registration = await navigator.serviceWorker.ready;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (registration as any).sync.register('opsknight-sync');
      }
    } catch {
      // Background Sync is not universally available; foreground/online replay remains authoritative.
    }
  }

  return payload.id;
};

export const listQueuedRequests = async (): Promise<QueuedRequest[]> => {
  if (!hasIndexedDb()) return [];
  const db = await openDb();

  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const raw = (await requestToPromise(store.getAll())) as Array<
      Partial<QueuedRequest> & { id: string; url: string; method: string }
    >;
    return raw.map(normalizeStoredRequest).sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
};

export const removeQueuedRequest = async (id: string) => {
  if (!hasIndexedDb()) return;
  await withStore('readwrite', store => {
    store.delete(id);
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('opsknight:offline-queue-changed'));
  }
};

async function cleanupTerminalRequests(now = Date.now()) {
  const items = await listQueuedRequests();
  const expired = items.filter(
    item =>
      item.completedAt &&
      now - item.completedAt > TERMINAL_RETENTION_MS &&
      ['SUCCEEDED', 'FAILED'].includes(item.state)
  );
  await Promise.all(expired.map(item => removeQueuedRequest(item.id)));
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function responseError(response: Response) {
  try {
    const payload = (await response.clone().json()) as { error?: unknown; code?: unknown };
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    return code ? `${code}: ${message}` : message;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function terminalStateForStatus(status: number): OfflineQueueState | null {
  if (status === 401 || status === 403) return 'AUTH_REQUIRED';
  if (status === 409) return 'CONFLICT';
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'FAILED';
  return null;
}

async function transition(item: QueuedRequest, patch: Partial<QueuedRequest>) {
  await putQueuedRequest({ ...item, ...patch, updatedAt: Date.now() });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('opsknight:offline-queue-changed'));
  }
}

export const flushQueuedRequests = async () => {
  if (!hasIndexedDb()) return { flushed: 0, remaining: 0 };
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const queue = await listQueuedRequests();
    return {
      flushed: 0,
      remaining: queue.filter(item => ['PENDING', 'SENDING'].includes(item.state)).length,
    };
  }

  await cleanupTerminalRequests();
  const queue = (await listQueuedRequests()).filter(item => item.state === 'PENDING');
  let flushed = 0;

  // FIFO is deliberate: responder actions can have state dependencies (ACK -> RESOLVE).
  for (const original of queue) {
    const sending: QueuedRequest = {
      ...original,
      state: 'SENDING',
      retryCount: original.retryCount + 1,
      lastAttemptAt: Date.now(),
      lastError: null,
      updatedAt: Date.now(),
    };
    await putQueuedRequest(sending);

    try {
      const response = await fetch(sending.url, {
        method: sending.method,
        headers: sending.headers,
        body: sending.body ?? undefined,
        credentials: 'include',
      });

      if (response.ok) {
        await transition(sending, {
          state: 'SUCCEEDED',
          completedAt: Date.now(),
          lastError: null,
        });
        flushed += 1;
        continue;
      }

      const error = await responseError(response);
      const terminal = terminalStateForStatus(response.status);
      if (terminal) {
        await transition(sending, {
          state: terminal,
          completedAt: terminal === 'FAILED' ? Date.now() : null,
          lastError: error,
        });
        // Preserve order: a later operation may rely on the state this one failed to establish.
        break;
      }

      await transition(sending, {
        state: 'PENDING',
        lastError:
          response.status === 429 && retryAfterMs(response)
            ? `${error}; retry later`
            : error,
      });
      break;
    } catch (error) {
      await transition(sending, {
        state: 'PENDING',
        lastError: error instanceof Error ? error.message : 'Network unavailable',
      });
      break;
    }
  }

  const remainingQueue = await listQueuedRequests();
  return {
    flushed,
    remaining: remainingQueue.filter(item => ['PENDING', 'SENDING'].includes(item.state)).length,
  };
};
