import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test.describe('production PWA service-worker contract', () => {
  test.beforeAll(async () => {
    // Login redirects an empty installation to setup. Seed only the bootstrap
    // boundary; this suite does not create reusable browser credentials.
    await prisma.user.upsert({
      where: { email: 'mobile-pwa-production@example.invalid' },
      update: { status: 'ACTIVE' },
      create: {
        email: 'mobile-pwa-production@example.invalid',
        name: 'Mobile PWA Production Fixture',
        role: 'USER',
        status: 'ACTIVE',
      },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('generated worker controls the app, avoids dynamic caches, and serves a cached static asset offline', async ({
    page,
    request,
    context,
  }) => {
    const workerResponse = await request.get('/sw.js');
    expect(workerResponse.ok()).toBe(true);
    const workerText = await workerResponse.text();
    expect(workerText).toMatch(/custom-sw\.js/);

    await page.goto('/login');
    await expect(page.locator('img[alt="OpsKnight"]')).toBeVisible();

    const registration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;

      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (!ready) return null;

      return {
        scope: ready.scope,
        scriptURL:
          ready.active?.scriptURL ?? ready.waiting?.scriptURL ?? ready.installing?.scriptURL ?? null,
      };
    });

    expect(registration).not.toBeNull();
    expect(registration?.scope).toBe('http://127.0.0.1:3100/');
    expect(registration?.scriptURL).toContain('/sw.js');

    // First navigation may register the worker after the document request. Reload
    // once so the production page is demonstrably controlled by the generated SW.
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(
      true
    );
    await expect(page.locator('img[alt="OpsKnight"]')).toBeVisible();

    // Authenticated/dynamic documents, APIs, and RSC responses are authoritative
    // network data and must not leak into CacheStorage.
    const forbiddenCachedUrls = await page.evaluate(async () => {
      const hits: string[] = [];
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const cachedRequest of await cache.keys()) {
          const url = new URL(cachedRequest.url);
          if (
            url.pathname === '/login' ||
            url.pathname === '/m' ||
            url.pathname.startsWith('/m/') ||
            url.pathname.startsWith('/api/') ||
            url.searchParams.has('_rsc')
          ) {
            hits.push(`${url.pathname}${url.search}`);
          }
        }
      }
      return hits;
    });
    expect(forbiddenCachedUrls).toEqual([]);

    // /logo.png is an immutable-ish application asset and is intentionally
    // runtime cached. Prove the generated worker can serve it without network.
    await page.evaluate(async () => {
      const response = await fetch('/logo.png');
      if (!response.ok) throw new Error(`Unable to prime logo cache: ${response.status}`);
    });

    await context.setOffline(true);
    const staticAssetAvailableOffline = await page.evaluate(async () => {
      try {
        const response = await fetch('/logo.png');
        return response.ok;
      } catch {
        return false;
      }
    });
    expect(staticAssetAvailableOffline).toBe(true);
    await context.setOffline(false);
  });
});
