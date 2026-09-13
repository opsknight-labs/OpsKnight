// OpsKnight PWA service-worker extensions.
// Loaded by the generated Workbox service worker via importScripts.

const OFFLINE_DB = 'opsknight-offline';
const OFFLINE_STORE = 'request-queue';
const OFFLINE_DB_VERSION = 2;
const PUSH_CONTRACT_VERSION = 2;
const SUPPORTED_PUSH_CONTRACT_VERSIONS = new Set([1, 2]);
const SENDING_LEASE_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const randomId = () => {
  if (self.crypto && typeof self.crypto.randomUUID === 'function') return self.crypto.randomUUID();
  return `sw_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const openOfflineDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(OFFLINE_STORE)
        ? request.transaction.objectStore(OFFLINE_STORE)
        : db.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('createdAt')) {
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!store.indexNames.contains('state')) {
        store.createIndex('state', 'state', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestResult = request =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const normalizeQueuedRequest = value => {
  const now = Date.now();
  const headers = value.headers || {};
  const idempotencyKey =
    value.idempotencyKey || headers['Idempotency-Key'] || headers['idempotency-key'] || value.id;
  return {
    id: value.id,
    operation: value.operation || 'GENERIC',
    url: value.url,
    method: value.method,
    headers: { ...headers, 'Idempotency-Key': idempotencyKey },
    body: value.body || null,
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || value.createdAt || now,
    idempotencyKey,
    state: value.state || 'PENDING',
    retryCount: value.retryCount || 0,
    lastAttemptAt: value.lastAttemptAt || null,
    nextAttemptAt: value.nextAttemptAt || null,
    lastError: value.lastError || null,
    expectedState: value.expectedState || null,
    completedAt: value.completedAt || null,
  };
};

const listQueuedRequests = async () => {
  const db = await openOfflineDb();
  try {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const values = await requestResult(tx.objectStore(OFFLINE_STORE).getAll());
    return values.map(normalizeQueuedRequest).sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
};

const putQueuedRequest = async item => {
  const db = await openOfflineDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

const broadcast = async (type, payload = {}) => {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type, ...payload });
};

const responseError = async response => {
  try {
    const payload = await response.clone().json();
    if (payload && typeof payload.error === 'string') return payload.error;
  } catch {}
  return `HTTP ${response.status}`;
};

const terminalStateForStatus = status => {
  if (status === 401 || status === 403) return 'AUTH_REQUIRED';
  if (status === 409) return 'CONFLICT';
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'FAILED';
  return null;
};

const updateQueueState = async (item, patch) => {
  const next = { ...item, ...patch, updatedAt: Date.now() };
  await putQueuedRequest(next);
  await broadcast('OFFLINE_QUEUE_CHANGED', { id: item.id, state: next.state });
  return next;
};

const retryAfterMs = response => {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

const exponentialBackoffMs = retryCount => {
  const exponent = Math.max(0, Math.min(retryCount - 1, 8));
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** exponent);
};

const recoverInterruptedRequests = async now => {
  const items = await listQueuedRequests();
  for (const item of items) {
    if (
      item.state === 'SENDING' &&
      (item.lastAttemptAt == null || now - item.lastAttemptAt >= SENDING_LEASE_MS)
    ) {
      await updateQueueState(item, {
        state: 'PENDING',
        nextAttemptAt: now,
        lastError: item.lastError || 'Previous sync was interrupted; retrying safely.',
      });
    }
  }
};

const flushQueuedRequests = async () => {
  try {
    const now = Date.now();
    await recoverInterruptedRequests(now);
    const queue = (await listQueuedRequests()).filter(
      item => item.state === 'PENDING' && (item.nextAttemptAt == null || item.nextAttemptAt <= now)
    );

    for (const original of queue) {
      const sending = await updateQueueState(original, {
        state: 'SENDING',
        retryCount: original.retryCount + 1,
        lastAttemptAt: Date.now(),
        nextAttemptAt: null,
        lastError: null,
      });

      try {
        const response = await fetch(sending.url, {
          method: sending.method,
          headers: sending.headers,
          body: sending.body || undefined,
          credentials: 'include',
          cache: 'no-store',
        });

        if (response.ok) {
          await updateQueueState(sending, {
            state: 'SUCCEEDED',
            completedAt: Date.now(),
            nextAttemptAt: null,
            lastError: null,
          });
          continue;
        }

        const error = await responseError(response);
        const terminal = terminalStateForStatus(response.status);
        if (terminal) {
          await updateQueueState(sending, {
            state: terminal,
            completedAt: terminal === 'FAILED' ? Date.now() : null,
            nextAttemptAt: null,
            lastError: error,
          });
          // Preserve FIFO semantics; later state transitions may depend on this one.
          break;
        }

        const delay =
          response.status === 429
            ? retryAfterMs(response) ?? exponentialBackoffMs(sending.retryCount)
            : exponentialBackoffMs(sending.retryCount);
        await updateQueueState(sending, {
          state: 'PENDING',
          nextAttemptAt: Date.now() + delay,
          lastError: error,
        });
        break;
      } catch (error) {
        await updateQueueState(sending, {
          state: 'PENDING',
          nextAttemptAt: Date.now() + exponentialBackoffMs(sending.retryCount),
          lastError: error instanceof Error ? error.message : 'Network unavailable',
        });
        break;
      }
    }
  } catch (error) {
    console.warn('[Service Worker] Offline queue flush failed', error);
  }
};

const safeAppPath = (candidate, fallback = '/m/notifications') => {
  try {
    const parsed = new URL(candidate || fallback, self.location.origin);
    if (parsed.origin !== self.location.origin) return fallback;
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
};

const parseActions = raw => {
  if (Array.isArray(raw)) return raw.slice(0, 2);
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 2) : undefined;
  } catch {
    return undefined;
  }
};

const normalizePushPayload = raw => {
  const data = raw && typeof raw === 'object' ? raw : {};
  const nested = data.data && typeof data.data === 'object' ? data.data : {};
  const incidentId = data.incidentId || nested.incidentId || null;
  const versionCandidate = Number(data.version || nested.version || 1);
  const version = Number.isFinite(versionCandidate) ? versionCandidate : 1;
  const supportedVersion = SUPPORTED_PUSH_CONTRACT_VERSIONS.has(version);
  const fallbackUrl = incidentId ? `/incidents/${encodeURIComponent(incidentId)}` : '/m/notifications';
  return {
    version,
    supportedVersion,
    eventId: data.eventId || nested.eventId || null,
    deliveryId: data.deliveryId || nested.deliveryId || null,
    eventType: data.eventType || nested.eventType || null,
    incidentId,
    status: data.status || nested.status || null,
    urgency: data.urgency || nested.urgency || null,
    title: typeof data.title === 'string' ? data.title : 'OpsKnight',
    body: typeof data.body === 'string' ? data.body : 'New notification',
    icon: data.icon || '/icons/app-icon-192.png',
    badge: data.badge || nested.badge || '/icons/app-icon-192.png',
    url: safeAppPath(data.url || nested.url, fallbackUrl),
    // Unknown future payload versions are display-only. Never execute an action
    // whose semantics this worker does not understand.
    actions: supportedVersion ? parseActions(data.actions || nested.actions) : undefined,
    tag:
      data.tag ||
      nested.tag ||
      (incidentId ? `incident-${incidentId}` : `opsknight-notification-${Date.now()}`),
  };
};

const focusOrOpen = async path => {
  const safePath = safeAppPath(path, '/m');
  const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windowClients) {
    if (!client.url.startsWith(self.location.origin)) continue;
    if ('focus' in client) await client.focus();
    if ('navigate' in client) return client.navigate(safePath);
    return client;
  }
  if (clients.openWindow) return clients.openWindow(safePath);
  return undefined;
};

const showFeedback = (title, body, incidentId, suffix) =>
  self.registration.showNotification(title, {
    body,
    icon: '/icons/app-icon-192.png',
    badge: '/icons/app-icon-192.png',
    tag: `incident-${incidentId}-${suffix}`,
    requireInteraction: false,
    data: { incidentId, url: `/incidents/${encodeURIComponent(incidentId)}` },
  });

const queueAcknowledgement = async ({ incidentId, expectedStatus, idempotencyKey }) => {
  const id = randomId();
  const now = Date.now();
  const url = new URL(
    `/api/incidents/${encodeURIComponent(incidentId)}/status`,
    self.location.origin
  ).toString();
  await putQueuedRequest({
    id,
    operation: 'INCIDENT_STATUS',
    url,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      status: 'ACKNOWLEDGED',
      ...(expectedStatus ? { expectedStatus } : {}),
    }),
    createdAt: now,
    updatedAt: now,
    idempotencyKey,
    state: 'PENDING',
    retryCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: 'Waiting for network',
    expectedState: expectedStatus || null,
    completedAt: null,
  });
  await broadcast('OFFLINE_QUEUE_CHANGED', { id, state: 'PENDING' });
};

const handleAcknowledgeAction = async notification => {
  const data = notification.data || {};
  const incidentId = data.incidentId;
  if (!incidentId) return focusOrOpen(data.url || '/m/notifications');

  if (!SUPPORTED_PUSH_CONTRACT_VERSIONS.has(Number(data.version || 1))) {
    await showFeedback(
      'OpsKnight update required',
      'Open the incident to use responder actions from this notification.',
      incidentId,
      'version'
    );
    return focusOrOpen(`/incidents/${encodeURIComponent(incidentId)}`);
  }

  const incidentPath = `/incidents/${encodeURIComponent(incidentId)}`;
  const expectedStatus = data.status === 'OPEN' ? 'OPEN' : undefined;
  const stableSeed = data.deliveryId || data.eventId || notification.tag || randomId();
  const idempotencyKey = `push-ack:${incidentId}:${String(stableSeed).slice(0, 120)}`;

  try {
    const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        status: 'ACKNOWLEDGED',
        ...(expectedStatus ? { expectedStatus } : {}),
      }),
      credentials: 'include',
      cache: 'no-store',
    });

    if (response.ok) {
      await showFeedback(
        'Incident acknowledged',
        `Incident #${incidentId} is acknowledged.`,
        incidentId,
        'ack'
      );
      return;
    }

    if (response.status === 401) {
      await showFeedback(
        'Sign in required',
        'Open OpsKnight to authenticate before acknowledging.',
        incidentId,
        'auth'
      );
      return focusOrOpen(`/login?callbackUrl=${encodeURIComponent(incidentPath)}`);
    }
    if (response.status === 403) {
      await showFeedback(
        'Acknowledgement not authorized',
        'Your account cannot acknowledge this incident.',
        incidentId,
        'forbidden'
      );
      return focusOrOpen(incidentPath);
    }
    if (response.status === 409) {
      await showFeedback(
        'Incident changed',
        'Another responder changed this incident. Open it for the latest state.',
        incidentId,
        'conflict'
      );
      return focusOrOpen(incidentPath);
    }
    if (response.status === 429 || response.status >= 500) {
      await showFeedback(
        'Acknowledgement not confirmed',
        'OpsKnight could not confirm the action. Open the incident and retry.',
        incidentId,
        'retry'
      );
      return focusOrOpen(incidentPath);
    }

    await showFeedback(
      'Acknowledgement failed',
      'The incident was not acknowledged. Open it for details.',
      incidentId,
      'failed'
    );
    return focusOrOpen(incidentPath);
  } catch {
    try {
      await queueAcknowledgement({ incidentId, expectedStatus, idempotencyKey });
      await showFeedback(
        'Acknowledgement queued',
        'Offline: the action is queued and is not confirmed yet.',
        incidentId,
        'queued'
      );
    } catch {
      await showFeedback(
        'Acknowledgement not saved',
        'Offline storage was unavailable. Open OpsKnight and retry.',
        incidentId,
        'queue-failed'
      );
    }
  }
};

