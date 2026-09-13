import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test.describe('mobile PWA browser contract', () => {
  test.beforeAll(async () => {
    // The login page intentionally redirects a truly empty installation to setup.
    // This fixture establishes only the post-bootstrap state; no reusable browser
    // credential is created by this responsive/PWA suite.
    await prisma.user.upsert({
      where: { email: 'mobile-pwa-fixture@example.invalid' },
      update: { status: 'ACTIVE' },
      create: {
        email: 'mobile-pwa-fixture@example.invalid',
        name: 'Mobile PWA Fixture',
        role: 'USER',
        status: 'ACTIVE',
      },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('mobile compatibility login renders the canonical auth surface without clipping', async ({
    page,
  }) => {
    await page.goto('/m/login?callbackUrl=%2Fm');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('auth surface survives phone portrait and landscape without horizontal overflow', async ({
    page,
  }) => {
    await page.goto('/login');
    await assertNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 844, height: 390 });
    await page.reload();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('protected mobile navigation preserves a safe same-origin callback', async ({ page }) => {
    await page.goto('/m/incidents');
    await expect(page).toHaveURL(/\/login\?/);
    const current = new URL(page.url());
    expect(current.origin).toBe('http://127.0.0.1:3100');
    expect(current.searchParams.get('callbackUrl')).toBe('/m/incidents');
  });

  test('manifest permits adaptive orientation and exposes responder shortcuts', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      start_url?: string;
      orientation?: string;
      display?: string;
      shortcuts?: Array<{ url?: string }>;
    };

    expect(manifest.start_url).toBe('/m');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBeUndefined();
    expect(manifest.shortcuts?.some(shortcut => shortcut.url === '/m/incidents?filter=all_open')).toBe(
      true
    );
    expect(manifest.shortcuts?.some(shortcut => shortcut.url === '/m/schedules')).toBe(true);
    expect(manifest.shortcuts?.some(shortcut => shortcut.url === '/m/notifications')).toBe(true);
  });
});
