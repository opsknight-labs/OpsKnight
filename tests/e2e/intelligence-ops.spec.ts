import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Production-build journeys for the intelligence surfaces added after the incident restructure: suggested
 * runbooks on the incident, the noise-control builders (suppression rules, heartbeats, simulation), the
 * policy Insights tab, the schedule Load & fairness tab, the runbook Health section and the automation
 * replay. Each surface is checked at 1280 and 390 px in light and dark with axe. With INTEL_SHOTS_DIR
 * set, the last test also writes screenshots of each surface next to the screen it must match.
 */
const prisma = new PrismaClient();
const prefix = 'e2e-ops-';
const tag = `${prefix}${Date.now()}`;
const email = 'e2e-intel-ops@example.com';
const password = 'Intelligence-Ops-E2E-Pass-8812!';
const rotationPeople = [
  ['e2e-intel-ops-ana@example.com', 'Ana Rivera'],
  ['e2e-intel-ops-ben@example.com', 'Ben Okafor'],
] as const;
const HOUR = 3_600_000;
const ids = { service: '', incident: '', policy: '', schedule: '', runbook: '', admin: '' };
let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];

async function deleteGlobalPolicies() {
  const policies = await prisma.intelligencePolicy.findMany({
    where: { scopeKey: 'global' },
    select: { id: true },
  });
  if (!policies.length) return;
  // Policy versions are append-only (a trigger refuses DELETE); beforeAll refuses non-test databases.
  await prisma.$executeRawUnsafe('ALTER TABLE "IntelligencePolicyVersion" DISABLE TRIGGER USER');
  try {
    await prisma.intelligencePolicyVersion.deleteMany({
      where: { policyId: { in: policies.map(p => p.id) } },
    });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "IntelligencePolicyVersion" ENABLE TRIGGER USER');
  }
  await prisma.intelligencePolicy.deleteMany({ where: { id: { in: policies.map(p => p.id) } } });
}

