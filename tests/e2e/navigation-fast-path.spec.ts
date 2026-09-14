import { expect, test, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email!);
  await page.getByLabel(/password/i).fill(password!);
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

test.describe('authenticated navigation fast path', () => {
  test.skip(!email || !password, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.');

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('first sidebar click performs one navigation and no shell bookkeeping requests', async ({
    page,
  }) => {
    const requests = await navigationRequests(page);
    await page.getByRole('link', { name: /Incidents/ }).click();
    await expect(page).toHaveURL(/\/incidents/);

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
    expect(requests.filter(path => path === '/api/auth/session')).toHaveLength(0);
  });

  test('returning to the tab does not couple focus validation to navigation', async ({ page }) => {
    const requests = await navigationRequests(page);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByRole('link', { name: /Teams/ }).click();
    await expect(page).toHaveURL(/\/teams/);
    expect(requests.filter(path => path === '/api/sidebar-stats')).toHaveLength(0);
  });

  test('Back and Forward each commit exactly once', async ({ page }) => {
    await page.getByRole('link', { name: /Incidents/ }).click();
    await expect(page).toHaveURL(/\/incidents/);
    await page.getByRole('link', { name: /Services/ }).click();
    await expect(page).toHaveURL(/\/services/);

    await page.goBack();
    await expect(page).toHaveURL(/\/incidents/);
    await page.goForward();
    await expect(page).toHaveURL(/\/services/);
  });

  test('rapid navigation commits the final requested destination', async ({ page }) => {
    await page.getByRole('link', { name: /Incidents/ }).click({ noWaitAfter: true });
    await page.getByRole('link', { name: /Services/ }).click({ noWaitAfter: true });
    await page.getByRole('link', { name: /Analytics/ }).click();
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('slow route work exposes immediate pending feedback', async ({ page }) => {
    await page.route('**/incidents**', async route => {
      if (route.request().headers().rsc === '1') await new Promise(resolve => setTimeout(resolve, 400));
      await route.continue();
    });

    const link = page.getByRole('link', { name: /Incidents/ });
    await link.click({ noWaitAfter: true });
    await expect(link.locator('[data-navigation-pending="true"]')).toBeVisible({ timeout: 100 });
    await expect(page).toHaveURL(/\/incidents/);
  });

  test('navigation does no integration work regardless of integration configuration', async ({
    page,
  }) => {
    const requests = await navigationRequests(page);
    await page.getByRole('link', { name: /Incidents/ }).click();
    await expect(page).toHaveURL(/\/incidents/);

    expect(
      requests.filter(path => /\/(jira|slack|microsoft-teams)(\/|$)/.test(path))
    ).toHaveLength(0);
  });

  test('navigation remains available while SSE is disconnected', async ({ page }) => {
    await page.route('**/api/realtime/stream', route => route.abort());
    await page.reload();
    await page.getByRole('link', { name: /Services/ }).click();
    await expect(page).toHaveURL(/\/services/);
  });

  test('fifty route transitions create no sidebar metadata requests', async ({ page }) => {
    test.slow();
    const requests = await navigationRequests(page);
    for (let index = 0; index < 25; index += 1) {
      await page.getByRole('link', { name: /Incidents/ }).click();
      await expect(page).toHaveURL(/\/incidents/);
      await page.getByRole('link', { name: /Services/ }).click();
      await expect(page).toHaveURL(/\/services/);
    }
    expect(requests.filter(path => path === '/api/sidebar-stats')).toHaveLength(0);
  });
});
