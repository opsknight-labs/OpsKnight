import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const FIXTURE_EMAIL = 'mobile-pwa-fixture@example.invalid';
const FIXTURE_PASSWORD = 'Mobile-pwa-harbor-472!';

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function loginToMobile(page: import('@playwright/test').Page) {
  await page.goto('/login?callbackUrl=%2Fm');
  await page.locator('input[type="email"]').fill(FIXTURE_EMAIL);
  await page.locator('input[type="password"]').fill(FIXTURE_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/m(?:$|\?)/, { timeout: 30_000 });
  await expect(page.locator('.mobile-nav')).toBeVisible();
}

async function mobileThemeSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector<HTMLElement>('.mobile-app');
    const nav = document.querySelector<HTMLElement>('.mobile-nav');
    if (!app || !nav) throw new Error('Mobile shell is not mounted');
    const appStyle = getComputedStyle(app);
    const navStyle = getComputedStyle(nav);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    return {
      classDark: root.classList.contains('dark'),
      dataTheme: root.dataset.theme,
      colorScheme: root.style.colorScheme || getComputedStyle(root).colorScheme,
      appBackground: appStyle.backgroundColor,
      appColor: appStyle.color,
      navBackground: navStyle.backgroundColor,
      navColor: navStyle.color,
      themeColor: meta?.content ?? '',
    };
  });
}

test.describe('mobile PWA browser contract', () => {
  test.beforeAll(async () => {
    await prisma.user.upsert({
      where: { email: FIXTURE_EMAIL },
      update: {
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, 12),
      },
      create: {
        email: FIXTURE_EMAIL,
        name: 'Mobile PWA Fixture',
        passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, 12),
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

  test('authenticated shell stays distortion-free from narrow phone through landscape', async ({
    page,
  }) => {
    await loginToMobile(page);

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload();
      await expect(page.locator('.mobile-nav')).toBeVisible();
      await assertNoHorizontalOverflow(page);

      const navTargets = await page.locator('.mobile-nav a').evaluateAll(nodes =>
        nodes.map(node => {
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })
      );
      expect(navTargets.length).toBeGreaterThan(0);
      for (const target of navTargets) {
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.width).toBeGreaterThan(0);
      }
    }
  });

  test('system dark mode renders dark semantic shell without light-card leakage', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginToMobile(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(async () => (await mobileThemeSnapshot(page)).dataTheme).toBe('dark');

    const snapshot = await mobileThemeSnapshot(page);
    expect(snapshot.colorScheme).toContain('dark');
    expect(snapshot.appBackground).not.toBe('rgb(255, 255, 255)');
    expect(snapshot.navBackground).not.toBe('rgb(255, 255, 255)');
    expect(snapshot.appColor).not.toBe(snapshot.appBackground);
    expect(snapshot.themeColor.toLowerCase()).toBe('#020617');
    await assertNoHorizontalOverflow(page);
  });

  test('system light mode stays light and explicit dark override survives a light OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await loginToMobile(page);
    await expect.poll(async () => (await mobileThemeSnapshot(page)).dataTheme).toBe('light');
    let snapshot = await mobileThemeSnapshot(page);
    expect(snapshot.classDark).toBe(false);
    expect(snapshot.appBackground).not.toBe('rgb(2, 6, 23)');
    expect(snapshot.themeColor.toLowerCase()).toBe('#f8fafc');

    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(async () => (await mobileThemeSnapshot(page)).dataTheme).toBe('dark');
    snapshot = await mobileThemeSnapshot(page);
    expect(snapshot.appBackground).not.toBe('rgb(255, 255, 255)');
    expect(snapshot.themeColor.toLowerCase()).toBe('#020617');
  });

  test('protected mobile navigation preserves a safe same-origin callback', async ({ page }) => {
    await page.context().clearCookies();
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
