/**
 * Auth Cache Purge Utility
 *
 * Safely purges any Service Worker dynamic page and RSC caches from browser
 * CacheStorage during authentication lifecycle events (login, logout, session expiration).
 * This prevents stale redirect loops and orphaned unauthenticated shells.
 */

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
 * Purges dynamic/auth-related caches from the browser's CacheStorage.
 * Safe to call in any browser context (handles missing caches API gracefully).
 */
export async function purgeBrowserAuthCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  try {
    const cacheNames = await window.caches.keys();
    const purgePromises = cacheNames
      .filter(name => DYNAMIC_AUTH_CACHE_PATTERNS.some(pattern => name.includes(pattern)))
      .map(name => window.caches.delete(name));

    await Promise.all(purgePromises);
  } catch (error) {
    // Non-critical cache cleanup failure should never block UI navigation
    console.warn('[AuthCache] Failed to purge browser auth caches:', error);
  }

  // Also post message to Service Worker if active
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PURGE_AUTH_CACHES' });
    }
  } catch {
    // Non-critical
  }
}
