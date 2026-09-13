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
 * Purges every browser-resident authenticated authority boundary. In addition to
 * CacheStorage this destroys principal-scoped responder ciphertext, its AES key
 * material, and queued mutations so an account switch can never inherit another
 * responder's offline state.
 */
export async function purgeBrowserAuthCaches(): Promise<void> {
  if (typeof window === 'undefined') return;

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
