'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  flushQueuedRequests,
  listQueuedRequests,
  resumeAuthRequiredOperations,
  type OfflineQueueState,
} from '@/lib/offline-queue';

type QueueSummary = Partial<Record<OfflineQueueState, number>>;

function summarize(states: OfflineQueueState[]): QueueSummary {
  return states.reduce<QueueSummary>((acc, state) => {
    acc[state] = (acc[state] ?? 0) + 1;
    return acc;
  }, {});
}

export default function MobilePwaCoordinator() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [queue, setQueue] = useState<QueueSummary>({});
  const [syncing, setSyncing] = useState(false);

  const refreshQueue = useCallback(async () => {
    try {
      const items = await listQueuedRequests();
      setQueue(summarize(items.map(item => item.state)));
    } catch {
      // IndexedDB can be unavailable in restrictive/private browsing modes.
    }
  }, []);

  const requestSync = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine) return;
    setSyncing(true);
    try {
      await flushQueuedRequests();
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
      registration?.active?.postMessage({ type: 'SYNC_OFFLINE_QUEUE' });
      await refreshQueue();
    } finally {
      setSyncing(false);
    }
  }, [refreshQueue]);

  useEffect(() => {
    const restoreAuthenticatedQueue = async () => {
      try {
        const resumed = await resumeAuthRequiredOperations();
        if (resumed > 0 && navigator.onLine) {
          await requestSync();
          return;
        }
      } catch {
        // Queue recovery is best-effort; the visible queue state remains available for manual retry.
      }
      await refreshQueue();
    };

    // This component only renders inside the authenticated mobile layout. Reaching
    // this boundary after a login/SSO round-trip is therefore the authoritative
    // signal that AUTH_REQUIRED entries may re-enter normal ordered replay.
    void restoreAuthenticatedQueue();

    const queueChanged = () => void refreshQueue();
    const online = () => void requestSync();
    window.addEventListener('opsknight:offline-queue-changed', queueChanged);
    window.addEventListener('online', online);

    if (!('serviceWorker' in navigator)) {
      return () => {
        window.removeEventListener('opsknight:offline-queue-changed', queueChanged);
        window.removeEventListener('online', online);
      };
    }

    let reloading = false;

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OFFLINE_QUEUE_CHANGED') void refreshQueue();
    };
    const inspectRegistration = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(registration.waiting);
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (
            installing.state === 'installed' &&
            registration.waiting &&
            navigator.serviceWorker.controller
          ) {
            setWaitingWorker(registration.waiting);
          }
        });
      });
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    navigator.serviceWorker.addEventListener('message', onMessage);
    void navigator.serviceWorker.getRegistration().then(registration => {
      if (registration) inspectRegistration(registration);
    });

    return () => {
      window.removeEventListener('opsknight:offline-queue-changed', queueChanged);
      window.removeEventListener('online', online);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      // Registration listeners are page-scoped and are released with this document.
    };
  }, [refreshQueue, requestSync]);

  const pending = (queue.PENDING ?? 0) + (queue.SENDING ?? 0);
  const conflicts = queue.CONFLICT ?? 0;
  const authRequired = queue.AUTH_REQUIRED ?? 0;
  const failed = queue.FAILED ?? 0;
  const hasQueueNotice = pending + conflicts + authRequired + failed > 0;

  const applyUpdate = () => {
    const worker = waitingWorker;
    if (!worker) return;
    setWaitingWorker(null);
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  return (
    <div className="mobile-pwa-coordinator" aria-live="polite" aria-atomic="true">
      {waitingWorker && (
        <div className="mobile-pwa-notice" role="status">
          <div>
            <strong>OpsKnight update ready</strong>
            <span>Reload when you are ready. Your current workflow will not be interrupted.</span>
          </div>
          <button type="button" onClick={applyUpdate}>
            Reload
          </button>
        </div>
      )}

      {hasQueueNotice && (
        <div className="mobile-pwa-notice mobile-pwa-queue-notice" role="status">
          <div>
            <strong>Responder actions</strong>
            <span>
              {authRequired > 0
                ? `${authRequired} action${authRequired === 1 ? '' : 's'} need sign-in before syncing.`
                : conflicts > 0
                  ? `${conflicts} action${conflicts === 1 ? '' : 's'} conflict with newer incident state.`
                  : failed > 0
                    ? `${failed} queued action${failed === 1 ? '' : 's'} failed and need attention.`
                    : `${pending} action${pending === 1 ? '' : 's'} queued and not yet confirmed.`}
            </span>
          </div>
          {pending > 0 && typeof navigator !== 'undefined' && navigator.onLine && (
            <button type="button" onClick={() => void requestSync()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Retry'}
            </button>
          )}
          {authRequired > 0 && (
            <button
              type="button"
              onClick={() =>
                window.location.assign(
                  `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`
                )
              }
            >
              Sign in
            </button>
          )}
        </div>
      )}
    </div>
  );
}
