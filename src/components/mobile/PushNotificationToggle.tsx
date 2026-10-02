'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Copy,
  Send,
  Wrench,
} from 'lucide-react';
import MobileSettingCard from '@/components/mobile/MobileSettingCard';
import { Button } from '@/components/ui/shadcn/button';
import { ClientAppError, errorFromResponse, toClientAppError } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { logger } from '@/lib/logger';
import { haptics } from '@/lib/haptics';
import { fetchWithTimeout, promiseWithTimeout } from '@/lib/client-timeout';
import { appRoutes } from '@/lib/app-routes';
import {
  ensureHealthyServiceWorker,
  inspectServiceWorkerHealth,
  type ServiceWorkerHealth,
} from '@/lib/service-worker-runtime';

export type PushState =
  | 'UNSUPPORTED'
  | 'INSTALL_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'AUTH_REQUIRED'
  | 'REGISTERING'
  | 'REGISTERED'
  | 'REPAIR_REQUIRED'
  | 'SERVER_UNAVAILABLE'
  | 'ERROR';

const REQUEST_TIMEOUT_MS = 12_000;
const SERVICE_WORKER_READY_TIMEOUT_MS = 25_000;

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

type PushStage =
  | 'INIT'
  | 'REQUEST_PERMISSION'
  | 'SERVICE_WORKER_READY'
  | 'FETCH_VAPID_KEY'
  | 'READ_SUBSCRIPTION'
  | 'CREATE_SUBSCRIPTION'
  | 'SAVE_SUBSCRIPTION'
  | 'VERIFY_REGISTRATION'
  | 'UNSUBSCRIBE';

type PreparedPush = {
  registration: ServiceWorkerRegistration;
  subscription: PushSubscription | null;
  applicationServerKey: Uint8Array | null;
};