async function cleanup() {
  await prisma.intelligenceSettings.deleteMany({});
  await prisma.intelligenceWorkItem.deleteMany({});
  await prisma.aiSettings.deleteMany({});
  await deleteGlobalPolicies();
  await prisma.opsInsight.deleteMany({ where: { key: { startsWith: prefix } } });
  await prisma.opsInsightScopeState.deleteMany({ where: { inputHash: { startsWith: prefix } } });
  const services = { name: { startsWith: prefix } };
  await prisma.incident.deleteMany({ where: { service: services } });
  await prisma.changeEvent.deleteMany({ where: { service: services } });
  await prisma.service.deleteMany({ where: services });
  await prisma.escalationPolicy.deleteMany({ where: { name: { startsWith: prefix } } });
  const schedules = { schedule: { name: { startsWith: prefix } } };
  await prisma.onCallLayerUser.deleteMany({ where: { layer: schedules } });
  await prisma.onCallLayer.deleteMany({ where: schedules });
  await prisma.onCallSchedule.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.runbook.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.systemSettings.updateMany({ data: { automationEnabled: false } });
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    create: { email, name: 'Ops Admin', passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  ids.admin = admin.id;
  const rotation = [admin];
  for (const [address, name] of rotationPeople)
    rotation.push(
      await prisma.user.upsert({
        where: { email: address },
        update: { status: 'ACTIVE' },
        create: { email: address, name, role: 'RESPONDER', status: 'ACTIVE' },
      })
    );

  // Every switch the surfaces below sit behind; all of them are off in a fresh database.
  await prisma.intelligenceSettings.create({
    data: {
      id: 'default',
      enabled: true,
      opsInsightsEnabled: true,
      opsInsightsEscalationEnabled: true,
      opsInsightsOnCallEnabled: true,
      opsInsightsRunbooksEnabled: true,
      opsInsightsAutomationEnabled: true,
    },
  });
  const policy = await prisma.intelligencePolicy.create({
    data: { scopeKey: 'global', headVersion: 1 },
  });
  await prisma.intelligencePolicyVersion.create({
    data: {
      policyId: policy.id,
      version: 1,
      mode: 'SUGGEST',
      definition: { schemaVersion: 1 },
      createdById: admin.id,
    },
  });
  await prisma.aiSettings.create({
    data: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireName: 'Pip',
      squireAvatar: 'SQUIRE',
      squireHistoryEnabled: false,
      updatedAt: new Date(),
    },
  });
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: { automationEnabled: true },
    create: { id: 'default', automationEnabled: true },
  });

  const now = Date.now();
  const service = await prisma.service.create({ data: { name: `${tag} checkout` } });
  ids.service = service.id;
  const runbook = await prisma.runbook.create({
    data: { name: 'Recycle the checkout connection pool', slug: `${tag}-pool` },
  });
  ids.runbook = runbook.id;

  // Three warning alerts from Prometheus in the last week: what the suppression rule replays against.
  for (let i = 0; i < 3; i += 1) {
    const at = new Date(now - (i + 1) * 20 * HOUR);
    const old = await prisma.incident.create({
      data: {
        title: `${tag} disk pressure ${i}`,
        serviceId: service.id,
        status: 'RESOLVED',
        urgency: 'LOW',
        createdAt: at,
        resolvedAt: new Date(at.getTime() + HOUR),
      },
    });
    await prisma.alert.create({
      data: {
        incidentId: old.id,
        serviceId: service.id,
        createdAt: at,
        severity: 'warning',
        dedupKey: `${tag}-disk-${i}`,
        payload: { summary: `${tag} disk pressure ${i}`, source: 'prometheus' },
      },
    });
  }
  const incident = await prisma.incident.create({
    data: {
      title: 'Checkout connection pool exhausted',
      serviceId: service.id,
      status: 'OPEN',
      urgency: 'HIGH',
      createdAt: new Date(now - 10 * 60_000),
    },
  });
  ids.incident = incident.id;
  await prisma.alert.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      severity: 'critical',
      payload: { summary: 'Checkout pool exhausted', source: 'prometheus' },
    },
  });
  const change = await prisma.changeEvent.create({
    data: {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'checkout v57 rollout',
      occurredAt: new Date(now - 25 * 60_000),
      riskScore: 0.74,
    },
  });
  // A newer generation than the worker writes, so its own analysis of this incident is dropped as stale.
  const common = {
    incidentId: incident.id,
    generation: 1_000_000,
    engineVersion: 'e2e',
    policyVersion: 1,
  };
  await prisma.intelligenceFinding.createMany({
    data: [
      {
        ...common,
        kind: 'CHANGE_CORRELATION',
        rank: 1,
        confidence: 0.64,
        subjectRef: change.id,
        evidence: {
          type: 'change',
          calibrated: false,
          kind: 'DEPLOY',
          relation: 'SAME_SERVICE',
          depth: 0,
          leadSeconds: 900,
          components: { proximity: 0.78, relation: 1, kind: 1 },
        },
      },
      {
        ...common,
        kind: 'RUNBOOK_RECOMMENDATION',
        rank: 1,
        confidence: 0.8,
        subjectRef: runbook.id,
        evidence: { type: 'runbook', succeeded: 7, eligible: 8, bound: true },
      },
    ],
  });

  const escalation = await prisma.escalationPolicy.create({
    data: {
      name: `${tag} checkout escalation`,
      steps: {
        create: [
          {
            stepOrder: 0,
            delayMinutes: 0,
            targetType: 'USER',
            targetUserId: admin.id,
            notificationChannels: ['EMAIL'],
          },
          {
            stepOrder: 1,
            delayMinutes: 15,
            targetType: 'USER',
            targetUserId: rotation[1].id,
            notificationChannels: ['EMAIL'],
          },
        ],
      },
    },
  });
  ids.policy = escalation.id;

  // A weekly rotation of three people that started five weeks ago: the load tab computes from it live.
  const schedule = await prisma.onCallSchedule.create({
    data: {
      name: `${tag} checkout primary`,
      timeZone: 'UTC',
      layers: {
        create: {
          name: 'Primary',
          start: new Date(now - 35 * 24 * HOUR),
          rotationLengthHours: 168,
          users: {
            create: rotation.map((user, position) => ({ userId: user.id, position })),
          },
        },
      },
    },
  });
  ids.schedule = schedule.id;

  // Stored insights, as the lane would write them. The scopes are marked freshly computed so the running
  // lane does not revisit them during the spec and resolve the fixture kind as one it no longer produces.
  await prisma.opsInsightScopeState.createMany({
    data: (
      [
        { scopeType: 'POLICY', scopeId: escalation.id },
        { scopeType: 'SCHEDULE', scopeId: schedule.id },
        { scopeType: 'RUNBOOK', scopeId: runbook.id },
      ] as const
    ).map(scope => ({ ...scope, inputHash: tag, computedAt: new Date() })),
  });
  const insight = (
    scopeType: 'POLICY' | 'SCHEDULE' | 'RUNBOOK',
    scopeId: string,
    area: string,
    severity: 'INFO' | 'WARNING' | 'CRITICAL',
    title: string,
    summary: string,
    facts: Array<{ label: string; value: string }>
  ) => ({
    scopeType,
    scopeId,
    area,
    severity,
    title,
    summary,
    kind: 'e2e.fixture',
    key: `${tag}-${scopeType}`,
    inputHash: tag,
    evidence: { window: 'last 28 days', facts },
  });
  await prisma.opsInsight.createMany({
    data: [
      insight(
        'POLICY',
        escalation.id,
        'escalation',
        'WARNING',
        'Step 2 is reached on most pages',
        'Step 1 acknowledged 3 of 11 pages in time; most incidents escalate to step 2.',
        [
          { label: 'Pages', value: '11' },
          { label: 'Acknowledged at step 1', value: '3' },
        ]
      ),
      insight(
        'SCHEDULE',
        schedule.id,
        'onCall',
        'WARNING',
        'One person carries most night pages',
        'Ops Admin took 9 of 12 night pages in the last 28 days.',
        [
          { label: 'Night pages', value: '12' },
          { label: 'Ops Admin', value: '9' },
        ]
      ),
      insight(
        'RUNBOOK',
        runbook.id,
        'runbooks',
        'INFO',
        'Step "Drain pool" fails often',
        'The drain step failed 3 of its last 10 runs, mostly on a timeout.',
        [
          { label: 'Runs', value: '10' },
          { label: 'Failed at Drain pool', value: '3' },
        ]
      ),
    ],
  });
}

