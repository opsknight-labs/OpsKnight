'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CircleAlert, Send, Wrench } from 'lucide-react';
import { Card } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { errorFromResponse, toClientAppError } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { logger } from '@/lib/logger';
import { haptics } from '@/lib/haptics';
import { fetchWithTimeout, promiseWithTimeout } from '@/lib/client-timeout';
import { appRoutes } from '@/lib/app-routes';

export type PushState =
  | 'UNSUPPORTED'
  | 'INSTALL_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'AUTH_REQUIRED'
  | 'REGISTERING'
  | 'REGISTERED'
  | 'REPAIR_REQUIRED'
  | 'ERROR';

const REQUEST_TIMEOUT_MS = 12_000;
const SERVICE_WORKER_READY_TIMEOUT_MS = 8_000;

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, char => char.charCodeAt(0));
}

function normalizeVapidKey(rawKey: string) {
  const trimmed = rawKey.trim();
  if (!trimmed) return { error: 'Push notifications are not configured.' };
  if (/BEGIN PUBLIC KEY|END PUBLIC KEY/.test(trimmed)) {
    return { error: 'The Push public key is misconfigured.' };
  }
  const cleaned = trimmed
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (!/^[A-Za-z0-9\-_]+$/.test(cleaned)) return { error: 'The Push public key is invalid.' };
  return { key: cleaned };
}

function displayError(error: unknown, fallback: string) {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description || friendly.title;
}

function detectPlatform(): 'ios' | 'android' | 'desktop' {
  const userAgent = navigator.userAgent || '';
  const ios =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

function standaloneMode() {
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone
  );
}

