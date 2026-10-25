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

async function openDashboard(page: Page, path = '/?lview=active') {
  // An explicit view in the URL bypasses the per-user saved view from earlier tests.
  await page.goto(path);
  const panel = page.getByTestId('live-incidents-panel');
  // Streaming SSR briefly parks the server copy in a hidden container before swapping it in.
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-loading', 'false');
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
    let response;
    try {
      response = await request.fetch(path, {
        method,
        data,
        headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      });
    } catch (error) {
      // `next dev` occasionally resets sockets under concurrent load; retry transient resets.
      if (attempt < 4 && /ECONNRESET|socket hang up/.test(String(error))) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
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

/** Cookie-authenticated browser lifecycle route (same path the incident UI uses). */
const setStatus = (request: APIRequestContext, id: string, status: 'ACKNOWLEDGED' | 'OPEN') =>
  adminRequest(
    request,
    'PATCH',
    `/api/incidents/${id}/status`,
    { status },
    {
      'Idempotency-Key': randomUUID(),
    }
  );

/** Waits until the feed reflects the current query (no in-flight view/filter change). */
async function settled(page: Page) {
  await expect(page.getByTestId('live-incidents-panel')).toHaveAttribute('data-loading', 'false');
}

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
    await expect(page.getByTestId('live-incidents-total')).toHaveText('30 active');
    const fills = (page.viewportSize()?.width ?? 0) >= 1280;
    if (fills) {
      // Wide screens: the panel fills the viewport and scrolls internally over the whole set.
      await expect(page.getByTestId('live-incident-row')).toHaveCount(30);
      const scroller = (await page.getByTestId('live-incidents-scroll').boundingBox())!;
      expect(scroller.y + scroller.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await expect(page.getByTestId('live-view-all')).toBeInViewport();
    } else {
      // Narrow screens: the first 10, with an explicit "show more".
      await expect(page.getByTestId('live-incident-row')).toHaveCount(10);
    }
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

    await setStatus(admin.page.request, id, 'ACKNOWLEDGED');
    await expect(row(page, id)).toHaveAttribute('data-status', 'ACKNOWLEDGED');
    await expect(row(page, id)).toContainText('Acknowledged');
    expect((await rowIds(page)).indexOf(id)).toBe(indexBefore);

    // Reassign through the real server action behind the admin's "Assign to me" button.
    await openDashboard(admin.page);
    // Unassigned rows offer the inline "+ Assign" (assign to me) affordance.
    await row(admin.page, id).locator('[data-testid="live-assign-ghost"]:visible').click();
    await expect(row(page, id)).toContainText('System Admin');
    expect((await rowIds(page)).indexOf(id)).toBe(indexBefore);

    // Resolve through the incident page's resolve dialog (a resolution note is mandatory).
    await admin.page.goto(`/incidents/${id}`);
    await admin.page
      .getByRole('button', { name: /^Resolve incident$/i })
      .first()
      .click();
    await admin.page
      .getByPlaceholder(/root cause, remediation steps/i)
      .fill('Rolled back the faulty deployment; error rate back to baseline.');
    await admin.page
      .getByRole('dialog')
      .getByRole('button', { name: /^Resolve Incident$/ })
      .click();
    await expect(row(page, id)).toHaveCount(0);
    await expectNewestFirst(page);
  });

  test('views are keyboard accessible and scoped correctly', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const alphaUser = await prisma.user.findUniqueOrThrow({
      where: { email: ALPHA.email },
      select: { id: true, name: true },
    });

    // Critical: the hero counter is a keyboard-operable toggle that focuses the feed.
    const critical = page.getByTestId('counter-critical');
    await critical.focus();
    await page.keyboard.press('Enter');
    await expect(critical).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/lview=critical/);
    await settled(page);
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
    await page.keyboard.press('Enter');
    await expect(critical).toHaveAttribute('aria-pressed', 'false');

    // Scope: Mine / My teams / All, operable by keyboard.
    const mine = page.getByTestId('scope-mine');
    await mine.focus();
    await page.keyboard.press('Space');
    await expect(mine).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/lscope=mine/);
    await settled(page);
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    for (const text of await page.getByTestId('live-incident-row').allInnerTexts()) {
      expect(text).toContain(alphaUser.name);
    }

    await page.getByTestId('scope-teams').click();
    await settled(page);
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    await expect(page.getByTestId('live-incidents-panel')).not.toContainText('Bravo restricted');

    await page.getByTestId('scope-all').click();
    await expect(page.getByTestId('scope-all')).toHaveAttribute('aria-checked', 'true');
    await expect(page).not.toHaveURL(/lscope=/);

    // Every view is also reachable from the Filters popover.
    await page.getByTestId('live-more-filters').click();
    await page.getByTestId('live-view-unassigned').click();
    await expect(page.getByTestId('live-view-unassigned')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await settled(page);
    await expect(page.getByTestId('live-filter-chips')).toContainText('Unassigned');
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    for (const text of await page.getByTestId('live-incident-row').allInnerTexts()) {
      expect(text).toMatch(/Assign|Unassigned/);
    }
    await page.getByRole('button', { name: 'Remove filter Unassigned' }).click();
    await expect(page.getByTestId('live-filter-chips')).toHaveCount(0);

    // Rows are real links reachable by keyboard; j/k move focus between them.
    const firstLink = page.locator('[data-testid="live-incident-row"] a').first();
    await firstLink.focus();
    await expect(firstLink).toBeFocused();
    await expect(firstLink).toHaveAttribute('href', /^\/incidents\//);
    await page.keyboard.press('j');
    await expect(page.locator('[data-live-row-link="1"]')).toBeFocused();
    await page.keyboard.press('k');
    await expect(page.locator('[data-live-row-link="0"]')).toBeFocused();
  });

  test('service, search and facet filters narrow the feed and persist as a saved view', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const workerId = await serviceId('Dashboard Alpha Worker');

    await page.getByTestId('live-filter-service').click();
    await page.getByRole('option', { name: /Dashboard Alpha Worker/ }).click();
    await expect(page.getByTestId('live-filter-chips')).toContainText('Dashboard Alpha Worker');
    await expect.poll(() => new URL(page.url()).searchParams.get('lservice')).toBe(workerId);
    await settled(page);
    for (const text of await page.getByTestId('live-incident-row').allInnerTexts()) {
      expect(text).toContain('Dashboard Alpha Worker');
    }

    await page.getByTestId('live-more-filters').click();
    await page.getByTestId('live-filter-status').locator('[data-value="ACKNOWLEDGED"]').click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/lstatus=ACKNOWLEDGED/);
    await settled(page);
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    for (const status of await page
      .getByTestId('live-incident-row')
      .evaluateAll(rows => rows.map(node => node.getAttribute('data-status')))) {
      expect(status).toBe('ACKNOWLEDGED');
    }

    // Saved view: reloading the bare dashboard restores the last view for this user.
    await page.goto('/');
    await expect(page.getByTestId('live-filter-chips')).toContainText('Acknowledged');
    await expect(page).toHaveURL(/lstatus=ACKNOWLEDGED/);

    await page.getByTestId('live-clear-filters').click();
    await expect(page.getByTestId('live-filter-chips')).toHaveCount(0);

    const search = page.getByTestId('live-search');
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await search.fill('Queue backlog');
    await expect(page).toHaveURL(/lq=Queue\+backlog/);
    await settled(page);
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    for (const text of await page.getByTestId('live-incident-row').allInnerTexts()) {
      expect(text.toLowerCase()).toContain('queue backlog');
    }
    await search.press('Escape');
    await expect(page.getByTestId('live-filter-chips')).toHaveCount(0);
  });

  test('command center counters drive the live view', async () => {
    const { page } = alpha;
    await openDashboard(page);
    await page.getByTestId('counter-unassigned').click();
    await expect(page.getByTestId('counter-unassigned')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/lview=unassigned/);
    await page.getByTestId('counter-unassigned').click();
    await expect(page.getByTestId('counter-unassigned')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('counter-sla').click();
    await expect(page).toHaveURL(/lview=breaching/);
    await page.getByTestId('counter-sla').click();
    await page.getByTestId('counter-triggered').click();
    await expect(page).toHaveURL(/lstatus=OPEN/);
    await page.getByTestId('counter-triggered').click();
    await expect(page).not.toHaveURL(/lstatus=/);
  });

  test('quick actions respect permissions and update optimistically', async () => {
    // A scoped USER never sees management actions.
    await openDashboard(alpha.page);
    await expect(alpha.page.getByTestId('live-ack')).toHaveCount(0);
    await expect(alpha.page.getByTestId('live-assign-me')).toHaveCount(0);
    await expect(alpha.page.getByTestId('live-assign-ghost')).toHaveCount(0);

    const { page } = admin;
    const id = await createIncident(admin.page.request, {
      title: `Quick action ${runTag()}`,
      service: 'Dashboard Alpha API',
    });
    await openDashboard(page);
    await expect(row(page, id)).toBeVisible();
    await row(page, id).getByTestId('live-ack').click();
    await expect(row(page, id)).toHaveAttribute('data-status', 'ACKNOWLEDGED');
    await row(page, id).locator('[data-testid="live-assign-ghost"]:visible').click();
    await expect(row(page, id)).toContainText('System Admin');
    await expect
      .poll(async () =>
        prisma.incident.findUnique({ where: { id }, select: { status: true, assignee: true } })
      )
      .toMatchObject({ status: 'ACKNOWLEDGED', assignee: { email: ADMIN.email } });
    // The scoped viewer sees the same change arrive in real time.
    await openDashboard(alpha.page);
    await expect(row(alpha.page, id)).toHaveAttribute('data-status', 'ACKNOWLEDGED');
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

    const bravoGateway = await serviceId('Dashboard Bravo Gateway');
    const bravoTeam = await prisma.team.findUniqueOrThrow({
      where: { name: 'Dashboard Bravo' },
      select: { id: true },
    });
    // Every view and even explicitly targeting the other team's service/team stays scoped.
    for (const query of [
      'view=active',
      'view=critical',
      'view=mine',
      'view=my_teams',
      'view=unassigned',
      'view=breaching',
      `service=${bravoGateway}`,
      `team=${bravoTeam.id}`,
      'q=Bravo',
    ]) {
      const response = await page.request.get(`/api/dashboard/live?${query}`);
      expect(response.ok(), query).toBeTruthy();
      const body = await response.text();
      expect(body).not.toContain(hiddenId);
      expect(body).not.toContain('Bravo restricted');
    }
    const forged = await page.request.get('/api/dashboard/live?view=active&userId=x');
    expect(forged.status()).toBe(400);
  });

  test('handles high volume and bursts without layout breakage', async () => {
    const { page } = alpha;
    seed('stress', 150);
    await openDashboard(page);
    await expect(page.getByTestId('live-incidents-total')).toHaveText('150 active');
    if ((page.viewportSize()?.width ?? 0) >= 1280) {
      // Wide screens render the bounded window (50) inside the scrollable panel.
      await expect(page.getByTestId('live-incident-row')).toHaveCount(50);
      await expect(page.getByTestId('live-show-more')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('live-incident-row')).toHaveCount(10);
      await page.getByTestId('live-show-more').click();
      await expect(page.getByTestId('live-incident-row')).toHaveCount(50);
      await page.getByTestId('live-show-more').click();
      await expect(page.getByTestId('live-incident-row')).toHaveCount(10);
    }

    const ids: string[] = [];
    for (const wave of [0, 1]) {
      ids.push(
        ...(await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            createIncident(admin.page.request, {
              title: `Burst ${wave * 4 + index} ${runTag()}`,
              service: index % 2 ? 'Dashboard Alpha API' : 'Dashboard Alpha Worker',
              urgency: 'MEDIUM',
              priority: 'P2',
            })
          )
        ))
      );
    }
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
    const header = page.getByText('Prio', { exact: true });
    const firstRow = page.getByTestId('live-incident-row').first();
    await expect(firstRow).toBeVisible();
    const box = await firstRow.boundingBox();
    if (testInfo.project.name.startsWith('mobile')) {
      await expect(header).toBeHidden();
      expect(box!.height).toBeGreaterThan(48);
    } else {
      await expect(header).toBeVisible();
      expect(box!.height).toBeLessThan(64);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    // Live data stays ahead of history on every viewport.
    const live = await page.getByTestId('live-incidents-panel').boundingBox();
    await page.locator('#dashboard-history-heading').waitFor({ state: 'attached' });
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

  test('pins keep chosen incidents on top across filters and reloads', async () => {
    const { page } = alpha;
    await openDashboard(page);
    const target = page.getByTestId('live-incident-row').nth(1);
    const id = (await target.getAttribute('data-incident-id'))!;
    await target.hover();
    await target.getByTestId('live-pin').click();
    await expect(row(page, id).getByTestId('live-pin')).toHaveAttribute('aria-pressed', 'true');
    const strip = page.getByTestId('live-pinned');
    await expect(strip).toBeVisible();
    await expect(strip.locator(`a[href="/incidents/${id}"]`)).toBeVisible();

    // A filter that excludes the incident still keeps it in the pinned strip.
    await page.getByTestId('live-search').fill('zz-no-incident-matches-this');
    await settled(page);
    await expect(strip.locator(`a[href="/incidents/${id}"]`)).toBeVisible();
    await page.getByTestId('live-search').fill('');

    // Pins are a per-user preference that survives a reload.
    await openDashboard(page);
    await expect(
      page.getByTestId('live-pinned').locator(`a[href="/incidents/${id}"]`)
    ).toBeVisible();
    await page
      .getByTestId('live-pinned')
      .getByRole('button', { name: /^Unpin / })
      .first()
      .click();
    await expect(page.getByTestId('live-pinned')).toHaveCount(0);
  });

  test('needs-attention sort ranks critical work first', async () => {
    const { page } = alpha;
    await openDashboard(page);
    await page.getByTestId('live-sort').click();
    await page.getByTestId('live-sort-attention').click();
    await expect(page).toHaveURL(/lsort=attention/);
    await settled(page);
    const ids = ((await rowIds(page)) as string[]).slice(0, 5);
    expect(ids.length).toBeGreaterThan(0);
    const rows = await prisma.incident.findMany({
      where: { id: { in: ids } },
      select: { id: true, urgency: true, priority: true },
    });
    const isCritical = (item?: { urgency: string; priority: string | null }) =>
      item?.urgency === 'HIGH' || item?.priority === 'P1';
    const flags = ids.map(id => isCritical(rows.find(item => item.id === id)));
    // Once a non-critical row appears, no critical row follows it.
    expect(
      flags.slice(flags.indexOf(false) === -1 ? flags.length : flags.indexOf(false))
    ).not.toContain(true);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByTestId('live-sort')).toHaveText(/Needs attention/);
    // Keyboard path: the sort menu opens and selects without a pointer.
    await page.getByTestId('live-sort').focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('live-sort-newest').click();
    await expect(page).not.toHaveURL(/lsort=/);
    await expect
      .poll(async () => {
        const times = await page
          .locator('[data-testid="live-incident-row"] time')
          .evaluateAll(nodes => nodes.map(node => Date.parse(node.getAttribute('datetime') || '')));
        return times.every((time, index) => index === 0 || times[index - 1]! >= time);
      })
      .toBe(true);
  });

  test('the whole live panel fits common desktop screens without page scrolling', async ({}, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Phones stack the panel by design');
    const { page } = alpha;
    const original = page.viewportSize();
    try {
      for (const viewport of [
        { width: 1366, height: 768 },
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
      ]) {
        await page.setViewportSize(viewport);
        await openDashboard(page);
        await expect
          .poll(async () => {
            const box = await page.getByTestId('live-incidents-panel').boundingBox();
            return box ? Math.round(box.y + box.height) : Number.POSITIVE_INFINITY;
          })
          .toBeLessThanOrEqual(viewport.height);
        const footer = await page.getByTestId('live-view-all').boundingBox();
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
      }
    } finally {
      if (original) await page.setViewportSize(original);
    }
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

  test('TV wallboard is chrome-free, read-only and enters real fullscreen', async ({
    browserName,
  }, testInfo) => {
    const { page } = alpha;
    await page.goto('/?view=wallboard');
    await expect(page).toHaveURL(/\/wallboard$/);
    const board = page.getByTestId('wallboard');
    await expect(board).toBeVisible();
    await expect(page.locator('#app-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('live-incident-row').first()).toBeVisible();
    await expect(page.getByTestId('live-ack')).toHaveCount(0);
    await expect(page.getByTestId('live-pause-toggle')).toHaveCount(0);

    // The board fills the viewport edge to edge.
    const viewport = page.viewportSize()!;
    const box = (await board.boundingBox())!;
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.height)).toBe(viewport.height);

    // Text size control for distant screens (persisted per screen).
    await expect(page.getByTestId('wallboard-scale')).toHaveText('100%');
    await page.keyboard.press('+');
    await expect(page.getByTestId('wallboard-scale')).toHaveText('113%');
    await page.reload();
    await expect(page.getByTestId('wallboard-scale')).toHaveText('113%');
    await page.keyboard.press('-');

    // Fullscreen is either entered or the user is told how to do it; never a silent no-op.
    await page.getByTestId('wallboard-fullscreen').click();
    const outcome = await Promise.race([
      expect(board)
        .toHaveAttribute('data-fullscreen', 'true', { timeout: 5_000 })
        .then(() => 'fullscreen')
        .catch(() => 'none'),
      page
        .getByTestId('wallboard-fullscreen-hint')
        .waitFor({ timeout: 5_000 })
        .then(() => 'hint')
        .catch(() => 'none'),
    ]);
    expect(['fullscreen', 'hint']).toContain(outcome);
    if (browserName === 'chromium' && !testInfo.project.name.startsWith('mobile')) {
      expect(outcome).toBe('fullscreen');
      expect(
        await page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid'))
      ).toBe('wallboard');
      await page.keyboard.press('f');
      await expect(board).toHaveAttribute('data-fullscreen', 'false');
    }

    await page.getByTestId('wallboard-exit').click();
    await expect(page.getByTestId('live-incidents-panel')).toBeVisible();
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

  test('opens incident inspector alongside the live feed with verified operational telemetry and closes via Escape', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop browser test');
    const { page, context } = await signIn(browser, ALPHA, testInfo);
    try {
      await openDashboard(page, '/?lview=active');
      await expect(page.getByTestId('live-incidents-panel')).toBeVisible();

      const firstInspectButton = page.getByTestId('live-inspect').first();
      await expect(firstInspectButton).toBeVisible();
      await firstInspectButton.click();

      const inspector = page.getByTestId('incident-inspector');
      await expect(inspector).toBeVisible();
      await expect(inspector.getByText('Incoming Signals')).toBeVisible();
      await expect(inspector.getByText('Automation & Escalation')).toBeVisible();

      // Dismiss via Escape key
      await page.keyboard.press('Escape');
      await expect(inspector).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