async function login(page: Page) {
  // One real sign-in, then the session cookie is reused so production abuse limits are not tripped.
  if (sessionCookies.length) await page.context().addCookies(sessionCookies);
  await page.goto('/login');
  if (new URL(page.url()).pathname === '/login') {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
  }
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  sessionCookies = (await page.context().cookies()).filter(cookie =>
    cookie.name.includes('next-auth.session-token')
  );
}

/**
 * Paints the page in `theme` as the theme provider does: the Tailwind `dark` class plus the `data-theme`
 * attribute the shell CSS keys on. Desktop routes force light on this branch, so this previews dark mode.
 */
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(value => {
    const root = document.documentElement;
    // Like next-themes' disableTransitionOnChange: axe must read the settled colours, not a fade.
    if (!document.getElementById('e2e-no-transitions')) {
      const style = document.createElement('style');
      style.id = 'e2e-no-transitions';
      style.textContent = '*,*::before,*::after{transition:none!important}';
      document.head.append(style);
    }
    root.classList.toggle('dark', value === 'dark');
    root.dataset.theme = value;
    root.style.colorScheme = value;
  }, theme);
}

/** WCAG 2.1 AA, scoped to what this feature owns so unrelated shell issues do not mask ours. */
async function expectAccessible(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
  ).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Interactive controls inside `selector` are at least 44 px tall (the page must be a touch screen). */
