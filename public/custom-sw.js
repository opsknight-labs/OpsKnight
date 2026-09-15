// OpsKnight PWA service-worker extensions.
// Loaded by the generated Workbox service worker via importScripts.

const OFFLINE_DB = 'opsknight-offline';
const OFFLINE_STORE = 'request-queue';
const OFFLINE_DB_VERSION = 3;
const ACTIVE_PRINCIPAL_ID = '__opsknight_active_principal__';
const SECURE_CACHE_KEY_DB = 'opsknight-secure-cache';
const SUPPORTED_PUSH_CONTRACT_VERSIONS = new Set([1, 2]);
const SENDING_LEASE_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_PARALLEL_LANES = 4;
const MAX_OPERATIONS_PER_FLUSH = 32;
const TERMINAL_QUEUE_STATES = new Set(['SUCCEEDED', 'FAILED', 'FORBIDDEN']);
const EXECUTOR_ID = `sw:${randomId()}`;

function randomId() {
  if (self.crypto && typeof self.crypto.randomUUID === 'function') return self.crypto.randomUUID();
  return `sw_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const openOfflineDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(OFFLINE_STORE)
        ? request.transaction.objectStore(OFFLINE_STORE)
        : db.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt');
      if (!store.indexNames.contains('state')) store.createIndex('state', 'state');
      if (!store.indexNames.contains('laneKey')) store.createIndex('laneKey', 'laneKey');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestResult = request =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const deriveLaneKey = (operation, url, principalId) => {
  try {
    const parsed = new URL(url, self.location.origin);
    const match = parsed.pathname.match(/\/api\/(?:mobile\/)?incidents\/([^/]+)\/status$/);
    if (operation === 'INCIDENT_STATUS' && match?.[1]) {
      return `incident:${decodeURIComponent(match[1])}`;
    }
    if (operation === 'NOTIFICATION_STATE') return `notifications:${principalId}`;
    return `request:${parsed.pathname}`;
  } catch {
    return `request:${operation}:${principalId}`;
  }
};

const normalizeQueuedRequest = value => {
  const now = Date.now();
  const headers = value.headers || {};
  const operation = value.operation || 'GENERIC';
  const principalId = value.principalId || '';
  const idempotencyKey =
    value.idempotencyKey || headers['Idempotency-Key'] || headers['idempotency-key'] || value.id;
  return {
    id: value.id,
    kind: 'REQUEST',
    principalId,
    authGeneration: value.authGeneration || '',
    laneKey: value.laneKey || deriveLaneKey(operation, value.url, principalId),
    operation,
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
    leaseOwner: value.leaseOwner || null,
    leaseUntil: value.leaseUntil || null,
  };
};

const getActivePrincipal = async () => {
  const db = await openOfflineDb();
  try {
    const marker = await requestResult(
      db.transaction(OFFLINE_STORE, 'readonly').objectStore(OFFLINE_STORE).get(ACTIVE_PRINCIPAL_ID)
    );
    if (!marker?.principalId || !marker?.authGeneration) return null;
    return { principalId: marker.principalId, authGeneration: marker.authGeneration };
  } finally {
    db.close();
  }
};

const setActivePrincipal = async principal => {
  if (!principal?.principalId || !principal?.authGeneration) return;
  const db = await openOfflineDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      const store = tx.objectStore(OFFLINE_STORE);
      const read = store.getAll();
      read.onsuccess = () => {
        for (const raw of read.result) {
          if (!raw?.id || raw.id === ACTIVE_PRINCIPAL_ID || raw.kind === 'PRINCIPAL') continue;
          if (
            raw.principalId !== principal.principalId ||
            raw.authGeneration !== principal.authGeneration
          ) {
            store.delete(raw.id);
          }
        }
        store.put({
          id: ACTIVE_PRINCIPAL_ID,
          kind: 'PRINCIPAL',
          principalId: principal.principalId,
          authGeneration: principal.authGeneration,
          updatedAt: Date.now(),
        });
      };
      read.onerror = () => tx.abort();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

const listQueuedRequests = async principal => {
  if (!principal) return [];
  const db = await openOfflineDb();
  try {
    const values = await requestResult(db.transaction(OFFLINE_STORE, 'readonly').objectStore(OFFLINE_STORE).getAll());
    return values
      .filter(value => value?.id !== ACTIVE_PRINCIPAL_ID && value?.kind !== 'PRINCIPAL')
      .map(normalizeQueuedRequest)
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

const putQueuedRequest = async item => {
  const db = await openOfflineDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).put(item);
      tx.oncomplete = resolve;
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

const stateForStatus = status => {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 409) return 'CONFLICT';
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'FAILED';
  return null;
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

const firstPerLane = items => {
  const lanes = new Map();
  for (const item of items) {
    if (TERMINAL_QUEUE_STATES.has(item.state)) continue;
    if (!lanes.has(item.laneKey)) lanes.set(item.laneKey, item);
  }
  return [...lanes.values()].sort((a, b) => a.createdAt - b.createdAt);
};

const claimRequest = async (candidate, principal, now) => {
  const db = await openOfflineDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      const store = tx.objectStore(OFFLINE_STORE);
      const read = store.get(candidate.id);
      let claimed = null;
      read.onsuccess = () => {
        if (!read.result) return;
        const current = normalizeQueuedRequest(read.result);
        if (
          current.principalId !== principal.principalId ||
          current.authGeneration !== principal.authGeneration
        ) return;
        const staleLease = current.state === 'SENDING' && (current.leaseUntil || 0) <= now;
        const due =
          current.state === 'PENDING' &&
          (current.nextAttemptAt == null || current.nextAttemptAt <= now);
        if (!staleLease && !due) return;
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
};

const transitionClaimed = async (item, patch) => {
  const db = await openOfflineDb();
  let nextState = null;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      const store = tx.objectStore(OFFLINE_STORE);
      const read = store.get(item.id);
      read.onsuccess = () => {
        const current = read.result;
        if (!current || current.leaseOwner !== EXECUTOR_ID) return;
        const next = {
          ...normalizeQueuedRequest(current),
          ...patch,
          updatedAt: Date.now(),
          leaseOwner: null,
          leaseUntil: null,
        };
        nextState = next.state;
        store.put(next);
      };
      read.onerror = () => tx.abort();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  if (nextState) await broadcast('OFFLINE_QUEUE_CHANGED', { id: item.id, state: nextState });
};

const processClaimed = async item => {
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
    let response;
    try {
      response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body || undefined,
        credentials: 'include',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (response.ok) {
      await transitionClaimed(item, {
        state: 'SUCCEEDED',
        completedAt: Date.now(),
        nextAttemptAt: null,
        lastError: null,
      });
      return;
    }
    const error = await responseError(response);
    const nextState = stateForStatus(response.status);
    if (nextState) {
      await transitionClaimed(item, {
        state: nextState,
        completedAt: TERMINAL_QUEUE_STATES.has(nextState) ? Date.now() : null,
        nextAttemptAt: null,
        lastError: error,
      });
      return;
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
  } catch (error) {
    await transitionClaimed(item, {
      state: 'PENDING',
      nextAttemptAt: Date.now() + exponentialBackoffMs(item.retryCount),
      lastError: error instanceof Error ? error.message : 'Network unavailable',
    });
  }
};

const flushQueuedRequests = async () => {
  try {
    const principal = await getActivePrincipal();
    if (!principal) return;
    let processed = 0;
    while (processed < MAX_OPERATIONS_PER_FLUSH) {
      const queue = await listQueuedRequests(principal);
      const now = Date.now();
      const candidates = firstPerLane(queue).filter(item => {
        if (item.state === 'AUTH_REQUIRED' || item.state === 'CONFLICT') return false;
        if (item.state === 'SENDING') return (item.leaseUntil || 0) <= now;
        return item.state === 'PENDING' && (item.nextAttemptAt == null || item.nextAttemptAt <= now);
      });
      if (candidates.length === 0) return;
      const claimed = (
        await Promise.all(
          candidates
            .slice(0, MAX_PARALLEL_LANES)
            .map(candidate => claimRequest(candidate, principal, now))
        )
      ).filter(Boolean);
      if (claimed.length === 0) return;
      await Promise.all(claimed.map(processClaimed));
      processed += claimed.length;
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
  const fallbackUrl = incidentId ? `/m/incidents/${encodeURIComponent(incidentId)}` : '/m/notifications';
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
    data: { incidentId, url: `/m/incidents/${encodeURIComponent(incidentId)}` },
  });

const queueAcknowledgement = async ({ incidentId, expectedStatus, idempotencyKey }) => {
  const principal = await getActivePrincipal();
  if (!principal) throw new Error('No authenticated principal is bound to the responder queue');
  const id = randomId();
  const now = Date.now();
  const url = new URL(`/api/incidents/${encodeURIComponent(incidentId)}/status`, self.location.origin).toString();
  await putQueuedRequest({
    id,
    kind: 'REQUEST',
    principalId: principal.principalId,
    authGeneration: principal.authGeneration,
    laneKey: `incident:${incidentId}`,
    operation: 'INCIDENT_STATUS',
    url,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ status: 'ACKNOWLEDGED', ...(expectedStatus ? { expectedStatus } : {}) }),
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
    leaseOwner: null,
    leaseUntil: null,
  });
  await broadcast('OFFLINE_QUEUE_CHANGED', { id, state: 'PENDING' });
};

const handleAcknowledgeAction = async notification => {
  const data = notification.data || {};
  const incidentId = data.incidentId;
  if (!incidentId) return focusOrOpen(data.url || '/m/notifications');
  if (!SUPPORTED_PUSH_CONTRACT_VERSIONS.has(Number(data.version || 1))) {
    await showFeedback('OpsKnight update required', 'Open the incident to use responder actions from this notification.', incidentId, 'version');
    return focusOrOpen(`/m/incidents/${encodeURIComponent(incidentId)}`);
  }

  const incidentPath = `/m/incidents/${encodeURIComponent(incidentId)}`;
  const expectedStatus = data.status === 'OPEN' ? 'OPEN' : undefined;
  const stableSeed = data.deliveryId || data.eventId || notification.tag || randomId();
  const idempotencyKey = `push-ack:${incidentId}:${String(stableSeed).slice(0, 120)}`;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
    let response;
    try {
      response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ status: 'ACKNOWLEDGED', ...(expectedStatus ? { expectedStatus } : {}) }),
        credentials: 'include',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (response.ok) {
      await showFeedback('Incident acknowledged', `Incident #${incidentId} is acknowledged.`, incidentId, 'ack');
      return;
    }
    if (response.status === 401) {
      await showFeedback('Sign in required', 'Open OpsKnight to authenticate before acknowledging.', incidentId, 'auth');
      return focusOrOpen(`/m/login?callbackUrl=${encodeURIComponent(incidentPath)}`);
    }
    if (response.status === 403) {
      await showFeedback('Acknowledgement not authorized', 'Your account cannot acknowledge this incident.', incidentId, 'forbidden');
      return focusOrOpen(incidentPath);
    }
    if (response.status === 409) {
      await showFeedback('Incident changed', 'Another responder changed this incident. Open it for the latest state.', incidentId, 'conflict');
      return focusOrOpen(incidentPath);
    }
    if (response.status === 429 || response.status >= 500) {
      await showFeedback('Acknowledgement not confirmed', 'OpsKnight could not confirm the action. Open the incident and retry.', incidentId, 'retry');
      return focusOrOpen(incidentPath);
    }
    await showFeedback('Acknowledgement failed', 'The incident was not acknowledged. Open it for details.', incidentId, 'failed');
    return focusOrOpen(incidentPath);
  } catch {
    try {
      await queueAcknowledgement({ incidentId, expectedStatus, idempotencyKey });
      await showFeedback('Acknowledgement queued', 'Offline: the action is queued and is not confirmed yet.', incidentId, 'queued');
    } catch {
      await showFeedback('Acknowledgement not saved', 'Offline storage was unavailable. Open OpsKnight and retry.', incidentId, 'queue-failed');
    }
  }
};