self.addEventListener('push', event => {
  let raw = {};
  if (event.data) {
    try {
      raw = event.data.json();
    } catch {
      raw = {};
    }
  }
  const payload = normalizePushPayload(raw);
  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    data: {
      version: payload.version,
      eventId: payload.eventId,
      deliveryId: payload.deliveryId,
      eventType: payload.eventType,
      incidentId: payload.incidentId,
      status: payload.status,
      urgency: payload.urgency,
      url: payload.url,
    },
    tag: payload.tag,
    requireInteraction: payload.urgency === 'HIGH',
    vibrate: payload.urgency === 'HIGH' ? [200, 100, 200] : [120],
  };
  if (payload.actions && payload.actions.length > 0) options.actions = payload.actions;
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'acknowledge') {
    event.waitUntil(handleAcknowledgeAction(event.notification));
    return;
  }
  event.waitUntil(focusOrOpen(event.notification.data?.url || '/m/notifications'));
});

// Do not force activation during an in-progress responder workflow. The app UI
// explicitly sends SKIP_WAITING when the user accepts an available update.
self.addEventListener('install', () => {});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const dynamicCachePatterns = [
        'pages',
        'pages-rsc',
        'pages-rsc-prefetch',
        'start-url',
        'apis',
        'static-data-assets',
        'cross-origin',
      ];
      try {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(name =>
            dynamicCachePatterns.some(pattern => name.includes(pattern))
              ? caches.delete(name)
              : Promise.resolve(false)
          )
        );
      } catch (error) {
        console.warn('[Service Worker] Failed to purge legacy dynamic caches', error);
      }
      await self.clients.claim();
      await broadcast('PWA_SERVICE_WORKER_ACTIVATED');
    })()
  );
});

self.addEventListener('sync', event => {
  if (event.tag === 'opsknight-sync') event.waitUntil(flushQueuedRequests());
});

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data.type === 'SYNC_OFFLINE_QUEUE') {
    event.waitUntil(flushQueuedRequests());
    return;
  }
  if (event.data.type === 'PURGE_AUTH_CACHES') {
    event.waitUntil(
      (async () => {
        try {
          const names = await caches.keys();
          await Promise.all(
            names
              .filter(name => /page|start-url|api|rsc/i.test(name))
              .map(name => caches.delete(name))
          );
        } catch (error) {
          console.warn('[Service Worker] Failed to purge auth caches', error);
        }
      })()
    );
  }
});