async function touchTargets(page: Page, selector: string) {
  const small = await page.locator(selector).evaluate(root =>
    [...root.querySelectorAll<HTMLElement>('button, select, input:not([type=hidden]), [role=tab]')]
      .filter(el => el.offsetParent !== null)
      // CSS height, before any page-level zoom (settings render at zoom 0.95 across the product).
      .map(el => ({ el, height: parseFloat(getComputedStyle(el).height) }))
      .filter(({ height }) => height < 43.5)
      .map(
        ({ el, height }) =>
          `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 40)}" ${Math.round(height)}px`
      )
  );
  expect(small).toEqual([]);
}

/**
 * Opens `url` on a 390 px touch screen with this spec's session. The desktop user agent is kept so the
 * desktop route renders, but the coarse pointer applies the product's touch-target rules as on a phone.
 */
async function phone(page: Page, url: string): Promise<Page> {
  const context = await page
    .context()
    .browser()!
    .newContext({
      baseURL: new URL(page.url()).origin,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  await context.addCookies(sessionCookies);
  const mobile = await context.newPage();
  await mobile.goto(url);
  return mobile;
}

/** With INTEL_SHOTS_DIR set, saves `target` in light and dark at the current width for the design review. */
async function shoot(page: Page, target: ReturnType<Page['locator']>, name: string) {
  const dir = process.env.INTEL_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const width = page.viewportSize()?.width ?? 0;
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await target.screenshot({ path: path.join(dir, `${name}-${width}-${theme}.png`) });
  }
  await setTheme(page, 'light');
}

const ACTIVE_TAB = '[role="tabpanel"][data-state="active"]';

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

/** `scope` at 1280 px and on a 390 px touch screen, light and dark: axe, no sideways scroll, 44 px targets. */
async function acrossViewports(page: Page, url: string, scope: string) {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(url);
  const mobile = await phone(page, url);
  try {
    for (const current of [page, mobile]) {
      await expect(current.locator(scope).first()).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(current, theme);
        await expectAccessible(current, scope);
      }
      await setTheme(current, 'light');
    }
    await noHorizontalOverflow(mobile);
    await touchTargets(mobile, scope);
  } finally {
    await mobile.context().close();
  }
}

