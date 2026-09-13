'use client';

import {
  deriveOfflineLaneKey,
  readMobilePrincipalContext,
  type MobilePrincipalContext,
} from '@/lib/mobile-principal';

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
  kind: 'REQUEST';
  principalId: string;
  authGeneration: string;
  laneKey: string;
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
  leaseOwner?: string | null;
  leaseUntil?: number | null;
};

type PrincipalMarker = {
  id: '__opsknight_active_principal__';
  kind: 'PRINCIPAL';
  principalId: string;
  authGeneration: string;
  updatedAt: number;
};

export type EnqueueRequestInput = {
  operation?: OfflineOperation;
  laneKey?: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  idempotencyKey?: string;
  expectedState?: string | null;
};

export const OFFLINE_QUEUE_DB_NAME = 'opsknight-offline';
const STORE_NAME = 'request-queue';
const DB_VERSION = 3;
const MARKER_ID = '__opsknight_active_principal__';
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const SENDING_LEASE_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_PARALLEL_LANES = 4;
const MAX_OPERATIONS_PER_FLUSH = 32;
const TERMINAL_STATES = new Set<OfflineQueueState>(['SUCCEEDED', 'FAILED', 'FORBIDDEN']);
const EXECUTOR_ID = `window:${generateId()}`;

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

function generateId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeStoredRequest(
  value: Partial<QueuedRequest> & { id: string; url: string; method: string }
): QueuedRequest {
  const now = Date.now();
  const headers = value.headers ?? {};
  const principalId = value.principalId ?? '';
  const authGeneration = value.authGeneration ?? '';
  const operation = value.operation ?? 'GENERIC';
  const idempotencyKey =
    value.idempotencyKey || headers['Idempotency-Key'] || headers['idempotency-key'] || value.id;
  return {
    id: value.id,
    kind: 'REQUEST',
    principalId,
    authGeneration,
    laneKey: value.laneKey ?? deriveOfflineLaneKey(operation, value.url, principalId),
    operation,
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
    leaseOwner: value.leaseOwner ?? null,
    leaseUntil: value.leaseUntil ?? null,
  };
}

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) return reject(new Error('IndexedDB not available'));
    const request = indexedDB.open(OFFLINE_QUEUE_DB_NAME, DB_VERSION);
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
      if (store && !store.indexNames.contains('laneKey')) {
        store.createIndex('laneKey', 'laneKey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function putQueuedRequest(item: QueuedRequest) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function setOfflineQueuePrincipal(context: MobilePrincipalContext): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const read = store.getAll();
      read.onsuccess = () => {
        for (const raw of read.result as Array<
          Omit<Partial<QueuedRequest>, 'kind'> & { id?: string; kind?: string }
        >) {
          if (!raw.id || raw.id === MARKER_ID || raw.kind === 'PRINCIPAL') continue;
          if (
            raw.principalId !== context.principalId ||
            raw.authGeneration !== context.authGeneration
          ) {
            store.delete(raw.id);
          }
        }
        const marker: PrincipalMarker = {
          id: MARKER_ID,
          kind: 'PRINCIPAL',
          principalId: context.principalId,
          authGeneration: context.authGeneration,
          updatedAt: Date.now(),
        };
        store.put(marker);
      };
      read.onerror = () => tx.abort();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const enqueueRequest = async (request: EnqueueRequestInput) => {
  if (!hasIndexedDb()) return '';
  const principal = readMobilePrincipalContext();
  if (!principal) return '';
  await setOfflineQueuePrincipal(principal);

  const id = generateId();
  const idempotencyKey = request.idempotencyKey?.trim() || id;
  const operation = request.operation ?? 'GENERIC';
  const now = Date.now();
  const payload: QueuedRequest = {
    id,
    kind: 'REQUEST',
    principalId: principal.principalId,
    authGeneration: principal.authGeneration,
    laneKey:
      request.laneKey ?? deriveOfflineLaneKey(operation, request.url, principal.principalId),
    operation,
    url: request.url,
    method: request.method,
    headers: { ...request.headers, 'Idempotency-Key': idempotencyKey },
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
    leaseOwner: null,
    leaseUntil: null,
  };
  await putQueuedRequest(payload);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('opsknight:offline-queue-changed'));
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const syncRegistration = registration as ServiceWorkerRegistration & {
          sync?: { register(tag: string): Promise<void> };
        };
        await syncRegistration.sync?.register('opsknight-sync');
      }
    } catch {
      // Background Sync is enhancement-only; foreground replay remains authoritative.
    }
  }
  return payload.id;
};

