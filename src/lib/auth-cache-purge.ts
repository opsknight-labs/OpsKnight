import { fetchWithTimeout } from '@/lib/client-timeout';
import { purgeMobileCacheStorage } from '@/lib/mobile-cache';
import { purgeOfflineQueueStorage } from '@/lib/offline-queue';

export const DYNAMIC_AUTH_CACHE_PATTERNS = [
  'pages',
  'pages-rsc',
  'pages-rsc-prefetch',
  'start-url',
  'apis',
  'no-cache-pages',
  'no-cache-rsc',
];

/**
 * Ends this browser's Web Push subscription: server row first, while the session still
 * authenticates the request, then the browser subscription (which kills the endpoint even if the
 * server call failed). Otherwise the signed-out account keeps receiving pages here, and the next
 * person to sign in can act on them.
 */
async function releaseWebPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await fetchWithTimeout(
      '/api/user/push-subscription',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        credentials: 'include',
      },
      4_000
    ).catch(() => {});
    await subscription.unsubscribe();
  } catch {
    // Best-effort: sign-out must not wait on the push service.
  }
}

/**
 * Purges every browser-resident authenticated authority boundary. In addition to
 * CacheStorage this destroys principal-scoped responder ciphertext, its AES key
 * material, and queued mutations so an account switch can never inherit another
 * responder's offline state.
 */
export async function purgeBrowserAuthCaches(
  options: { releasePush?: boolean } = {}
): Promise<void> {
  if (typeof window === 'undefined') return;

  // Only an explicit sign-out releases push: a sign-in must not drop its own account's subscription.
  if (options.releasePush) await releaseWebPush();
  await Promise.allSettled([purgeMobileCacheStorage(), purgeOfflineQueueStorage()]);

  if ('caches' in window) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames
          .filter(name => DYNAMIC_AUTH_CACHE_PATTERNS.some(pattern => name.includes(pattern)))
          .map(name => window.caches.delete(name))
      );
    } catch (error) {
      console.warn('[AuthCache] Failed to purge browser auth caches:', error);
    }
  }

  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PURGE_AUTH_CACHES' });
    }
  } catch {
    // Cleanup remains best-effort; login/logout navigation must not deadlock.
  }
}