export default function PushNotificationToggle() {
  const router = useRouter();
  const [pushState, setPushState] = useState<PushState>('PERMISSION_REQUIRED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [isStandalone, setIsStandalone] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  const [preparing, setPreparing] = useState(false);
  const [preflightReady, setPreflightReady] = useState(false);
  const preparedPushRef = useRef<PreparedPush | null>(null);
  const reconciliationGenerationRef = useRef(0);

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsHealth, setDiagnosticsHealth] = useState<ServiceWorkerHealth | null>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  const toggleDiagnostics = async () => {
    const next = !showDiagnostics;
    setShowDiagnostics(next);
    if (next) {
      try {
        const health = await inspectServiceWorkerHealth();
        setDiagnosticsHealth(health);
      } catch {
        // Best effort
      }
    }
  };

  const copyDiagnostics = async () => {
    if (!diagnosticsHealth) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticsHealth, null, 2));
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 2_000);
    } catch {
      // Best effort
    }
  };

  const ensureServiceWorker = useCallback(async () => {
    const registration = await ensureHealthyServiceWorker({
      purpose: 'push-enrollment',
      activationPolicy: 'recover-if-no-active',
      timeoutMs: SERVICE_WORKER_READY_TIMEOUT_MS,
    });
    if (!registration?.pushManager) {
      throw new Error('Ready service worker registration does not expose PushManager.');
    }
    return registration;
  }, []);

  const preparePush = useCallback(async (): Promise<PreparedPush> => {
    const registration = await ensureServiceWorker();

    const subscription = await promiseWithTimeout(
      registration.pushManager.getSubscription(),
      REQUEST_TIMEOUT_MS,
      'Push subscription lookup timed out.'
    );

    // An existing browser subscription can be reconciled with the server
    // without fetching VAPID again. This also avoids making healthy devices
    // depend on a configuration endpoint during every settings-page visit.
    if (subscription) {
      return {
        registration,
        subscription,
        applicationServerKey: null,
      };
    }

    const keyResponse = await fetchWithTimeout(
      '/api/system/vapid-public-key',
      { cache: 'no-store' },
      REQUEST_TIMEOUT_MS
    );
    if (keyResponse.status === 404) {
      throw new ClientAppError({
        code: 'PUSH_VAPID_NOT_CONFIGURED',
        error: 'Push is not configured by your administrator.',
        action: 'Push is not configured by your administrator.',
        retryable: false,
      });
    }
    if (!keyResponse.ok) {
      throw await errorFromResponse(keyResponse, 'Push configuration is unavailable.');
    }

    const keyData = (await keyResponse.json()) as {
      key?: string;
      publicKey?: string;
      enabled?: boolean;
    };
    if (keyData.enabled === false) {
      throw new ClientAppError({
        code: 'PUSH_VAPID_NOT_CONFIGURED',
        error: 'Push is not configured by your administrator.',
        action: 'Push is not configured by your administrator.',
        retryable: false,
      });
    }
    const normalized = normalizeVapidKey(String(keyData.publicKey || keyData.key || ''));
    if (!normalized.key) {
      throw new ClientAppError({
        code: 'PUSH_VAPID_INVALID',
        error: normalized.error || 'Push public key is invalid.',
        action: 'Contact your administrator to correct the Web Push VAPID configuration.',
        retryable: false,
      });
    }

    const applicationServerKey = urlBase64ToUint8Array(normalized.key);
    if (applicationServerKey.length !== 65) {
      throw new ClientAppError({
        code: 'PUSH_VAPID_INVALID',
        error: 'Push public key length is invalid.',
        action: 'Contact your administrator to correct the Web Push VAPID configuration.',
        retryable: false,
      });
    }

    return {
      registration,
      subscription: null,
      applicationServerKey,
    };
  }, [ensureServiceWorker]);

  const checkSupportAndState = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const generation = ++reconciliationGenerationRef.current;
    const isCurrent = () => reconciliationGenerationRef.current === generation;
    const detectedPlatform = detectPlatform();
    const standalone = standaloneMode();

    if (!isCurrent()) return;
    setPlatform(detectedPlatform);
    setIsStandalone(standalone);
    setError('');

    if (detectedPlatform === 'ios' && !standalone) {
      preparedPushRef.current = null;
      setPreflightReady(false);
      setPreparing(false);
      setPushState('INSTALL_REQUIRED');
      return;
    }
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      preparedPushRef.current = null;
      setPreflightReady(false);
      setPreparing(false);
      setPushState('UNSUPPORTED');
      return;
    }
    if (Notification.permission === 'denied') {
      preparedPushRef.current = null;
      setPreflightReady(false);
      setPreparing(false);
      setPushState('PERMISSION_DENIED');
      return;
    }

    // Do not perform service-worker or network preparation while permission is
    // still undecided. iOS requires requestPermission() to run directly from
    // the Enable tap, and background preparation can leave the control stuck
    // in a disabled "Preparing" state before that tap can happen.
    if (Notification.permission === 'default') {
      preparedPushRef.current = null;
      setPreflightReady(false);
      setPreparing(false);
      setPushState('PERMISSION_REQUIRED');
      return;
    }

    setPreparing(true);
    setPreflightReady(false);
    try {
      const prepared = await preparePush();
      if (!isCurrent()) return;

      preparedPushRef.current = prepared;
      setPreflightReady(true);

      if (!prepared.subscription) {
        setPreparing(false);
        setPushState('PERMISSION_REQUIRED');
        return;
      }

      const response = await fetchWithTimeout(
        '/api/user/push-subscription/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: prepared.subscription.endpoint }),
          cache: 'no-store',
          credentials: 'include',
        },
        REQUEST_TIMEOUT_MS
      );
      if (!isCurrent()) return;

      if (response.status === 401) {
        setPreparing(false);
        setPushState('AUTH_REQUIRED');
        return;
      }
      if (response.status === 403) {
        setPreparing(false);
        setPushState('ERROR');
        setError('Your account is not allowed to manage Push notifications.');
        return;
      }
      if (!response.ok) {
        setPreparing(false);
        setPushState('ERROR');
        setError(
          'Push status could not be verified. Your browser subscription was left unchanged.'
        );
        return;
      }
      const data = (await response.json()) as {
        deviceRegistered?: boolean;
        accountEnabled?: boolean;
        providerConfigured?: boolean;
      };
      if (!isCurrent()) return;

      setPreparing(false);
      if (data.providerConfigured === false) {
        setPushState('SERVER_UNAVAILABLE');
        setError(
          'Server Push configuration is unavailable. Your device subscription is still saved.'
        );
        return;
      }
      setPushState(data.deviceRegistered && data.accountEnabled ? 'REGISTERED' : 'REPAIR_REQUIRED');
      setError('');
    } catch (stateError) {
      if (!isCurrent()) return;

      preparedPushRef.current = null;
      setPreflightReady(false);
      setPreparing(false);
      logger.warn('push.state_reconciliation_failed', {
        component: 'PushNotificationToggle',
        error: stateError,
      });
      setPushState('ERROR');
      setError(displayError(stateError, 'Push could not be prepared on this device.'));
    }
  }, [preparePush]);

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

    // Capture the permission promise synchronously in the click handler. This
    // must happen before service-worker lookup, VAPID fetches, or any await so
    // iOS and Android retain the browser's user-activation gesture.
    const permissionRequest =
      Notification.permission === 'default' ? Notification.requestPermission() : null;

    // User actions are authoritative over any in-flight background reconciliation.
    reconciliationGenerationRef.current += 1;

    setLoading(true);
    setError('');
    setTestMessage('');
    setPushState('REGISTERING');
    let stage: PushStage = 'INIT';
    try {
      let permission = Notification.permission;
      if (permissionRequest) {
        stage = 'REQUEST_PERMISSION';
        permission = await permissionRequest;
      }

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

      const prepared = preparedPushRef.current ?? (await preparePush());
      preparedPushRef.current = prepared;
      setPreflightReady(true);
      let subscription = prepared.subscription;

      if (!subscription) {
        if (!prepared.applicationServerKey) {
          throw new ClientAppError({
            code: 'PUSH_VAPID_INVALID',
            error: 'Push public key is unavailable.',
            action: 'Retry preparation. If it continues, contact your administrator.',
            retryable: true,
          });
        }

        const subscribeOptions: PushSubscriptionOptionsInit = {
          userVisibleOnly: true,
          applicationServerKey: prepared.applicationServerKey as unknown as BufferSource,
        };

        // Permission has been granted before enrollment begins. Keeping the
        // service-worker and VAPID work after the native prompt prevents setup
        // failures from blocking the prompt itself.
        stage = 'CREATE_SUBSCRIPTION';
        const subscriptionPromise = prepared.registration.pushManager.subscribe(subscribeOptions);
        subscription = await promiseWithTimeout(
          subscriptionPromise,
          REQUEST_TIMEOUT_MS,
          'Push subscription creation timed out.'
        );

        preparedPushRef.current = {
          ...prepared,
          subscription,
        };
      }

      stage = 'SAVE_SUBSCRIPTION';
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
      if (!saveResponse.ok) {
        throw await errorFromResponse(saveResponse, 'Failed to save Push subscription.');
      }

      stage = 'VERIFY_REGISTRATION';
      setPushState('REGISTERED');
      haptics.success();
    } catch (subscribeError) {
      logger.error('push.subscription_failed', {
        component: 'PushNotificationToggle',
        stage,
        platform,
        standalone: isStandalone,
        browserException:
          subscribeError instanceof Error ? subscribeError.name : typeof subscribeError,
        error: subscribeError,
      });
      const currentPermission =
        typeof Notification !== 'undefined' ? Notification.permission : 'default';
      if (currentPermission === 'denied') {
        setError('Notifications are blocked in browser or device settings.');
        setPushState('PERMISSION_DENIED');
      } else if (
        currentPermission === 'default' &&
        subscribeError instanceof Error &&
        subscribeError.name === 'NotAllowedError'
      ) {
        setError('Notification permission was not granted.');
        setPushState('PERMISSION_REQUIRED');
      } else {
        setError(displayError(subscribeError, 'Failed to enable Push notifications.'));
        setPushState('ERROR');
      }
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    if (loading) return;
    reconciliationGenerationRef.current += 1;
    setLoading(true);
    setError('');
    try {
      const registration = await ensureServiceWorker();
      const subscription = await promiseWithTimeout(
        registration.pushManager.getSubscription(),
        REQUEST_TIMEOUT_MS,
        'Push subscription lookup timed out.'
      );
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

      const browserRemoved = await promiseWithTimeout(
        subscription.unsubscribe(),
        REQUEST_TIMEOUT_MS,
        'Push unsubscribe timed out.'
      );
      if (!browserRemoved) {
        setPushState('REPAIR_REQUIRED');
        setError(
          'Server delivery is disabled, but the browser subscription needs cleanup. Use Repair when online.'
        );
        return;
      }
      preparedPushRef.current = null;
      setPreflightReady(false);
      setPreparing(true);
      await checkSupportAndState();
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
      const subscription = await promiseWithTimeout(
        registration.pushManager.getSubscription(),
        REQUEST_TIMEOUT_MS,
        'Push subscription lookup timed out.'
      );
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

  // Precise per-state label so distinct conditions (blocked, needs sign-in,
  // needs repair, in progress) never all collapse into a generic "Disabled".
  function pushStatusLabel(state: Exclude<PushState, 'UNSUPPORTED'>): string {
    switch (state) {
      case 'PERMISSION_REQUIRED':
        return 'Off';
      case 'INSTALL_REQUIRED':
        return 'Install required';
      case 'PERMISSION_DENIED':
        return 'Blocked';
      case 'AUTH_REQUIRED':
        return 'Sign-in required';
      case 'REGISTERING':
        return 'Enabling…';
      case 'REGISTERED':
        return 'On';
      case 'REPAIR_REQUIRED':
        return 'Needs repair';
      case 'SERVER_UNAVAILABLE':
        return 'Server unavailable';
      case 'ERROR':
        return 'Needs attention';
    }
  }

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
    <MobileSettingCard
      icon={
        pushState === 'REGISTERED' ? (
          <Bell className="h-5 w-5" aria-hidden="true" />
        ) : (
          <BellOff className="h-5 w-5" aria-hidden="true" />
        )
      }
      title="Push notifications"
      status={preparing && pushState !== 'REGISTERED' ? 'Preparing…' : pushStatusLabel(pushState)}
      action={
        // Install-required/blocked are already communicated by the status
        // line above; the action slot only needs a control when there is
        // one to take.
        pushState === 'INSTALL_REQUIRED' || pushState === 'PERMISSION_DENIED' ? null : pushState ===
          'AUTH_REQUIRED' ? (
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            onClick={() => {
              const callback = `${window.location.pathname}${window.location.search}`;
              router.push(appRoutes.login('mobile', callback));
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
            disabled={
              loading || pushState === 'REGISTERING' || (pushState !== 'REGISTERED' && preparing)
            }
            onClick={() =>
              void (pushState === 'REGISTERED'
                ? unsubscribe()
                : (pushState === 'ERROR' && !preflightReady) || pushState === 'SERVER_UNAVAILABLE'
                  ? checkSupportAndState()
                  : subscribeOrRepair())
            }
          >
            {pushState === 'REPAIR_REQUIRED' ? (
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            ) : null}
            {preparing && pushState !== 'REGISTERED'
              ? 'Preparing…'
              : loading || pushState === 'REGISTERING'
                ? 'Working…'
                : pushState === 'REGISTERED'
                  ? 'Disable'
                  : pushState === 'REPAIR_REQUIRED'
                    ? 'Repair'
                    : (pushState === 'ERROR' && !preflightReady) ||
                        pushState === 'SERVER_UNAVAILABLE'
                      ? 'Retry'
                      : 'Enable'}
          </Button>
        )
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Push delivery is registered per device and remains separate from the lifetime of your
        interactive login session.
      </p>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {error || pushState === 'ERROR' || pushState === 'REPAIR_REQUIRED' ? (
        <div className="mt-2 text-xs">
          <button
            type="button"
            onClick={() => void toggleDiagnostics()}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-[11px] font-medium transition-colors"
            aria-expanded={showDiagnostics}
          >
            {showDiagnostics ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Diagnostics</span>
          </button>
          {showDiagnostics ? (
            <div className="mt-2 rounded-md border border-border bg-muted/40 p-2.5 space-y-2 text-[11px] text-muted-foreground font-mono">
              <div className="flex items-center justify-between font-sans">
                <span className="font-semibold text-foreground">Service Worker Health</span>
                <button
                  type="button"
                  onClick={() => void copyDiagnostics()}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  {diagnosticsCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy diagnostics</span>
                    </>
                  )}
                </button>
              </div>
              <div className="space-y-1">
                <div>
                  <span className="text-foreground">Platform:</span>{' '}
                  {diagnosticsHealth?.platform ?? platform}
                </div>
                <div>
                  <span className="text-foreground">Standalone:</span>{' '}
                  {diagnosticsHealth?.standalone ? 'Yes' : 'No'}
                </div>
                <div>
                  <span className="text-foreground">Classification:</span>{' '}
                  {diagnosticsHealth?.classification ?? 'unknown'}
                </div>
                <div>
                  <span className="text-foreground">Scope:</span>{' '}
                  {diagnosticsHealth?.scope ?? 'none'}
                </div>
                <div>
                  <span className="text-foreground">Active Worker:</span>{' '}
                  {diagnosticsHealth?.activeWorker
                    ? `${diagnosticsHealth.activeWorker.scriptURL} (${diagnosticsHealth.activeWorker.state})`
                    : 'none'}
                </div>
                <div>
                  <span className="text-foreground">Waiting Worker:</span>{' '}
                  {diagnosticsHealth?.waitingWorker
                    ? `${diagnosticsHealth.waitingWorker.scriptURL} (${diagnosticsHealth.waitingWorker.state})`
                    : 'none'}
                </div>
                <div>
                  <span className="text-foreground">Installing Worker:</span>{' '}
                  {diagnosticsHealth?.installingWorker
                    ? `${diagnosticsHealth.installingWorker.scriptURL} (${diagnosticsHealth.installingWorker.state})`
                    : 'none'}
                </div>
                <div>
                  <span className="text-foreground">Asset /sw.js:</span>{' '}
                  {diagnosticsHealth?.swAssetStatus ?? 'not checked'}
                </div>
                <div>
                  <span className="text-foreground">Asset /custom-sw.js:</span>{' '}
                  {diagnosticsHealth?.customSwAssetStatus ?? 'not checked'}
                </div>
                {diagnosticsHealth?.lastFailureCode ? (
                  <div>
                    <span className="text-foreground">Failure:</span>{' '}
                    {diagnosticsHealth.lastFailureCode}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {pushState === 'SERVER_UNAVAILABLE' ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 min-h-[44px] w-full gap-2"
          onClick={() => void unsubscribe()}
          disabled={loading}
        >
          <BellOff className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Removing device…' : 'Remove this device'}
        </Button>
      ) : null}

      <div className="border-t border-border pt-3">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="h-11 min-h-[44px] w-full gap-2"
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
    </MobileSettingCard>
  );
}