export const listQueuedRequests = async (): Promise<QueuedRequest[]> => {
  if (!hasIndexedDb()) return [];
  const principal = readMobilePrincipalContext();
  if (!principal) return [];
  const db = await openDb();
  try {
    const raw = await requestToPromise(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    );
    return (raw as Array<Record<string, unknown>>)
      .filter(value => value.id !== MARKER_ID && value.kind !== 'PRINCIPAL')
      .map(value =>
        normalizeStoredRequest(
          value as Partial<QueuedRequest> & { id: string; url: string; method: string }
        )
      )
      .filter(
        item =>
          item.principalId === principal.principalId &&
          item.authGeneration === principal.authGeneration
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
};

export const removeQueuedRequest = async (id: string) => {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
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

export const resumeAuthRequiredOperations = async () => {
  if (!hasIndexedDb()) return 0;
  const principal = readMobilePrincipalContext();
  if (!principal) return 0;
  const now = Date.now();
  const items = (await listQueuedRequests()).filter(item => item.state === 'AUTH_REQUIRED');
  let resumed = 0;
  for (const item of items) {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const read = store.get(item.id);
        read.onsuccess = () => {
          const current = read.result as QueuedRequest | undefined;
          if (
            current?.state === 'AUTH_REQUIRED' &&
            current.principalId === principal.principalId &&
            current.authGeneration === principal.authGeneration
          ) {
            store.put({
              ...normalizeStoredRequest(current),
              state: 'PENDING',
              updatedAt: now,
              nextAttemptAt: now,
              completedAt: null,
              leaseOwner: null,
              leaseUntil: null,
              lastError: 'Authentication restored; queued for safe replay.',
            });
            resumed += 1;
          }
        };
        read.onerror = () => tx.abort();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  if (resumed > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('opsknight:offline-queue-changed'));
  }
  return resumed;
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

function firstPerLane(items: QueuedRequest[]) {
  const lanes = new Map<string, QueuedRequest>();
  for (const item of items) {
    if (TERMINAL_STATES.has(item.state)) continue;
    if (!lanes.has(item.laneKey)) lanes.set(item.laneKey, item);
  }
  return [...lanes.values()].sort((a, b) => a.createdAt - b.createdAt);
}

async function claimRequest(
  candidate: QueuedRequest,
  principal: MobilePrincipalContext,
  now: number
): Promise<QueuedRequest | null> {
  const db = await openDb();
  try {
    return await new Promise<QueuedRequest | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const read = store.get(candidate.id);
      let claimed: QueuedRequest | null = null;
      read.onsuccess = () => {
        const raw = read.result as QueuedRequest | undefined;
        if (!raw) return;
        const current = normalizeStoredRequest(raw);
        if (
          current.principalId !== principal.principalId ||
          current.authGeneration !== principal.authGeneration
        )
          return;
        const staleLease = current.state === 'SENDING' && (current.leaseUntil ?? 0) <= now;
        const pendingAndDue =
          current.state === 'PENDING' &&
          (current.nextAttemptAt == null || current.nextAttemptAt <= now);
        if (!pendingAndDue && !staleLease) return;
        claimed = {
          ...current,
          state: 'SENDING',
          retryCount: current.retryCount + 1,
          lastAttemptAt: now,
          nextAttemptAt: null,
          lastError: staleLease ? 'Recovered expired replay lease.' : null,
          leaseOwner: EXECUTOR_ID,
          leaseUntil: now + SENDING_LEASE_MS,
          updatedAt: now,
        };
        store.put(claimed);
      };
      read.onerror = () => tx.abort();
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function transitionClaimed(item: QueuedRequest, patch: Partial<QueuedRequest>) {
  const db = await openDb();
  let changed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const read = store.get(item.id);
      read.onsuccess = () => {
        const current = read.result as QueuedRequest | undefined;
        if (!current || current.leaseOwner !== EXECUTOR_ID) return;
        store.put({
          ...normalizeStoredRequest(current),
          ...patch,
          updatedAt: Date.now(),
          leaseOwner: null,
          leaseUntil: null,
        });
        changed = true;
      };
      read.onerror = () => tx.abort();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('opsknight:offline-queue-changed'));
  }
}

async function processClaimed(item: QueuedRequest) {
  try {
    const response = await fetch(item.url, {
      method: item.method,
      headers: item.headers,
      body: item.body ?? undefined,
      credentials: 'include',
      cache: 'no-store',
    });
    if (response.ok) {
      await transitionClaimed(item, {
        state: 'SUCCEEDED',
        completedAt: Date.now(),
        nextAttemptAt: null,
        lastError: null,
      });
      return true;
    }

    const error = await responseError(response);
    const nextState = stateForStatus(response.status);
    if (nextState) {
      await transitionClaimed(item, {
        state: nextState,
        completedAt: TERMINAL_STATES.has(nextState) ? Date.now() : null,
        nextAttemptAt: null,
        lastError: error,
      });
      return true;
    }

    const delay =
      response.status === 429
        ? retryAfterMs(response) ?? exponentialBackoffMs(item.retryCount)
        : exponentialBackoffMs(item.retryCount);
    await transitionClaimed(item, {
      state: 'PENDING',
      nextAttemptAt: Date.now() + delay,
      lastError: error,
    });
    return false;
  } catch (error) {
    await transitionClaimed(item, {
      state: 'PENDING',
      nextAttemptAt: Date.now() + exponentialBackoffMs(item.retryCount),
      lastError: error instanceof Error ? error.message : 'Network unavailable',
    });
    return false;
  }
}

function remainingNonTerminal(items: QueuedRequest[]) {
  return items.filter(item => !TERMINAL_STATES.has(item.state)).length;
}

export const flushQueuedRequests = async () => {
  if (!hasIndexedDb()) return { flushed: 0, remaining: 0 };
  const principal = readMobilePrincipalContext();
  if (!principal) return { flushed: 0, remaining: 0 };
  if (typeof window !== 'undefined' && !navigator.onLine) {
    return { flushed: 0, remaining: remainingNonTerminal(await listQueuedRequests()) };
  }

  await setOfflineQueuePrincipal(principal);
  await cleanupTerminalRequests();
  let flushed = 0;
  let processed = 0;

  while (processed < MAX_OPERATIONS_PER_FLUSH) {
    const queue = await listQueuedRequests();
    const now = Date.now();
    const candidates = firstPerLane(queue).filter(item => {
      if (item.state === 'AUTH_REQUIRED' || item.state === 'CONFLICT') return false;
      if (item.state === 'SENDING') return (item.leaseUntil ?? 0) <= now;
      return (
        item.state === 'PENDING' &&
        (item.nextAttemptAt == null || item.nextAttemptAt <= now)
      );
    });
    if (candidates.length === 0) break;

    const claimed = (
      await Promise.all(
        candidates
          .slice(0, MAX_PARALLEL_LANES)
          .map(candidate => claimRequest(candidate, principal, now))
      )
    ).filter((item): item is QueuedRequest => Boolean(item));
    if (claimed.length === 0) break;

    const results = await Promise.all(claimed.map(item => processClaimed(item)));
    flushed += results.filter(Boolean).length;
    processed += claimed.length;
  }

  return { flushed, remaining: remainingNonTerminal(await listQueuedRequests()) };
};

export async function purgeOfflineQueueStorage(): Promise<void> {
  if (!hasIndexedDb()) return;
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(OFFLINE_QUEUE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