test.describe('operations intelligence surfaces', () => {
  test.beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
      throw new Error('Dedicated test DB required');
    await cleanup();
    await seed();
  });

  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the incident Runbooks tab leads with runbooks that worked here', async ({ page }) => {
    await page.goto(`/incidents/${ids.incident}`);
    await page.getByRole('tab', { name: /^Runbooks/ }).click();
    const suggested = page.getByRole('region', { name: 'Suggested for this incident' });
    await expect(suggested).toBeVisible();
    await expect(
      suggested.getByRole('link', { name: 'Recycle the checkout connection pool' })
    ).toHaveAttribute('href', `/runbooks/${ids.runbook}`);
    await expect(suggested.getByText(/7 of 8/)).toBeVisible();
    await acrossViewports(page, `/incidents/${ids.incident}?tab=runbooks`, '#runbook-suggested');
  });

  test('the strip opens the inspector at the right section, by chip, by I and by link, at every size', async ({
    page,
  }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`/incidents/${ids.incident}`);
      // Phone and desktop render their own strip; only one is visible at a time.
      const strip = page.getByTestId('intelligence-strip').filter({ visible: true });
      await expect(strip).toBeVisible();
      // On a phone the strip is reachable without scrolling past the header.
      expect((await strip.boundingBox())!.y).toBeLessThan(viewport.height);
      await strip.getByRole('link', { name: 'Likely cause: checkout v57 rollout' }).click();
      const inspector = page.getByRole('dialog', { name: 'Insights' });
      await expect(inspector.getByRole('region', { name: 'Possible causes' })).toBeVisible();
      await expect(page).toHaveURL(/[?&]insights=why/);
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await expectAccessible(page, '[data-testid="insights-inspector"]');
        await expectAccessible(page, '[data-testid="intelligence-strip"]');
      }
      await setTheme(page, 'light');
      await page.keyboard.press('Escape');
      await expect(inspector).toBeHidden();
      if (viewport.width < 400) await noHorizontalOverflow(page);
    }
  });

  test('the policy Insights tab explains what to fix, in the Activity tab layout', async ({
    page,
  }) => {
    await page.goto(`/policies/${ids.policy}`);
    await page.getByRole('tab', { name: /^Insights/ }).click();
    const insights = page.locator(ACTIVE_TAB);
    await expect(insights.getByText('Step 2 is reached on most pages')).toBeVisible();
    await acrossViewports(page, `/policies/${ids.policy}?tab=insights`, ACTIVE_TAB);
  });

  test('the schedule Load & fairness tab shows each person and the rotation insight', async ({
    page,
  }) => {
    await page.goto(`/schedules/${ids.schedule}`);
    await page.getByRole('tab', { name: /Load & fairness/ }).click();
    const panel = page.getByRole('tabpanel', { name: /Load & fairness/ });
    await expect(panel.getByText('One person carries most night pages')).toBeVisible();
    await expect(panel.getByRole('table', { name: /Load per person/ })).toBeVisible();
    await expect(panel.getByRole('cell', { name: 'Ana Rivera', exact: true })).toBeVisible();
    await acrossViewports(page, `/schedules/${ids.schedule}?tab=load`, ACTIVE_TAB);
  });

  test('the runbook overview has a Health section with its insight', async ({ page }) => {
    await page.goto(`/runbooks/${ids.runbook}`);
    const health = page.locator('#runbook-health');
    await expect(health.getByRole('heading', { name: 'Health' })).toBeVisible();
    await expect(health.getByText('Step "Drain pool" fails often').first()).toBeVisible();
    await acrossViewports(page, `/runbooks/${ids.runbook}?tab=overview`, '#runbook-health');
  });

  test('a suppression rule previews its matches and replays the last 7 days before it is saved', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto('/settings/intelligence/noise-controls#suppression-rules');
    const form = page.getByRole('form', { name: 'New suppression rule' });
    await expect(form).toBeVisible();
    await form.getByLabel('Name').fill(`${tag} quiet disk warnings`);
    await form.getByLabel('Service').selectOption({ label: `${tag} checkout` });
    await form.getByLabel('Field').first().selectOption('severity');
    await form.getByLabel('Value').first().fill('warning');
    await expect(form.getByTestId('live-match-preview')).toContainText(/Matches 3 of \d+ alerts/, {
      timeout: 30_000,
    });
    await form.getByRole('button', { name: 'Test against the last 7 days' }).click();
    await expect(
      form.getByText(/Over the last 7 days, 3 of \d+ incidents would not have paged/)
    ).toBeVisible({
      timeout: 30_000,
    });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expectAccessible(page, 'form[aria-label="New suppression rule"]');
    }
    await setTheme(page, 'light');
    await form.getByRole('button', { name: 'Add rule' }).click();
    await expect
      .poll(() => prisma.suppressionRule.count({ where: { name: `${tag} quiet disk warnings` } }))
      .toBe(1);
  });

  test('a heartbeat monitor shows its token once, and the simulation replays the saved controls', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto('/settings/intelligence/noise-controls#heartbeats');
    const form = page.getByRole('form', { name: 'New heartbeat monitor' });
    await form.getByLabel('Name').fill(`${tag} nightly export`);
    await form.getByLabel('Service').selectOption({ label: `${tag} checkout` });
    await form.getByRole('button', { name: 'Create monitor' }).click();
    await expect(form.getByTestId('heartbeat-token')).toContainText('the token is shown once');
    await expect(
      page.getByRole('list', { name: 'Heartbeat monitors' }).getByText(`${tag} nightly export`)
    ).toBeVisible();
    await expectAccessible(page, '#heartbeats');

    const simulation = page.locator('#simulation');
    await simulation.getByLabel('Service').selectOption({ label: `${tag} checkout` });
    await simulation.getByRole('button', { name: 'Replay history' }).click();
    await expect(simulation.getByText(/incidents from \d+ alerts/)).toBeVisible({
      timeout: 30_000,
    });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expectAccessible(page, '#simulation');
    }
    await setTheme(page, 'light');
    const mobile = await phone(page, '/settings/intelligence/noise-controls');
    try {
      await expect(mobile.locator('#simulation')).toBeVisible();
      await noHorizontalOverflow(mobile);
      for (const section of [
        '#maintenance-windows',
        '#suppression-rules',
        '#heartbeats',
        '#simulation',
      ])
        await touchTargets(mobile, section);
    } finally {
      await mobile.context().close();
    }
  });

  test('the automation test step replays a draft against the last 7 days', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/services/${ids.service}?tab=automation`);
    const workspace = page.getByRole('region', { name: 'Service automation' });
    await workspace.getByRole('button', { name: 'Edit automation', exact: true }).click();
    await workspace.getByRole('button', { name: 'Route production alerts', exact: true }).click();
    await workspace
      .getByRole('button', { name: 'Configure Production alerts', exact: true })
      .click();
    await workspace.getByRole('button', { name: 'Test', exact: true }).click();
    const replay = workspace.getByRole('region', { name: 'Replay against last 7 days' });
    await expect(replay).toBeVisible();
    await replay.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(replay.getByText('Alerts replayed')).toBeVisible({ timeout: 60_000 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expectAccessible(
        page,
        `section[aria-labelledby="${await replay.getAttribute('aria-labelledby')}"]`
      );
    }
    await setTheme(page, 'light');
    await shoot(page, replay, 'automation-replay');

    // The publish review shows the same replay above its acknowledgements: the reference layout.
    await workspace.getByRole('button', { name: 'Test sample', exact: true }).click();
    await expect(workspace.getByText(/semantic fixtures passed/)).toBeVisible();
    await workspace.getByRole('button', { name: 'Publish', exact: true }).click();
    const review = page.getByRole('dialog');
    await expect(review).toContainText('Review automation publication');
    await expect(review.getByRole('region', { name: 'Replay against last 7 days' })).toBeVisible();
    await shoot(page, review, 'automation-review');
    await page.keyboard.press('Escape');
    await expect(review).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await shoot(page, replay, 'automation-replay');
    await noHorizontalOverflow(page);
  });

  test('screenshots of each surface next to its reference screen', async ({ page }) => {
    const dir = process.env.INTEL_SHOTS_DIR;
    test.skip(!dir, 'set INTEL_SHOTS_DIR to write screenshots for the design review');
    test.setTimeout(600_000);
    const pairs: Array<[string, string, string]> = [
      ['policy-insights', `/policies/${ids.policy}?tab=insights`, ACTIVE_TAB],
      ['policy-activity', `/policies/${ids.policy}?tab=activity`, ACTIVE_TAB],
      ['schedule-load', `/schedules/${ids.schedule}?tab=load`, ACTIVE_TAB],
      ['schedule-coverage', `/schedules/${ids.schedule}`, ACTIVE_TAB],
      [
        'service-intelligence',
        `/services/${ids.service}?tab=intelligence`,
        '[data-testid="service-intelligence"]',
      ],
      ['service-incidents', `/services/${ids.service}`, '#main-content'],
      ['runbook-health', `/runbooks/${ids.runbook}?tab=overview`, '#runbook-health'],
      ['incident-runbooks', `/incidents/${ids.incident}?tab=runbooks`, '#runbook-suggested'],
      ['incident-inspector', `/incidents/${ids.incident}?insights=why`, '#main-content'],
      ['noise-suppression', '/settings/intelligence/noise-controls', '#suppression-rules'],
      ['noise-heartbeats', '/settings/intelligence/noise-controls', '#heartbeats'],
      ['noise-simulation', '/settings/intelligence/noise-controls', '#simulation'],
    ];
    for (const width of [1280, 1440, 390]) {
      await page.setViewportSize({ width, height: width < 400 ? 844 : 900 });
      for (const [name, url, scope] of pairs) {
        await page.goto(url);
        const target = page.locator(scope).first();
        await expect(target).toBeVisible();
        // Lazy sections stream in after the shell; shoot the settled page, not its skeleton.
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await shoot(page, target, name);
      }
    }
  });
});