self.addEventListener('push', event => {
  let raw = {};
  if (event.data) {
    try {
      raw = event.data.json();
    } catch {}
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
  if (payload.actions?.length) options.actions = payload.actions;
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

self.addEventListener('install', () => {});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const dynamicCachePatterns = ['pages', 'pages-rsc', 'pages-rsc-prefetch', 'start-url', 'apis', 'static-data-assets', 'cross-origin'];
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

const deleteDatabase = name =>
  new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data.type === 'SET_ACTIVE_PRINCIPAL') {
    event.waitUntil(
      setActivePrincipal({
        principalId: String(event.data.principalId || ''),
        authGeneration: String(event.data.authGeneration || ''),
      })
    );
    return;
  }
  if (event.data.type === 'SYNC_OFFLINE_QUEUE') {
    event.waitUntil(
      (async () => {
        if (event.data.principalId && event.data.authGeneration) {
          await setActivePrincipal({
            principalId: String(event.data.principalId),
            authGeneration: String(event.data.authGeneration),
          });
        }
        await flushQueuedRequests();
      })()
    );
    return;
  }
  if (event.data.type === 'PURGE_AUTH_CACHES') {
    event.waitUntil(
      (async () => {
        try {
          const names = await caches.keys();
          await Promise.all(
            names.filter(name => /page|start-url|api|rsc/i.test(name)).map(name => caches.delete(name))
          );
          await Promise.all([deleteDatabase(OFFLINE_DB), deleteDatabase(SECURE_CACHE_KEY_DB)]);
        } catch (error) {
          console.warn('[Service Worker] Failed to purge authenticated responder storage', error);
        }
      })()
    );
  }
});
