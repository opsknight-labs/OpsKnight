'use client';

export type OfflineQueueState =
  | 'PENDING'
  | 'SENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'FORBIDDEN'
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
  nextAttemptAt?: number | null;
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
const SENDING_LEASE_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const TERMINAL_STATES = new Set<OfflineQueueState>(['SUCCEEDED', 'FAILED', 'FORBIDDEN']);
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
    nextAttemptAt: value.nextAttemptAt ?? null,
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
    nextAttemptAt: null,
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
      TERMINAL_STATES.has(item.state)
  );
  await Promise.all(expired.map(item => removeQueuedRequest(item.id)));
}

async function recoverInterruptedRequests(now = Date.now()) {
  const items = await listQueuedRequests();
  const stranded = items.filter(
    item =>
      item.state === 'SENDING' &&
      (item.lastAttemptAt == null || now - item.lastAttemptAt >= SENDING_LEASE_MS)
  );

  for (const item of stranded) {
    await putQueuedRequest({
      ...item,
      state: 'PENDING',
      updatedAt: now,
      nextAttemptAt: now,
      lastError: item.lastError || 'Previous sync was interrupted; retrying safely.',
    });
  }
}

/**
 * Auth failures are deliberately parked instead of retried. Once an authenticated
 * mobile shell has been re-established, only those parked operations are made
 * eligible for the normal FIFO/idempotent replay loop again. Conflict, FORBIDDEN,
 * and FAILED records are never revived here.
 */
export const resumeAuthRequiredOperations = async () => {
  if (!hasIndexedDb()) return 0;

  const now = Date.now();
  const items = await listQueuedRequests();
  const resumable = items.filter(item => item.state === 'AUTH_REQUIRED');

  for (const item of resumable) {
    await putQueuedRequest({
      ...item,
      state: 'PENDING',
      updatedAt: now,
      nextAttemptAt: now,
      completedAt: null,
      lastError: 'Authentication restored; queued for safe replay.',
    });
  }

  if (resumable.length > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('opsknight:offline-queue-changed'));
  }

  return resumable.length;
};

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function exponentialBackoffMs(retryCount: number) {
  const exponent = Math.max(0, Math.min(retryCount - 1, 8));
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** exponent);
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

function stateForStatus(status: number): OfflineQueueState | null {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
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

function remainingNonTerminal(items: QueuedRequest[]) {
  return items.filter(item => !TERMINAL_STATES.has(item.state)).length;
}

export const flushQueuedRequests = async () => {
  if (!hasIndexedDb()) return { flushed: 0, remaining: 0 };
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const queue = await listQueuedRequests();
    return { flushed: 0, remaining: remainingNonTerminal(queue) };
  }

  const now = Date.now();
  await cleanupTerminalRequests(now);
  await recoverInterruptedRequests(now);
  const queue = await listQueuedRequests();
  let flushed = 0;

  // Strict FIFO invariant: never filter blockers out before evaluating order.
  // The first non-terminal operation owns the queue. If it is backing off,
  // actively sending, waiting for auth, or in conflict, later operations must
  // not leapfrog it (for example RESOLVE must never pass a delayed ACK).
  for (const original of queue) {
    if (TERMINAL_STATES.has(original.state)) continue;
    if (original.state !== 'PENDING') break;
    if (original.nextAttemptAt != null && original.nextAttemptAt > Date.now()) break;

    const sending: QueuedRequest = {
      ...original,
      state: 'SENDING',
      retryCount: original.retryCount + 1,
      lastAttemptAt: Date.now(),
      nextAttemptAt: null,
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
        cache: 'no-store',
      });

      if (response.ok) {
        await transition(sending, {
          state: 'SUCCEEDED',
          completedAt: Date.now(),
          nextAttemptAt: null,
          lastError: null,
        });
        flushed += 1;
        continue;
      }

      const error = await responseError(response);
      const nextState = stateForStatus(response.status);
      if (nextState) {
        const terminal = TERMINAL_STATES.has(nextState);
        await transition(sending, {
          state: nextState,
          completedAt: terminal ? Date.now() : null,
          nextAttemptAt: null,
          lastError: error,
        });
        if (!terminal) break;
        continue;
      }

      const delay =
        response.status === 429
          ? retryAfterMs(response) ?? exponentialBackoffMs(sending.retryCount)
          : exponentialBackoffMs(sending.retryCount);
      await transition(sending, {
        state: 'PENDING',
        nextAttemptAt: Date.now() + delay,
        lastError: error,
      });
      break;
    } catch (error) {
      await transition(sending, {
        state: 'PENDING',
        nextAttemptAt: Date.now() + exponentialBackoffMs(sending.retryCount),
        lastError: error instanceof Error ? error.message : 'Network unavailable',
      });
      break;
    }
  }

  const remainingQueue = await listQueuedRequests();
  return {
    flushed,
    remaining: remainingNonTerminal(remainingQueue),
  };
};
