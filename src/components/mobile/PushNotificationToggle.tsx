'use client';

import { useState, useEffect } from 'react';
import MobileCard from '@/components/mobile/MobileCard';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

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
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const serviceWorkerPath = '/sw.js';

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      const standalone =
        window.matchMedia?.('(display-mode: standalone)')?.matches ||
        (window.navigator as { standalone?: boolean }).standalone;
      setIsStandalone(Boolean(standalone));
      checkSubscription();
    }
  }, []);

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

  async function checkSubscription() {
    try {
      const registration = await ensureServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (error: unknown) {
      // access denied or no SW is expected outcome in some envs, don't spam
      const msg = error instanceof Error ? error.message : '';
      if (
        msg.includes('Service Worker not available') ||
        msg.includes('Service Worker not supported') ||
        msg.includes('Push requires HTTPS')
      ) {
        setIsSubscribed(false);
        return;
      }
      logger.error('Failed to check push subscription', {
        component: 'PushNotificationToggle',
        error,
      });
    }
  }

  async function subscribe() {
    setLoading(true);
    setError('');
    try {
      if (Notification.permission === 'denied') {
        throw new Error('Notifications blocked. Please enable in device settings.');
      }

      // Race condition to prevent infinite hanging
      const registration = (await Promise.race([
        ensureServiceWorker(),
        new Promise<ServiceWorkerRegistration>((_, reject) =>
          setTimeout(
            () => reject(new Error('Service Worker taking too long. Try reloading.')),
            4000
          )
        ),
      ])) as ServiceWorkerRegistration;

      // Fetch VAPID Key from API (supports DB or Env)
      const keyRes = await fetch('/api/system/vapid-public-key');
      if (!keyRes.ok) {
        throw await errorFromResponse(keyRes, 'VAPID Configuration missing. Please contact admin.');
      }
      const { key: vapidKey } = await keyRes.json();
      const normalized = normalizeVapidKey(String(vapidKey || ''));
      if (normalized.error || !normalized.key) {
        throw new Error(normalized.error || 'Invalid VAPID public key');
      }

      let applicationServerKey: Uint8Array;
      try {
        applicationServerKey = urlBase64ToUint8Array(normalized.key);
      } catch {
        throw new Error('Invalid VAPID public key format. Generate a new VAPID key pair.');
      }
      if (applicationServerKey.length !== 65) {
        throw new Error('Invalid VAPID public key length. Generate a new VAPID key pair.');
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });

      // Send to server
      const res = await fetch('/api/user/push-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });

      if (!res.ok) {
        throw await errorFromResponse(res, 'Failed to save subscription');
      }

      setIsSubscribed(true);
      setError('');
    } catch (error: unknown) {
      logger.error('Push subscription failed', { component: 'PushNotificationToggle', error });
      setError(displayError(error, 'Failed to subscribe'));
      if (Notification.permission === 'denied') {
        setError('Notifications blocked. Please enable in device settings.');
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
        setIsSubscribed(false);
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
      setIsSubscribed(false);
    } catch (error: unknown) {
      logger.error('Failed to unsubscribe from push notifications', {
        component: 'PushNotificationToggle',
        error,
      });
      setError(displayError(error, 'Failed to unsubscribe from push notifications'));
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
    } catch (error: unknown) {
      logger.error('Push test failed', { component: 'PushNotificationToggle', error });
      setTestMessage(displayError(error, 'Failed to send test push.'));
    } finally {
      setIsTesting(false);
    }
  }

  if (!isSupported) return null;

  return (
    <MobileCard padding="md" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-xl">🔔</span>
          <div>
            <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">
              Push Notifications
            </h3>
            <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
              Active incident and page alerts
            </p>
            <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
              {isStandalone
                ? 'Installed PWA detected for best Android push reliability.'
                : 'Tip: Install the app from Chrome ⋮ → Install app for best Android push.'}
            </p>
          </div>
        </div>
        {/* Toggle UI */}
        <button
          type="button"
          onClick={loading ? undefined : isSubscribed ? unsubscribe : subscribe}
          disabled={loading}
          className={cn(
            'flex h-9 min-w-[90px] items-center justify-center rounded-lg px-3 text-xs font-semibold transition',
            loading ? 'cursor-not-allowed opacity-70' : 'active:scale-[0.98]',
            isSubscribed
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : 'bg-primary text-white'
          )}
        >
          {loading ? (
            <div
              className={cn(
                'h-3.5 w-3.5 animate-spin rounded-full border-2',
                isSubscribed
                  ? 'border-red-700 border-t-transparent dark:border-red-300'
                  : 'border-white border-t-transparent'
              )}
            />
          ) : isSubscribed ? (
            'Disable'
          ) : (
            'Enable'
          )}
        </button>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          Error: {error}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={sendTestPush}
          disabled={!isSubscribed || isTesting || loading}
          className={cn(
            'flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition',
            isSubscribed && !isTesting && !loading
              ? 'border-primary/30 bg-primary text-white'
              : 'cursor-not-allowed border-[color:var(--border)] bg-[color:var(--bg-secondary)] text-[color:var(--text-muted)]'
          )}
        >
          {isTesting ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Sending test...
            </>
          ) : (
            <>
              <span className="text-base">🔔</span>
              Send test push
            </>
          )}
        </button>
        {testMessage && (
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-center text-xs font-medium',
              testMessage.includes('successfully') || testMessage.includes('sent')
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300'
            )}
          >
            {testMessage}
          </div>
        )}
      </div>
    </MobileCard>
  );
}
