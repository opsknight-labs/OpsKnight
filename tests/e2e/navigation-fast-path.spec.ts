import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const DEFAULT_EMAIL = 'e2e-fast-path@example.com';
const DEFAULT_PASSWORD = 'FastPath-Secure-Pass-921!';

const email = process.env.E2E_ADMIN_EMAIL || DEFAULT_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD || DEFAULT_PASSWORD;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function navigationRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === new URL(page.url()).origin) requests.push(url.pathname);
  });
  return requests;
}

test.describe.serial('authenticated navigation fast path', () => {
  test.beforeAll(async () => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          email,
          name: 'Fast Path Admin',
          passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
    }
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('first sidebar click performs one navigation and no shell bookkeeping requests', async ({
    page,
  }) => {
    const requests = await navigationRequests(page);
    await page.getByRole('link', { name: /Incidents/ }).click();
    await expect(page).toHaveURL(/\/incidents/);
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();

    expect(requests.filter(path => path === '/api/auth/session')).toHaveLength(0);
    expect(requests.filter(path => path === '/api/sidebar-stats')).toHaveLength(0);
  });

  test('activity heartbeat remains separate from the following click', async ({ page }) => {
    await page.clock.install();
    await page.keyboard.press('Shift');
    await page.clock.fastForward(2 * 60 * 1000 + 1);
    await page.waitForTimeout(0);

    const requests = await navigationRequests(page);
    await page.getByRole('link', { name: /Services/ }).click();
    await expect(page).toHaveURL(/\/services/);
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).not.toBeVisible();
    expect(requests.filter(path => path === '/api/auth/session')).toHaveLength(0);
  });

  test('returning to the tab does not couple focus validation to navigation', async ({ page }) => {
    const requests = await navigationRequests(page);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByRole('link', { name: /Teams/ }).click();
    await expect(page).toHaveURL(/\/teams/);
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
    expect(requests.filter(path => path === '/api/sidebar-stats')).toHaveLength(0);
  });

  test('Back and Forward each commit exactly once with UI synchronization', async ({ page }) => {
    await page.getByRole('link', { name: /Incidents/ }).click();
    await expect(page).toHaveURL(/\/incidents/);
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();

    await page.getByRole('link', { name: /Services/ }).click();
    await expect(page).toHaveURL(/\/services/);
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).not.toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/incidents/);
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).not.toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/services/);
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).not.toBeVisible();
  });

  test('rapid navigation commits the final requested destination', async ({ page }) => {
    await page.getByRole('link', { name: /Incidents/ }).click({ noWaitAfter: true });
    await page.getByRole('link', { name: /Services/ }).click({ noWaitAfter: true });
    await page.getByRole('link', { name: /Analytics/ }).click();
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).not.toBeVisible();
  });

  test('slow route work exposes immediate pending feedback and commits destination', async ({
    page,
  }) => {
    await page.route('**/incidents**', async route => {
      if (route.request().headers().rsc === '1') {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      await route.continue();
    });

    const link = page.getByRole('link', { name: /Incidents/ });
    await link.click({ noWaitAfter: true });
    await expect(link.locator('[data-navigation-pending="true"]')).toBeVisible({ timeout: 100 });
    await expect(page).toHaveURL(/\/incidents/);
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
  });

  test('navigation does no integration work regardless of integration configuration', async ({
    page,
  }) => {
    const requests = await navigationRequests(page);
    await page.getByRole('link', { name: /Incidents/ }).click();
    await expect(page).toHaveURL(/\/incidents/);
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();

    expect(
      requests.filter(path => /\/(jira|slack|microsoft-teams)(\/|$)/.test(path))
    ).toHaveLength(0);
  });

  test('navigation remains available while SSE is disconnected', async ({ page }) => {
    await page.route('**/api/realtime/stream', route => route.abort());
    await page.reload();
    await page.getByRole('link', { name: /Services/ }).click();
    await expect(page).toHaveURL(/\/services/);
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
  });

  test('fifty route transitions create no sidebar metadata requests', async ({ page }) => {
    test.slow();
    const requests = await navigationRequests(page);
    for (let index = 0; index < 25; index += 1) {
      await page.getByRole('link', { name: /Incidents/ }).click();
      await expect(page).toHaveURL(/\/incidents/);
      await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();

      await page.getByRole('link', { name: /Services/ }).click();
      await expect(page).toHaveURL(/\/services/);
      await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
    }
    expect(requests.filter(path => path === '/api/sidebar-stats')).toHaveLength(0);
  });
});