export default function PushNotificationToggle() {
  const [pushState, setPushState] = useState<PushState>('PERMISSION_REQUIRED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [isStandalone, setIsStandalone] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');

  const ensureServiceWorker = useCallback(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are not supported.');
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      throw new Error('Push notifications require HTTPS.');
    }
    let registration = await navigator.serviceWorker.getRegistration();
    const expected = new URL('/sw.js', window.location.origin).toString();
    if (!registration || registration.active?.scriptURL !== expected) {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
    await promiseWithTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_READY_TIMEOUT_MS,
      'The service worker did not become ready.'
    );
    return registration;
  }, []);

  const checkSupportAndState = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const detectedPlatform = detectPlatform();
    const standalone = standaloneMode();
    setPlatform(detectedPlatform);
    setIsStandalone(standalone);

    if (detectedPlatform === 'ios' && !standalone) {
      setPushState('INSTALL_REQUIRED');
      return;
    }
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setPushState('UNSUPPORTED');
      return;
    }
    if (Notification.permission === 'denied') {
      setPushState('PERMISSION_DENIED');
      return;
    }
    if (Notification.permission === 'default') {
      setPushState('PERMISSION_REQUIRED');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (!subscription) {
        setPushState('PERMISSION_REQUIRED');
        return;
      }
      const response = await fetchWithTimeout(
        '/api/user/push-subscription/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          cache: 'no-store',
          credentials: 'include',
        },
        REQUEST_TIMEOUT_MS
      );
      if (response.status === 401) {
        setPushState('AUTH_REQUIRED');
        return;
      }
      if (response.status === 403) {
        setPushState('ERROR');
        setError('Your account is not allowed to manage Push notifications.');
        return;
      }
      if (!response.ok) {
        setPushState('ERROR');
        setError(
          'Push status could not be verified. Your browser subscription was left unchanged.'
        );
        return;
      }
      const data = (await response.json()) as {
        deviceRegistered?: boolean;
        accountEnabled?: boolean;
      };
      setPushState(data.deviceRegistered && data.accountEnabled ? 'REGISTERED' : 'REPAIR_REQUIRED');
      setError('');
    } catch (stateError) {
      logger.warn('push.state_reconciliation_failed', {
        component: 'PushNotificationToggle',
        error: stateError,
      });
      setPushState('ERROR');
      setError('Push status could not be verified. Nothing was changed.');
    }
  }, []);

  useEffect(() => {
    void checkSupportAndState();
    const installed = () => void checkSupportAndState();
    const online = () => void checkSupportAndState();
    window.addEventListener('appinstalled', installed);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('online', online);
    };
  }, [checkSupportAndState]);

  const subscribeOrRepair = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setTestMessage('');
    setPushState('REGISTERING');
    try {
      let permission = Notification.permission;
      // Browser permission is requested only from this explicit user gesture.
      if (permission !== 'granted') permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setPushState('PERMISSION_DENIED');
        setError('Notifications are blocked in browser or device settings.');
        return;
      }
      if (permission !== 'granted') {
        setPushState('PERMISSION_REQUIRED');
        setError('Notification permission was not granted.');
        return;
      }

      const registration = await ensureServiceWorker();
      const keyResponse = await fetchWithTimeout(
        '/api/system/vapid-public-key',
        { cache: 'no-store' },
        REQUEST_TIMEOUT_MS
      );
      if (!keyResponse.ok)
        throw await errorFromResponse(keyResponse, 'Push configuration is unavailable.');
      const { key: vapidKey } = (await keyResponse.json()) as { key?: string };
      const normalized = normalizeVapidKey(String(vapidKey || ''));
      if (!normalized.key) throw new Error(normalized.error || 'Push public key is invalid.');
      const applicationServerKey = urlBase64ToUint8Array(normalized.key);
      if (applicationServerKey.length !== 65) throw new Error('Push public key length is invalid.');

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      }

      const saveResponse = await fetchWithTimeout(
        '/api/user/push-subscription',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription),
          credentials: 'include',
        },
        REQUEST_TIMEOUT_MS
      );
      if (saveResponse.status === 401) {
        setPushState('AUTH_REQUIRED');
        return;
      }
      if (!saveResponse.ok)
        throw await errorFromResponse(saveResponse, 'Failed to save Push subscription.');
      setPushState('REGISTERED');
      haptics.success();
    } catch (subscribeError) {
      logger.error('push.subscription_failed', {
        component: 'PushNotificationToggle',
        error: subscribeError,
      });
      setError(displayError(subscribeError, 'Failed to enable Push notifications.'));
      setPushState(
        typeof Notification !== 'undefined' && Notification.permission === 'denied'
          ? 'PERMISSION_DENIED'
          : 'ERROR'
      );
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const registration = await ensureServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setPushState('PERMISSION_REQUIRED');
        return;
      }

      // Server-first removal prevents a failed DELETE leaving an unreachable
      // browser subscription that the user can no longer identify or repair.
      const serverResponse = await fetchWithTimeout(
        '/api/user/push-subscription',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          credentials: 'include',
        },
        REQUEST_TIMEOUT_MS
      );
      if (serverResponse.status === 401) {
        setPushState('AUTH_REQUIRED');
        return;
      }
      if (!serverResponse.ok) {
        throw await errorFromResponse(serverResponse, 'Failed to disable Push on the server.');
      }

      const browserRemoved = await subscription.unsubscribe();
      if (!browserRemoved) {
        setPushState('REPAIR_REQUIRED');
        setError(
          'Server delivery is disabled, but the browser subscription needs cleanup. Use Repair when online.'
        );
        return;
      }
      setPushState('PERMISSION_REQUIRED');
      haptics.selection();
    } catch (unsubscribeError) {
      logger.warn('push.unsubscribe_failed', {
        component: 'PushNotificationToggle',
        error: unsubscribeError,
      });
      setError(displayError(unsubscribeError, 'Failed to disable Push notifications.'));
      await checkSupportAndState();
    } finally {
      setLoading(false);
    }
  };

  const sendTestPush = async () => {
    if (isTesting || pushState !== 'REGISTERED') return;
    setIsTesting(true);
    setTestMessage('');
    try {
      const registration = await ensureServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription?.endpoint) {
        setPushState('REPAIR_REQUIRED');
        setError('No active push subscription on this device. Tap Repair to restore.');
        return;
      }
      const response = await fetchWithTimeout(
        '/api/notifications/test-push',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          credentials: 'include',
        },
        REQUEST_TIMEOUT_MS
      );
      if (!response.ok) {
        const rawText = await response.text().catch(() => '');
        let errorData: Record<string, unknown> | null = null;
        try {
          errorData = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
        } catch {}
        const reason =
          (typeof errorData?.reason === 'string' ? errorData.reason : undefined) ??
          (typeof (errorData?.meta as Record<string, unknown> | undefined)?.reason === 'string'
            ? (errorData?.meta as Record<string, unknown>).reason
            : undefined) ??
          (typeof (errorData?.details as Record<string, unknown> | undefined)?.reason === 'string'
            ? (errorData?.details as Record<string, unknown>).reason
            : undefined);
        const code = typeof errorData?.code === 'string' ? errorData.code : undefined;
        const message =
          (typeof errorData?.error === 'string' ? errorData.error : undefined) ??
          (typeof errorData?.message === 'string' ? errorData.message : undefined) ??
          'Failed to send test Push.';

        if (
          response.status === 410 ||
          response.status === 404 ||
          reason === 'PUSH_SUBSCRIPTION_EXPIRED' ||
          reason === 'PUSH_NO_SUBSCRIPTION' ||
          code === 'RESOURCE_NOT_FOUND'
        ) {
          setPushState('REPAIR_REQUIRED');
          setError('Push subscription on this device has expired. Tap Repair to restore.');
          return;
        }
        throw toClientAppError(errorData, message);
      }
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      setTestMessage(data?.message || 'Test Push sent successfully to this device.');
    } catch (testError) {
      logger.warn('push.test_failed', { component: 'PushNotificationToggle', error: testError });
      setTestMessage(displayError(testError, 'Failed to send test Push.'));
    } finally {
      setIsTesting(false);
    }
  };

  if (pushState === 'UNSUPPORTED') return null;

  const hint =
    platform === 'ios'
      ? isStandalone
        ? 'Installed iOS Web App is eligible for Web Push.'
        : 'Install OpsKnight from Safari with Add to Home Screen before enabling Push.'
      : platform === 'android'
        ? isStandalone
          ? 'Installed PWA detected for reliable background delivery.'
          : 'Install OpsKnight for the best background-delivery experience.'
        : 'Browser Push can deliver incident notifications to this device.';

  return (
    <Card className="rounded-xl border-border bg-card p-4 shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            {pushState === 'REGISTERED' ? (
              <Bell className="h-5 w-5" aria-hidden="true" />
            ) : (
              <BellOff className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Push notifications</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Push delivery is registered per device and remains separate from the lifetime of your
              interactive login session.
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {pushState === 'INSTALL_REQUIRED' ? (
            <span className="inline-flex min-h-9 items-center rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Install first
            </span>
          ) : pushState === 'PERMISSION_DENIED' ? (
            <span className="inline-flex min-h-9 items-center rounded-lg border border-rose-300 bg-rose-50 px-2.5 text-xs font-semibold text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              Blocked
            </span>
          ) : pushState === 'AUTH_REQUIRED' ? (
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              onClick={() => {
                const callback = `${window.location.pathname}${window.location.search}`;
                window.location.assign(appRoutes.login(callback));
              }}
            >
              Sign in
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant={pushState === 'REGISTERED' ? 'outline' : 'default'}
              className="min-h-11 gap-1.5"
              disabled={loading || pushState === 'REGISTERING'}
              onClick={() =>
                void (pushState === 'REGISTERED' ? unsubscribe() : subscribeOrRepair())
              }
            >
              {pushState === 'REPAIR_REQUIRED' ? (
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              ) : null}
              {loading || pushState === 'REGISTERING'
                ? 'Working…'
                : pushState === 'REGISTERED'
                  ? 'Disable'
                  : pushState === 'REPAIR_REQUIRED'
                    ? 'Repair'
                    : 'Enable'}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-3 border-t border-border pt-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 w-full gap-2"
          onClick={() => void sendTestPush()}
          disabled={pushState !== 'REGISTERED' || isTesting || loading}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {isTesting ? 'Sending test…' : 'Send test Push'}
        </Button>
        {testMessage ? (
          <p className="mt-2 text-center text-xs text-muted-foreground" role="status">
            {testMessage}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
