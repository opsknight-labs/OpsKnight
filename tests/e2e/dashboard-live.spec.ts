import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * Live Incidents dashboard certification. Observers are a scoped "Dashboard Alpha" responder;
 * every mutation goes through the real browser APIs as the seeded admin, so the realtime
 * pipeline (DB trigger -> change clock -> SSE -> panel reconcile) is exercised end to end.
 */

const ADMIN = { email: 'admin@example.com', password: 'Password123!' };
const ALPHA = { email: 'dashboard-alpha@example.local', password: 'Password123!' };
const EMPTY = { email: 'dashboard-empty@example.local', password: 'Password123!' };
const LATENCY_BUDGET_MS = Number(process.env.LIVE_LATENCY_BUDGET_MS || 2_000);

const prisma = new PrismaClient();

function assertIsolatedDatabase() {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
  const allowed = process.env.DASHBOARD_SEED_ALLOW_DB ?? 'opsknight_dashboard';
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== `/${allowed}`) {
    throw new Error('Dashboard certification only runs against the isolated local database.');
  }
}

function seed(scenario: 'empty' | 'normal' | 'busy' | 'stress', count?: number) {
  execFileSync(
    'npx',
    [
      'ts-node',
      '--project',
      'tsconfig.script.json',
      'scripts/dev/seed-dashboard-live.ts',
      `--scenario=${scenario}`,
      ...(count ? [`--count=${count}`] : []),
    ],
    { stdio: 'pipe', env: process.env }
  );
}

function contextOptions(testInfo: TestInfo) {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } =
    testInfo.project.use;
  return {
    baseURL,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    serviceWorkers: 'block' as const,
  };
}

async function signIn(
  browser: Browser,
  user: { email: string; password: string },
  testInfo: TestInfo
): Promise<{ context: BrowserContext; page: Page }> {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: user.email } } });
  const isMobile = testInfo.project.name.startsWith('mobile');
  const context = await browser.newContext(contextOptions(testInfo));
  if (isMobile) {
    // Phones are routed to the /m PWA by default; certify the responsive desktop dashboard.
    const { hostname } = new URL(String(testInfo.project.use.baseURL));
    await context.addCookies([
      { name: 'prefer-desktop', value: 'true', domain: hostname, path: '/' },
    ]);
  }
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  return { context, page };
}

async function openDashboard(page: Page) {
  await page.goto('/');
  const panel = page.getByTestId('live-incidents-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-connection', 'live');
  return panel;
}

async function serviceId(name: string) {
  const service = await prisma.service.findUniqueOrThrow({ where: { name }, select: { id: true } });
  return service.id;
}

async function adminRequest(
  request: APIRequestContext,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
  headers: Record<string, string> = {}
) {
  const origin = new URL(path, test.info().project.use.baseURL as string).origin;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.fetch(path, {
      method,
      data,
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    });
    if (response.status() === 429) {
      await new Promise(resolve =>
        setTimeout(resolve, Number(response.headers()['retry-after'] || 5) * 1000)
      );
      continue;
    }
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return (await response.json()) as { data?: { id?: string; incident?: { id: string } } };
  }
  throw new Error(`${method} ${path} kept hitting the rate limit`);
}

async function createIncident(
  request: APIRequestContext,
  input: { title: string; service: string; urgency?: 'HIGH' | 'MEDIUM' | 'LOW'; priority?: string }
): Promise<string> {
  await adminRequest(
    request,
    'POST',
    '/api/incidents/create',
    {
      title: input.title,
      serviceId: await serviceId(input.service),
      urgency: input.urgency ?? 'HIGH',
      priority: input.priority ?? 'P1',
    },
    { 'Idempotency-Key': randomUUID() }
  );
  const created = await prisma.incident.findFirstOrThrow({
    where: { title: input.title },
    select: { id: true },
  });
  return created.id;
}

const patchIncident = (request: APIRequestContext, id: string, data: Record<string, unknown>) =>
  adminRequest(request, 'PATCH', `/api/incidents/${id}`, data);

const row = (page: Page, id: string) =>
  page.locator(`[data-testid="live-incident-row"][data-incident-id="${id}"]`);

async function rowIds(page: Page) {
  return page
    .getByTestId('live-incident-row')
    .evaluateAll(rows => rows.map(node => node.getAttribute('data-incident-id')));
}

