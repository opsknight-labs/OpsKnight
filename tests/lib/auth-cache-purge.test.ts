import { describe, it, expect, vi, afterEach } from 'vitest';
import { purgeBrowserAuthCaches, DYNAMIC_AUTH_CACHE_PATTERNS } from '@/lib/auth-cache-purge';

describe('purgeBrowserAuthCaches', () => {
  const originalWindow = global.window;

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  it('safely handles missing window in SSR environment without error', async () => {
    // @ts-expect-error simulating SSR
    delete global.window;
    await expect(purgeBrowserAuthCaches()).resolves.toBeUndefined();
  });

  it('safely handles missing caches API in browser without error', async () => {
    global.window = {} as unknown as Window & typeof globalThis;
    await expect(purgeBrowserAuthCaches()).resolves.toBeUndefined();
  });

  it('purges dynamic auth cache keys matching patterns', async () => {
    const mockDelete = vi.fn().mockResolvedValue(true);
    const mockKeys = vi
      .fn()
      .mockResolvedValue([
        'pages-rsc-v1',
        'pages-v1',
        'google-fonts-webfonts',
        'next-static-assets',
        'start-url-v1',
        'apis-v1',
      ]);

    global.window = {
      caches: {
        keys: mockKeys,
        delete: mockDelete,
      } as unknown as CacheStorage,
    } as unknown as Window & typeof globalThis;

    await purgeBrowserAuthCaches();

    expect(mockKeys).toHaveBeenCalled();
    // Should delete: pages-rsc-v1, pages-v1, start-url-v1, apis-v1
    // Should NOT delete: google-fonts-webfonts, next-static-assets
    expect(mockDelete).toHaveBeenCalledWith('pages-rsc-v1');
    expect(mockDelete).toHaveBeenCalledWith('pages-v1');
    expect(mockDelete).toHaveBeenCalledWith('start-url-v1');
    expect(mockDelete).toHaveBeenCalledWith('apis-v1');
    expect(mockDelete).not.toHaveBeenCalledWith('google-fonts-webfonts');
    expect(mockDelete).not.toHaveBeenCalledWith('next-static-assets');
    expect(mockDelete).toHaveBeenCalledTimes(4);
  });

  it('notifies active service worker controller if available', async () => {
    const mockPostMessage = vi.fn();
    const mockDelete = vi.fn().mockResolvedValue(true);
    const mockKeys = vi.fn().mockResolvedValue(['pages']);

    global.window = {
      caches: {
        keys: mockKeys,
        delete: mockDelete,
      } as unknown as CacheStorage,
    } as unknown as Window & typeof globalThis;

    global.navigator = {
      serviceWorker: {
        controller: {
          postMessage: mockPostMessage,
        } as unknown as ServiceWorker,
      } as unknown as ServiceWorkerContainer,
    } as unknown as Navigator;

    await purgeBrowserAuthCaches();

    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'PURGE_AUTH_CACHES' });
  });

  it('releases this browser push subscription on sign-out, server first, but not on sign-in', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    global.window = {} as unknown as Window & typeof globalThis;
    global.navigator = {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi
              .fn()
              .mockResolvedValue({ endpoint: 'https://push.example.com/abc', unsubscribe }),
          },
        }),
      } as unknown as ServiceWorkerContainer,
    } as unknown as Navigator;

    await purgeBrowserAuthCaches();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();

    await purgeBrowserAuthCaches({ releasePush: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/user/push-subscription',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ endpoint: 'https://push.example.com/abc' }),
      })
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('verifies DYNAMIC_AUTH_CACHE_PATTERNS contains critical keys', () => {
    expect(DYNAMIC_AUTH_CACHE_PATTERNS).toContain('pages');
    expect(DYNAMIC_AUTH_CACHE_PATTERNS).toContain('pages-rsc');
    expect(DYNAMIC_AUTH_CACHE_PATTERNS).toContain('pages-rsc-prefetch');
    expect(DYNAMIC_AUTH_CACHE_PATTERNS).toContain('start-url');
    expect(DYNAMIC_AUTH_CACHE_PATTERNS).toContain('apis');
  });
});
