'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  flushQueuedRequests,
  listQueuedRequests,
  resumeAuthRequiredOperations,
  type OfflineQueueState,
} from '@/lib/offline-queue';

type QueueSummary = Record<OfflineQueueState, number>;

function summarize(states: OfflineQueueState[]): QueueSummary {
  let pending = 0;
  let sending = 0;
  let succeeded = 0;
  let failed = 0;
  let forbidden = 0;
  let conflict = 0;
  let authRequired = 0;

  for (const state of states) {
    switch (state) {
      case 'PENDING':
        pending += 1;
        break;
      case 'SENDING':
        sending += 1;
        break;
      case 'SUCCEEDED':
        succeeded += 1;
        break;
      case 'FAILED':
        failed += 1;
        break;
      case 'FORBIDDEN':
        forbidden += 1;
        break;
      case 'CONFLICT':
        conflict += 1;
        break;
      case 'AUTH_REQUIRED':
        authRequired += 1;
        break;
    }
  }

  return {
    PENDING: pending,
    SENDING: sending,
    SUCCEEDED: succeeded,
    FAILED: failed,
    FORBIDDEN: forbidden,
    CONFLICT: conflict,
    AUTH_REQUIRED: authRequired,
  };
}

const EMPTY_QUEUE: QueueSummary = {
  PENDING: 0,
  SENDING: 0,
  SUCCEEDED: 0,
  FAILED: 0,
  FORBIDDEN: 0,
  CONFLICT: 0,
  AUTH_REQUIRED: 0,
};

export default function MobilePwaCoordinator() {
  const router = useRouter();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [queue, setQueue] = useState<QueueSummary>(EMPTY_QUEUE);
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

  const pending = queue.PENDING + queue.SENDING;
  const conflicts = queue.CONFLICT;
  const authRequired = queue.AUTH_REQUIRED;
  const forbidden = queue.FORBIDDEN;
  const failed = queue.FAILED;
  const hasQueueNotice = pending + conflicts + authRequired + forbidden + failed > 0;

  const applyUpdate = () => {
    const worker = waitingWorker;
    if (!worker) return;
    setWaitingWorker(null);
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  const signInForQueuedActions = () => {
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
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
                  : forbidden > 0
                    ? `${forbidden} action${forbidden === 1 ? '' : 's'} were not authorized and will not retry after sign-in.`
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
            <button type="button" onClick={signInForQueuedActions}>
              Sign in
            </button>
          )}
        </div>
      )}
    </div>
  );
}
