// Custom Service Worker for OpsKnight PWA
// Handles push notifications and notification clicks

// Import Workbox (provided by Next.js PWA)
importScripts();

const OFFLINE_DB = 'opsknight-offline';
const OFFLINE_STORE = 'request-queue';

const openOfflineDb = () =>
    new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
                const store = db.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

const listQueuedRequests = async () => {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readonly');
        const store = tx.objectStore(OFFLINE_STORE);
        const index = store.index('createdAt');
        const items = [];
        const cursor = index.openCursor();
        cursor.onsuccess = () => {
            const current = cursor.result;
            if (current) {
                items.push(current.value);
                current.continue();
            }
        };
        tx.oncomplete = () => resolve(items);
        tx.onerror = () => reject(tx.error);
    });
};

const removeQueuedRequest = async (id) => {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readwrite');
        const store = tx.objectStore(OFFLINE_STORE);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const isRetryableStatus = (status) => {
    if (status >= 500) return true;
    if (status === 408 || status === 429) return true;
    return false;
};

const flushQueuedRequests = async () => {
    try {
        const queue = await listQueuedRequests();
        for (const item of queue) {
            try {
                const response = await fetch(item.url, {
                    method: item.method,
                    headers: item.headers,
                    body: item.body || undefined,
                    credentials: 'include'
                });
                if (response.ok) {
                    await removeQueuedRequest(item.id);
                    continue;
                }
                if (!isRetryableStatus(response.status)) {
                    await removeQueuedRequest(item.id);
                    continue;
                }
                break;
            } catch {
                break;
            }
        }
    } catch (error) {
        console.warn('[Service Worker] Offline queue flush failed', error);
    }
};

// Listen for push events
self.addEventListener('push', function (event) {
    console.log('[Service Worker] Push received', event);

    let data = {
        title: 'OpsKnight',
        body: 'New notification',
        icon: '/icons/app-icon-192.png',
        badge: '/icons/app-icon-192.png',
        url: '/m/notifications',
        actions: undefined
    };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            console.error('[Service Worker] Failed to parse push data', e);
        }
    }

    let resolvedActions;
    const rawActions = data.actions || data.data?.actions;
    if (rawActions) {
        if (Array.isArray(rawActions)) {
            resolvedActions = rawActions;
        } else if (typeof rawActions === 'string') {
            try {
                const parsedActions = JSON.parse(rawActions);
                if (Array.isArray(parsedActions)) {
                    resolvedActions = parsedActions;
                }
            } catch {
                resolvedActions = undefined;
            }
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || '/icons/app-icon-192.png',
        badge: data.badge || '/icons/app-icon-192.png',
        data: {
            url: data.url || data.data?.url || '/m/notifications',
            ...data.data
        },
        tag: data.tag || data.data?.tag || (data.data?.incidentId ? `incident-${data.data.incidentId}` : 'opsknight-notification-' + Date.now()),
        requireInteraction: true, // Keep notification visible on mobile
        vibrate: [200, 100, 200] // Vibration pattern
    };

    if (resolvedActions && resolvedActions.length > 0) {
        options.actions = resolvedActions;
    }

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Listen for notification clicks
self.addEventListener('notificationclick', function (event) {
    console.log('[Service Worker] Notification clicked', event);

    event.notification.close();

    const incidentId = event.notification.data?.incidentId;
    const urlToOpen = event.notification.data?.url || (incidentId ? `/m/incidents/${incidentId}` : '/m/notifications');

    if (event.action === 'acknowledge' && incidentId) {
        event.waitUntil(
            fetch(`/api/mobile/incidents/${incidentId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
                credentials: 'include'
            }).then(() => {
                return self.registration.showNotification('Incident Acknowledged', {
                    body: `Incident #${incidentId} acknowledged.`,
                    icon: '/icons/app-icon-192.png',
                    tag: `incident-${incidentId}`,
                    requireInteraction: false
                });
            }).catch((err) => {
                console.error('Failed to acknowledge from notification', err);
            })
        );
        return;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function (clientList) {
                // Check if there's already a window open
                for (let i = 0; i < clientList.length; i++) {
                    const client = clientList[i];
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus().then(() => {
                            // Navigate to the notification URL
                            return client.navigate(urlToOpen);
                        });
                    }
                }
                // If no window is open, open a new one
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});

// Optional: Handle service worker installation
self.addEventListener('install', function (event) {
    console.log('[Service Worker] Installing');
    self.skipWaiting(); // Activate immediately
});

// Optional: Handle service worker activation
self.addEventListener('activate', function (event) {
    console.log('[Service Worker] Activating');
    event.waitUntil(clients.claim()); // Take control immediately
});

self.addEventListener('sync', function (event) {
    if (event.tag === 'opsknight-sync') {
        event.waitUntil(flushQueuedRequests());
    }
});

self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SYNC_OFFLINE_QUEUE') {
        event.waitUntil(flushQueuedRequests());
    }
});

console.log('[Service Worker] Custom SW loaded with push handlers');