async function expectNewestFirst(page: Page) {
  const times = await page
    .locator('[data-testid="live-incident-row"] time')
    .evaluateAll(nodes => nodes.map(node => Date.parse(node.getAttribute('datetime') || '')));
  expect(times.length).toBeGreaterThan(0);
  expect([...times].sort((a, b) => b - a)).toEqual(times);
}

test.describe.serial('dashboard live incidents', () => {
  let admin: { context: BrowserContext; page: Page };
  let alpha: { context: BrowserContext; page: Page };
  const runTag = () => `${test.info().project.name}-${Date.now().toString(36)}`;

  test.beforeAll(async ({ browser }, testInfo) => {
    assertIsolatedDatabase();
    seed('busy');
    admin = await signIn(browser, ADMIN, testInfo);
    alpha = await signIn(browser, ALPHA, testInfo);
  });

  test.afterAll(async () => {
    await admin?.context.close();
    await alpha?.context.close();
    await prisma.$disconnect();
  });

  test('renders a compact, authorized, newest-first feed near the top', async () => {
    const { page } = alpha;
    const panel = await openDashboard(page);
    await expect(page.getByTestId('live-incident-row')).toHaveCount(10);
    await expect(page.getByTestId('live-incidents-total')).toHaveText('30 active');
    await expectNewestFirst(page);
    await expect(panel).not.toContainText('Bravo restricted');

    // The feed sits immediately below the command center.
    const command = (await page.getByTestId('command-center').boundingBox())!;
    const live = (await panel.boundingBox())!;
    expect(live.y).toBeGreaterThan(command.y);
    expect(live.y - (command.y + command.height)).toBeLessThan(48);

    const first = page.getByTestId('live-incident-row').first();
    await expect(first).toContainText('Dashboard Alpha');
    await expect(first.locator('time')).toBeVisible();
    await expect(page.getByTestId('live-view-all')).toHaveAttribute(
      'href',
      '/incidents?filter=all_open'
    );
  });

  test('new incidents appear at the top without a refresh within the latency budget', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const navigations: string[] = [];
    page.on('framenavigated', frame => frame === page.mainFrame() && navigations.push(frame.url()));

    // Warm the create route once (dev compiles routes lazily) before measuring.
    await createIncident(admin.page.request, {
      title: `Warmup ${runTag()}`,
      service: 'Dashboard Alpha API',
    });

    const latencies: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const title = `Live latency ${index} ${runTag()}`;
      const started = Date.now();
      const id = await createIncident(admin.page.request, {
        title,
        service: 'Dashboard Alpha API',
      });
      await expect(row(page, id)).toBeVisible({ timeout: 15_000 });
      latencies.push(Date.now() - started);
      expect((await rowIds(page))[0]).toBe(id);
      await expect(row(page, id)).toHaveAttribute('data-highlighted', 'true');
    }
    await expectNewestFirst(page);
    const [, , last] = await rowIds(page);
    await expect(row(page, last!)).toHaveAttribute('data-highlighted', 'false', {
      timeout: 10_000,
    });
    expect(navigations).toEqual([]);

    const median = [...latencies].sort((a, b) => a - b)[1];
    test.info().annotations.push({
      type: 'live-latency-ms',
      description: `${latencies.join(', ')} (median ${median})`,
    });
    expect(median).toBeLessThanOrEqual(LATENCY_BUDGET_MS);
  });

  test('acknowledge and reassign update in place; resolve leaves the feed', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const title = `Lifecycle ${runTag()}`;
    const id = await createIncident(admin.page.request, { title, service: 'Dashboard Alpha API' });
    await expect(row(page, id)).toHaveAttribute('data-status', 'OPEN');
    const indexBefore = (await rowIds(page)).indexOf(id);

    await patchIncident(admin.page.request, id, { status: 'ACKNOWLEDGED' });
    await expect(row(page, id)).toHaveAttribute('data-status', 'ACKNOWLEDGED');
    await expect(row(page, id)).toContainText('Acknowledged');
    expect((await rowIds(page)).indexOf(id)).toBe(indexBefore);

    const peer = await prisma.user.findUniqueOrThrow({
      where: { email: 'dashboard-alpha-peer@example.local' },
      select: { id: true, name: true },
    });
    await patchIncident(admin.page.request, id, { assigneeId: peer.id });
    await expect(row(page, id)).toContainText(peer.name);

    await patchIncident(admin.page.request, id, { status: 'RESOLVED' });
    await expect(row(page, id)).toHaveCount(0);
    await expectNewestFirst(page);
  });

  test('filters are keyboard accessible and scoped correctly', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const alphaUser = await prisma.user.findUniqueOrThrow({
      where: { email: ALPHA.email },
      select: { id: true, name: true },
    });

    const critical = page.getByTestId('live-filter-critical');
    await critical.focus();
    await page.keyboard.press('Enter');
    await expect(critical).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('live-view-all')).toHaveAttribute(
      'href',
      '/incidents?filter=critical_focus'
    );
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    const criticalIds = (await rowIds(page)) as string[];
    const criticalRows = await prisma.incident.findMany({
      where: { id: { in: criticalIds } },
      select: { urgency: true, priority: true },
    });
    expect(criticalRows).toHaveLength(criticalIds.length);
    for (const item of criticalRows) {
      expect(item.urgency === 'HIGH' || item.priority === 'P1').toBe(true);
    }

    const mine = page.getByTestId('live-filter-mine');
    await mine.focus();
    await page.keyboard.press('Space');
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    const assignees = await page.getByTestId('live-incident-row').allInnerTexts();
    for (const text of assignees) expect(text).toContain(alphaUser.name);

    await page.getByTestId('live-filter-my_teams').click();
    await expect(page.getByTestId('live-incidents-total')).toHaveText(/\d+ active/);
    await expect(page.getByTestId('live-incidents-panel')).not.toContainText('Bravo restricted');

    await page.getByTestId('live-filter-active').click();
    await expect(page.getByTestId('live-filter-active')).toHaveAttribute('aria-pressed', 'true');

    // Rows are real links reachable by keyboard.
    const firstLink = page.locator('[data-testid="live-incident-row"] a').first();
    await firstLink.focus();
    await expect(firstLink).toBeFocused();
    await expect(firstLink).toHaveAttribute('href', /^\/incidents\//);
  });

  test('pause buffers changes with a pending count and resume applies them', async () => {
    const { page } = alpha;
    await openDashboard(page);
    await page.getByTestId('live-pause-toggle').click();
    await expect(page.getByTestId('live-incidents-panel')).toHaveAttribute('data-paused', 'true');

    const id = await createIncident(admin.page.request, {
      title: `Paused ${runTag()}`,
      service: 'Dashboard Alpha Worker',
    });
    await expect(page.getByTestId('live-pending-count')).toHaveText(/[1-9]\d* pending/);
    await expect(row(page, id)).toHaveCount(0);

    await page.getByTestId('live-pause-toggle').click();
    await expect(page.getByTestId('live-incidents-panel')).toHaveAttribute('data-paused', 'false');
    await expect(row(page, id)).toBeVisible();
    expect((await rowIds(page))[0]).toBe(id);
  });

  test('reconnect restores canonical state after missed updates', async () => {
    const { page, context } = alpha;
    await openDashboard(page);
    await context.setOffline(true);
    await expect(page.getByTestId('live-incidents-panel')).toHaveAttribute(
      'data-connection',
      'offline'
    );
    await expect(page.getByTestId('live-incidents-status')).toContainText('Offline');

    const id = await createIncident(admin.page.request, {
      title: `While offline ${runTag()}`,
      service: 'Dashboard Alpha API',
    });
    await page.waitForTimeout(2_500);
    await expect(row(page, id)).toHaveCount(0);

    await context.setOffline(false);
    await expect(page.getByTestId('live-incidents-panel')).toHaveAttribute(
      'data-connection',
      'live',
      { timeout: 30_000 }
    );
    await expect(row(page, id)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('live-incidents-synced')).toHaveText(/Updated just now/);
  });

  test('never exposes incidents outside the viewer scope', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const hiddenTitle = `Bravo restricted live ${runTag()}`;
    const hiddenId = await createIncident(admin.page.request, {
      title: hiddenTitle,
      service: 'Dashboard Bravo Gateway',
    });
    const visibleId = await createIncident(admin.page.request, {
      title: `Alpha after bravo ${runTag()}`,
      service: 'Dashboard Alpha API',
    });
    await expect(row(page, visibleId)).toBeVisible();
    await expect(row(page, hiddenId)).toHaveCount(0);

    for (const filter of ['active', 'critical', 'mine', 'my_teams']) {
      const response = await page.request.get(`/api/dashboard/live-incidents?filter=${filter}`);
      expect(response.ok()).toBeTruthy();
      const body = await response.text();
      expect(body).not.toContain(hiddenId);
      expect(body).not.toContain('Bravo restricted');
    }
    const forged = await page.request.get('/api/dashboard/live-incidents?filter=active&userId=x');
    expect(forged.status()).toBe(400);
  });

  test('handles high volume and bursts without layout breakage', async () => {
    const { page } = alpha;
    seed('stress', 150);
    await openDashboard(page);
    await expect(page.getByTestId('live-incidents-total')).toHaveText('150 active');
    await expect(page.getByTestId('live-incident-row')).toHaveCount(10);
    await page.getByTestId('live-show-more').click();
    await expect(page.getByTestId('live-incident-row')).toHaveCount(50);
    await page.getByTestId('live-show-more').click();
    await expect(page.getByTestId('live-incident-row')).toHaveCount(10);

    const ids = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createIncident(admin.page.request, {
          title: `Burst ${index} ${runTag()}`,
          service: index % 2 ? 'Dashboard Alpha API' : 'Dashboard Alpha Worker',
          urgency: 'MEDIUM',
          priority: 'P2',
        })
      )
    );
    await expect(page.getByTestId('live-incidents-total')).toHaveText('158 active');
    const top = await rowIds(page);
    for (const id of ids) expect(top.slice(0, 10)).toContain(id);
    await expectNewestFirst(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    seed('busy');
  });

  test('responsive layout: stacked cards on phones, dense rows on desktop', async ({}, testInfo) => {
    const { page } = alpha;
    await openDashboard(page);
    const header = page.getByText('Priority', { exact: true });
    const firstRow = page.getByTestId('live-incident-row').first();
    const box = await firstRow.boundingBox();
    if (testInfo.project.name.startsWith('mobile')) {
      await expect(header).toBeHidden();
      expect(box!.height).toBeGreaterThan(48);
    } else {
      await expect(header).toBeVisible();
      expect(box!.height).toBeLessThan(56);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    // Live data stays ahead of history on every viewport.
    const live = await page.getByTestId('live-incidents-panel').boundingBox();
    const history = await page.locator('#dashboard-history-heading').boundingBox();
    expect(live!.y).toBeLessThan(history!.y);
  });

  test('live updates do not cause major layout shifts', async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Layout Instability API is Chromium-only');
    const { page } = alpha;
    await openDashboard(page);
    await page.evaluate(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          }
        >) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: false });
    });
    const id = await createIncident(admin.page.request, {
      title: `CLS ${runTag()}`,
      service: 'Dashboard Alpha API',
    });
    await expect(row(page, id)).toBeVisible();
    await page.waitForTimeout(1_000);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    test.info().annotations.push({ type: 'live-update-cls', description: cls.toFixed(4) });
    expect(cls).toBeLessThan(0.1);
  });

  test('light and dark themes keep readable contrast', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const contrast = () =>
      page.getByTestId('live-incidents-panel').evaluate(node => {
        const parse = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = (value: string) => {
          const [r, g, b] = parse(value).map(channel => {
            const c = channel / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const heading = node.querySelector('#live-incidents-heading')!;
        const bg = luminance(getComputedStyle(node).backgroundColor);
        const fg = luminance(getComputedStyle(heading).color);
        return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
      });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    // Desktop currently forces the light theme; certify the panel's dark: variants directly.
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  });

  test('empty state for a viewer with no active incidents', async ({ browser }, testInfo) => {
    const empty = await signIn(browser, EMPTY, testInfo);
    try {
      await openDashboard(empty.page);
      await expect(empty.page.getByTestId('live-incidents-empty')).toBeVisible();
      await expect(empty.page.getByTestId('live-incidents-total')).toHaveText('0 active');
    } finally {
      await empty.context.close();
    }
  });

  test('phones without a desktop preference still land on the mobile PWA', async ({
    browser,
  }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, 'Mobile user agents only');
    const context = await browser.newContext(contextOptions(testInfo));
    const page = await context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/m(\/|$|\?)|\/login/);
    await context.close();
  });
});
