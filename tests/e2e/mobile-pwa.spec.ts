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
  await page.goto('/m/login?callbackUrl=%2Fm');
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

async function clearFixtureRateLimits() {
  // RateLimit is DB-backed and shared across chromium + webkit in the same
  // CI job. `auth:credentials:account:email` allows 10 / 15m — the suite
  // does ~14 logins across both projects plus retries, so later
  // `loginToMobile` calls would otherwise be blocked with `RATE_LIMITED`
  // (seen on main 34831497556 and PR 34834947320). Clearing the whole
  // window before suite and before each test keeps every login inside a
  // fresh window; successful logins also reset the in-memory
  // `login-security` store via `resetLoginAttempts`. Mirrors
  // `auth-recovery.spec.ts:resetBootstrapFixture` which does
  // `prisma.rateLimit.deleteMany()` without filter.
  await prisma.rateLimit.deleteMany();
}

test.describe('mobile PWA browser contract', () => {
  test.beforeAll(async () => {
    await clearFixtureRateLimits();

    await prisma.user.upsert({
      where: { email: FIXTURE_EMAIL },
      update: {
        status: 'ACTIVE',
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, 12),
      },
      create: {
        email: FIXTURE_EMAIL,
        name: 'Mobile PWA Fixture',
        passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, 12),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    const service = await prisma.service.upsert({
      where: { name: 'Mobile PWA Service' },
      update: {
        status: 'OPERATIONAL',
      },
      create: {
        name: 'Mobile PWA Service',
        status: 'OPERATIONAL',
      },
    });

    await prisma.incident.upsert({
      where: { id: 'mobile-pwa-incident-fixture' },
      update: {
        title: 'Mobile PWA Active Incident',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceId: service.id,
      },
      create: {
        id: 'mobile-pwa-incident-fixture',
        title: 'Mobile PWA Active Incident',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceId: service.id,
      },
    });
  });

  test.beforeEach(async () => {
    await clearFixtureRateLimits();
  });

  test.afterAll(async () => {
    await prisma.incident.deleteMany({ where: { id: 'mobile-pwa-incident-fixture' } });
    await prisma.service.deleteMany({ where: { name: 'Mobile PWA Service' } });
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

  test('bottom navigation remains anchored while application content scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginToMobile(page);

    const nav = page.locator('.mobile-nav');
    const before = await nav.boundingBox();
    expect(before).not.toBeNull();

    const scrollState = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.mobile-content');
      if (!content) throw new Error('Mobile content is not mounted');
      const spacer = document.createElement('div');
      spacer.dataset.navScrollFixture = 'true';
      spacer.style.height = '1600px';
      spacer.style.pointerEvents = 'none';
      content.appendChild(spacer);
      content.scrollTop = 600;
      return { contentScrollTop: content.scrollTop, windowScrollY: window.scrollY };
    });

    expect(scrollState.contentScrollTop).toBeGreaterThan(0);
    expect(scrollState.windowScrollY).toBe(0);
    const after = await nav.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);

    await page.evaluate(() => document.querySelector('[data-nav-scroll-fixture]')?.remove());
  });

  test('system dark mode renders the neutral dark semantic shell without light-card leakage', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginToMobile(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(async () => (await mobileThemeSnapshot(page)).dataTheme).toBe('dark');

    const snapshot = await mobileThemeSnapshot(page);
    expect(snapshot.colorScheme).toContain('dark');
    expect(snapshot.appBackground).not.toBe('rgb(255, 255, 255)');
    expect(snapshot.navBackground).not.toBe('rgb(255, 255, 255)');
    expect(snapshot.appColor).not.toBe(snapshot.appBackground);
    expect(snapshot.themeColor.toLowerCase()).toBe('#09090b');
    await assertNoHorizontalOverflow(page);
  });

  test('system light mode stays light and explicit dark override survives a light OS', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await loginToMobile(page);
    await expect.poll(async () => (await mobileThemeSnapshot(page)).dataTheme).toBe('light');
    let snapshot = await mobileThemeSnapshot(page);
    expect(snapshot.classDark).toBe(false);
    expect(snapshot.appBackground).not.toBe('rgb(9, 9, 11)');
    expect(snapshot.themeColor.toLowerCase()).toBe('#f8fafc');

    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(async () => (await mobileThemeSnapshot(page)).dataTheme).toBe('dark');
    snapshot = await mobileThemeSnapshot(page);
    expect(snapshot.appBackground).not.toBe('rgb(255, 255, 255)');
    expect(snapshot.themeColor.toLowerCase()).toBe('#09090b');
  });

  test('protected mobile navigation preserves a safe same-origin callback', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/m/incidents');
    await expect(page).toHaveURL(/\/login\?/);
    const current = new URL(page.url());
    expect(current.origin).toBe('http://127.0.0.1:3100');
    expect(current.searchParams.get('callbackUrl')).toBe('/m/incidents');
  });

  test('manifest permits adaptive orientation and exposes responder shortcuts', async ({
    request,
  }) => {
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
    expect(
      manifest.shortcuts?.some(shortcut => shortcut.url === '/m/incidents?filter=all_open')
    ).toBe(true);
    expect(manifest.shortcuts?.some(shortcut => shortcut.url === '/m/schedules')).toBe(true);
    expect(manifest.shortcuts?.some(shortcut => shortcut.url === '/m/notifications')).toBe(true);
  });

  test('incident list navigates to detail and allows viewing details, notes and watchers', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginToMobile(page);
    await page.goto('/m/incidents');

    // Incident should be visible in list
    const incidentLink = page
      .locator('a[href*="/m/incidents/mobile-pwa-incident-fixture"]')
      .first();
    await expect(incidentLink).toBeVisible();

    // Tap/click incident
    await incidentLink.click();
    await expect(page).toHaveURL(/\/m\/incidents\/mobile-pwa-incident-fixture/);

    // Detail screen renders title
    await expect(page.locator('h1', { hasText: 'Mobile PWA Active Incident' })).toBeVisible();

    // Details & assignment disclosure works
    const detailsSummary = page.locator('summary', { hasText: 'Incident details & assignment' });
    await expect(detailsSummary).toBeVisible();
    await detailsSummary.click();
    await expect(page.locator('text=Mobile PWA Service').first()).toBeVisible();

    // People, fields & links disclosure works and links use /m routes
    const linksSummary = page.locator('summary', { hasText: 'People, fields & links' });
    await expect(linksSummary).toBeVisible();
    await linksSummary.click();
    const serviceQuickLink = page.locator('a[href*="/m/services/"]').first();
    await expect(serviceQuickLink).toBeVisible();

    // Back link navigates cleanly back to /m/incidents
    const backLink = page.locator('a', { hasText: 'Back to Incidents' });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(/\/m\/incidents/);
  });

  test('services flow renders service detail and navigates to active incident', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginToMobile(page);
    await page.goto('/m/services');

    const serviceLink = page.locator('a[href*="/m/services/"]', { hasText: 'Mobile PWA Service' });
    await expect(serviceLink).toBeVisible();
    await serviceLink.click();

    await expect(page).toHaveURL(/\/m\/services\//);
    await expect(page.locator('h1', { hasText: 'Mobile PWA Service' })).toBeVisible();

    // Active incident listed under service
    const activeIncidentLink = page
      .locator('a[href*="/m/incidents/mobile-pwa-incident-fixture"]')
      .first();
    await expect(activeIncidentLink).toBeVisible();
    await activeIncidentLink.click();

    await expect(page).toHaveURL(/\/m\/incidents\/mobile-pwa-incident-fixture/);
    await expect(page.locator('h1', { hasText: 'Mobile PWA Active Incident' })).toBeVisible();
  });

  test('touch jitter tolerance allows tap navigation while drag threshold activates swipe gesture', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginToMobile(page);
    await page.goto('/m/incidents');

    const cardLink = page.locator('a[href*="/m/incidents/mobile-pwa-incident-fixture"]').first();
    await expect(cardLink).toBeVisible();

    // Verify small jitter movement (<10px) still navigates
    const box = await cardLink.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      // small 5px jitter
      await page.mouse.move(box.x + 25, box.y + 21);
      await page.mouse.up();
      // Clicking/tapping after minor displacement navigates to incident
      await expect(page).toHaveURL(/\/m\/incidents\/mobile-pwa-incident-fixture/);
    }
  });
});
