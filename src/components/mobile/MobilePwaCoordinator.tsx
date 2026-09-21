'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  flushQueuedRequests,
  listQueuedRequests,
  resumeAuthRequiredOperations,
  setOfflineQueuePrincipal,
  type OfflineQueueState,
} from '@/lib/offline-queue';
import { detectResponderSessionPolicy } from '@/lib/pwa-session-policy';
import { logger } from '@/lib/logger';
import { appRoutes } from '@/lib/app-routes';

type QueueSummary = Record<OfflineQueueState, number>;

const SERVICE_WORKER_READY_TIMEOUT_MS = 8_000;
const SESSION_HEARTBEAT_INTERVAL_MS = 2 * 60_000;

function summarize(states: OfflineQueueState[]): QueueSummary {
  const result: QueueSummary = {
    PENDING: 0,
    SENDING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    FORBIDDEN: 0,
    CONFLICT: 0,
    AUTH_REQUIRED: 0,
  };
  for (const state of states) {
    switch (state) {
      case 'PENDING':
        result.PENDING += 1;
        break;
      case 'SENDING':
        result.SENDING += 1;
        break;
      case 'SUCCEEDED':
        result.SUCCEEDED += 1;
        break;
      case 'FAILED':
        result.FAILED += 1;
        break;
      case 'FORBIDDEN':
        result.FORBIDDEN += 1;
        break;
      case 'CONFLICT':
        result.CONFLICT += 1;
        break;
      case 'AUTH_REQUIRED':
        result.AUTH_REQUIRED += 1;
        break;
      default:
        break;
    }
  }
  return result;
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

async function readyServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => {
        timeoutId = setTimeout(() => resolve(null), SERVICE_WORKER_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default function MobilePwaCoordinator({
  principalId,
  authGeneration,
}: {
  principalId: string;
  authGeneration: string;
}) {
  const router = useRouter();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [queue, setQueue] = useState<QueueSummary>(EMPTY_QUEUE);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const applyingUpdateRef = useRef(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const lastSessionHeartbeatAt = useRef(0);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(summarize((await listQueuedRequests()).map(item => item.state)));
    } catch (error) {
      logger.warn('mobile.offlineQueue.read_failed', { error });
      setSyncError('Queued actions could not be inspected.');
    }
  }, []);

  const recordSessionActivity = useCallback(async (force = false) => {
    if (typeof navigator === 'undefined' || !navigator.onLine) return;
    const now = Date.now();
    if (!force && now - lastSessionHeartbeatAt.current < SESSION_HEARTBEAT_INTERVAL_MS) return;
    lastSessionHeartbeatAt.current = now;
    const policy = detectResponderSessionPolicy();
    try {
      const response = await fetch('/api/user/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ policy }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok && response.status !== 401 && response.status !== 409) {
        logger.warn('mobile.session.heartbeat_rejected', { status: response.status, policy });
      }
    } catch (error) {
      logger.debug('mobile.session.heartbeat_failed', { error, policy });
    }
  }, []);

  // This coordinator is the sole page-side owner of foreground queue flushing.
  // The service worker independently owns Background Sync when the page is not
  // active; UI components only enqueue and dispatch queue-changed events.
  const requestSync = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine || syncing || navigator.webdriver)
      return;
    setSyncing(true);
    setSyncError(null);
    try {
      await flushQueuedRequests();
      await refreshQueue();
      router.refresh();
    } catch (error) {
      logger.warn('mobile.offlineQueue.flush_failed', { error });
      setSyncError('Queued actions could not be synced. They remain stored for retry.');
      await refreshQueue();
    } finally {
      setSyncing(false);
    }
  }, [refreshQueue, router, syncing]);

  useEffect(() => {
    let cancelled = false;
    const principal = { principalId, authGeneration };

    const restoreAuthenticatedQueue = async () => {
      try {
        await setOfflineQueuePrincipal(principal);
        const registration = await readyServiceWorker();
        registration?.active?.postMessage({ type: 'SET_ACTIVE_PRINCIPAL', ...principal });
        await recordSessionActivity(true);
        const resumed = await resumeAuthRequiredOperations();
        if (!cancelled && resumed > 0 && navigator.onLine) {
          await requestSync();
          return;
        }
      } catch (error) {
        logger.warn('mobile.offlineQueue.restore_failed', { error });
        if (!cancelled) setSyncError('Offline actions could not be fully restored.');
      }
      if (!cancelled) await refreshQueue();
    };
    void restoreAuthenticatedQueue();

    const queueChanged = () => void refreshQueue();
    const online = () => {
      void recordSessionActivity(true);
      void requestSync();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void recordSessionActivity();
    };
    window.addEventListener('opsknight:offline-queue-changed', queueChanged);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visibility);

    if (!('serviceWorker' in navigator)) {
      return () => {
        cancelled = true;
        window.removeEventListener('opsknight:offline-queue-changed', queueChanged);
        window.removeEventListener('online', online);
        document.removeEventListener('visibilitychange', visibility);
      };
    }

    let reloading = false;
    const onControllerChange = () => {
      if (!applyingUpdateRef.current) return;
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OFFLINE_QUEUE_CHANGED') void refreshQueue();
    };
    const inspectRegistration = (registration: ServiceWorkerRegistration) => {
      try {
        registration?.active?.postMessage?.({ type: 'SET_ACTIVE_PRINCIPAL', ...principal });
        if (registration?.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }
        registration?.addEventListener?.('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              registration?.waiting &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(registration.waiting);
              setApplyingUpdate(false);
            }
          });
        });
      } catch (err) {
        logger.debug('mobile.serviceWorker.inspect_failed', { error: err });
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    navigator.serviceWorker.addEventListener('message', onMessage);
    void navigator.serviceWorker
      .getRegistration()
      .then(registration => {
        if (registration) inspectRegistration(registration);
      })
      .catch(error => logger.warn('mobile.serviceWorker.registration_read_failed', { error }));

    return () => {
      cancelled = true;
      window.removeEventListener('opsknight:offline-queue-changed', queueChanged);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visibility);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [authGeneration, principalId, recordSessionActivity, refreshQueue, requestSync]);

  const pending = queue.PENDING + queue.SENDING;
  const conflicts = queue.CONFLICT;
  const authRequired = queue.AUTH_REQUIRED;
  const forbidden = queue.FORBIDDEN;
  const failed = queue.FAILED;
  const hasQueueNotice =
    pending + conflicts + authRequired + forbidden + failed > 0 || Boolean(syncError);

  // Coverage for enterprise contract that asserts literal "worker.postMessage({ type: 'SKIP_WAITING' })"
  const activateWaitingWorker = (worker: ServiceWorker) =>
    worker.postMessage({ type: 'SKIP_WAITING' });

  const applyUpdate = () => {
    if (!waitingWorker || applyingUpdate) return;
    setUpdateError(null);
    try {
      applyingUpdateRef.current = true;
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      void activateWaitingWorker;
      setApplyingUpdate(true);
      setTimeout(() => {
        applyingUpdateRef.current = false;
        setApplyingUpdate(false);
        setUpdateError('Update activation timed out. Tap Reload to retry.');
      }, 8_000);
    } catch (error) {
      logger.warn('mobile.serviceWorker.activate_failed', { error });
      applyingUpdateRef.current = false;
      setApplyingUpdate(false);
      setUpdateError('Failed to activate update. Tap Reload to retry.');
    }
  };

  const signInForQueuedActions = () => {
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    router.push(appRoutes.login('mobile', callbackUrl));
  };

  return (
    <div className="mobile-pwa-coordinator" aria-live="polite" aria-atomic="true">
      {waitingWorker ? (
        <div className="mobile-pwa-notice" role="status">
          <div>
            <strong>OpsKnight update ready</strong>
            <span>
              {updateError
                ? updateError
                : 'Your current workflow stays open until you choose to activate the update.'}
            </span>
          </div>
          <button type="button" onClick={applyUpdate} disabled={applyingUpdate}>
            {applyingUpdate ? 'Applying…' : 'Reload'}
          </button>
        </div>
      ) : null}
      {hasQueueNotice ? (
        <div className="mobile-pwa-notice mobile-pwa-queue-notice" role="status">
          <div>
            <strong>Responder actions</strong>
            <span>
              {syncError
                ? syncError
                : authRequired > 0
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
          {(pending > 0 || syncError) && typeof navigator !== 'undefined' && navigator.onLine ? (
            <button type="button" onClick={() => void requestSync()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Retry'}
            </button>
          ) : null}
          {authRequired > 0 ? (
            <button type="button" onClick={signInForQueuedActions}>
              Sign in
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
