'use client';

import { useState, useEffect, useCallback } from 'react';
import MobileCard from '@/components/mobile/MobileCard';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { haptics } from '@/lib/haptics';

export type PushState =
  | 'UNSUPPORTED'
  | 'INSTALL_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'REGISTERING'
  | 'REGISTERED'
  | 'REPAIR_REQUIRED'
  | 'ERROR';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, char => char.charCodeAt(0));
}

function normalizeVapidKey(rawKey: string) {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return { error: 'Push notifications not configured (missing VAPID key)' };
  }

  if (trimmed.includes('BEGIN PUBLIC KEY') || trimmed.includes('END PUBLIC KEY')) {
    return { error: 'Invalid VAPID public key. Use the base64url public key, not a PEM block.' };
  }

  let cleaned = trimmed.replace(/^['"]|['"]$/g, '').replace(/\s+/g, '');
  cleaned = cleaned.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  if (!/^[A-Za-z0-9\-_]+$/.test(cleaned)) {
    return { error: 'Invalid VAPID public key format.' };
  }

  return { key: cleaned };
}

function displayError(error: unknown, fallback: string): string {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description || friendly.title;
}

export default function PushNotificationToggle() {
  const [pushState, setPushState] = useState<PushState>('PERMISSION_REQUIRED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [isStandalone, setIsStandalone] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  const serviceWorkerPath = '/sw.js';

  const checkSupportAndState = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // Detect platform
    const userAgent = navigator.userAgent || '';
    const isIOSDevice =
      /iPad|iPhone|iPod/.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroidDevice = /Android/.test(userAgent);

    if (isIOSDevice) setPlatform('ios');
    else if (isAndroidDevice) setPlatform('android');
    else setPlatform('desktop');

    const standalone = Boolean(
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as { standalone?: boolean }).standalone
    );
    setIsStandalone(standalone);

    // iOS WebKit Web Push requires being installed to Home Screen (iOS 16.4+)
    if (isIOSDevice && !standalone) {
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

    // Permission is granted, verify browser subscription and reconcile with server
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (!subscription) {
        setPushState('PERMISSION_REQUIRED');
        return;
      }

      // Reconcile with server UserDevice and account preference
      const checkRes = await fetch(
        `/api/user/push-subscription?endpoint=${encodeURIComponent(subscription.endpoint)}`
      );
      if (checkRes.ok) {
        const data = await checkRes.json();
        if (data.deviceRegistered && data.accountEnabled) {
          setPushState('REGISTERED');
        } else {
          setPushState('REPAIR_REQUIRED');
        }
      } else {
        setPushState('REGISTERED');
      }
    } catch {
      setPushState('PERMISSION_REQUIRED');
    }
  }, []);

  useEffect(() => {
    void checkSupportAndState();
  }, [checkSupportAndState]);

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Worker not supported');
    }
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      throw new Error('Push requires HTTPS. Please use a secure origin.');
    }
    const existing = await navigator.serviceWorker.getRegistration();
    const targetUrl = new URL(serviceWorkerPath, window.location.origin).toString();
    const existingUrl = existing?.active?.scriptURL;
    const shouldRegister = !existing || !existingUrl || existingUrl !== targetUrl;
    let registration = existing;
    if (shouldRegister) {
      try {
        registration = await navigator.serviceWorker.register(serviceWorkerPath, { scope: '/' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Service Worker registration failed.';
        throw new Error(
          message.includes('404') || message.includes('Failed to register')
            ? 'PWA service worker not available. Please enable PWA in production.'
            : message
        );
      }
    }
    await navigator.serviceWorker.ready;
    if (!registration) {
      throw new Error('Service Worker not available.');
    }
    return registration;
  }

  async function subscribeOrRepair() {
    setLoading(true);
    setError('');
    setPushState('REGISTERING');

    try {
      // 1. MUST request permission inside user gesture for iOS WebKit & Safari compatibility
      let permission = Notification.permission;
      if (permission !== 'granted') {
        permission = await Notification.requestPermission();
      }

      if (permission === 'denied') {
        setPushState('PERMISSION_DENIED');
        setError('Notifications blocked. Please enable in device settings.');
        return;
      }

      if (permission !== 'granted') {
        setPushState('PERMISSION_REQUIRED');
        return;
      }

      // 2. Ensure Service Worker
      const registration = await ensureServiceWorker();

      // 3. Fetch VAPID key
      const keyRes = await fetch('/api/system/vapid-public-key');
      if (!keyRes.ok) {
        throw await errorFromResponse(keyRes, 'VAPID Configuration missing. Please contact admin.');
      }
      const { key: vapidKey } = await keyRes.json();
      const normalized = normalizeVapidKey(String(vapidKey || ''));
      if (normalized.error || !normalized.key) {
        throw new Error(normalized.error || 'Invalid VAPID public key');
      }

      const applicationServerKey = urlBase64ToUint8Array(normalized.key);
      if (applicationServerKey.length !== 65) {
        throw new Error('Invalid VAPID public key length. Generate a new VAPID key pair.');
      }

      // 4. Subscribe
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      }

      // 5. Send to OpsKnight Server
      const res = await fetch('/api/user/push-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });

      if (!res.ok) {
        throw await errorFromResponse(res, 'Failed to save subscription');
      }

      setPushState('REGISTERED');
      haptics.success();
      setError('');
    } catch (err: unknown) {
      logger.error('Push subscription failed', { component: 'PushNotificationToggle', error: err });
      setError(displayError(err, 'Failed to subscribe'));
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setPushState('PERMISSION_DENIED');
        setError('Notifications blocked. Please enable in device settings.');
      } else {
        setPushState('ERROR');
      }
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      const registration = await ensureServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setPushState('PERMISSION_REQUIRED');
        return;
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      const response = await fetch('/api/user/push-subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });

      if (!response.ok) {
        throw await errorFromResponse(response, 'Failed to remove subscription');
      }
      setPushState('PERMISSION_REQUIRED');
      haptics.selection();
    } catch (err: unknown) {
      logger.error('Failed to unsubscribe from push notifications', {
        component: 'PushNotificationToggle',
        error: err,
      });
      setError(displayError(err, 'Failed to unsubscribe from push notifications'));
    } finally {
      setLoading(false);
    }
  }

  async function sendTestPush() {
    setIsTesting(true);
    setTestMessage('');
    try {
      const response = await fetch('/api/notifications/test-push', { method: 'POST' });
      if (!response.ok) {
        throw await errorFromResponse(response, 'Failed to send test push.');
      }
      const data = (await response.json()) as { message?: string };
      setTestMessage(data.message || 'Test push sent. Check your device.');
    } catch (err: unknown) {
      logger.error('Push test failed', { component: 'PushNotificationToggle', error: err });
      setTestMessage(displayError(err, 'Failed to send test push.'));
    } finally {
      setIsTesting(false);
    }
  }

  if (pushState === 'UNSUPPORTED') return null;

  const isRegistered = pushState === 'REGISTERED';
  const isRepair = pushState === 'REPAIR_REQUIRED';

  const platformHint =
    platform === 'ios'
      ? isStandalone
        ? 'Installed iOS Web App ready for push notifications.'
        : 'On iPhone, tap Share (⎋) → "Add to Home Screen" to enable native Push.'
      : platform === 'android'
        ? isStandalone
          ? 'Installed PWA detected for best background push delivery.'
          : 'Tip: Install via Chrome menu for best background push reliability.'
        : 'Browser push notifications for active incidents and alerts.';

  return (
    <MobileCard padding="md" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">
            🔔
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Push Notifications</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Active incident and page alerts</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{platformHint}</p>
          </div>
        </div>

        {/* Action button based on state */}
        {pushState === 'INSTALL_REQUIRED' ? (
          <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            Install PWA
          </span>
        ) : pushState === 'PERMISSION_DENIED' ? (
          <span className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            Blocked
          </span>
        ) : (
          <button
            type="button"
            onClick={loading ? undefined : isRegistered ? unsubscribe : subscribeOrRepair}
            disabled={loading}
            className={cn(
              'flex h-9 min-w-[90px] items-center justify-center rounded-lg px-3 text-xs font-semibold transition',
              loading ? 'cursor-not-allowed opacity-70' : 'active:scale-[0.98]',
              isRegistered
                ? 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950/50 dark:text-rose-300'
                : isRepair
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {loading ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : isRegistered ? (
              'Disable'
            ) : isRepair ? (
              'Repair'
            ) : (
              'Enable'
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
          Error: {error}
        </div>
      )}

      {/* Test Notification Action */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={sendTestPush}
          disabled={!isRegistered || isTesting || loading}
          className={cn(
            'flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition',
            isRegistered && !isTesting && !loading
              ? 'border-border bg-card text-foreground hover:bg-accent'
              : 'cursor-not-allowed border-border/50 bg-muted/30 text-muted-foreground opacity-60'
          )}
        >
          {isTesting ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>Sending test…</span>
            </>
          ) : (
            <>
              <span className="text-base" aria-hidden="true">
                🔔
              </span>
              <span>Send test push</span>
            </>
          )}
        </button>

        {testMessage && (
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-center text-xs font-medium',
              testMessage.includes('successfully') || testMessage.includes('sent')
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300'
            )}
          >
            {testMessage}
          </div>
        )}
      </div>
    </MobileCard>
  );
}
