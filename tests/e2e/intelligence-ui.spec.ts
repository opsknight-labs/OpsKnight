import { startFakeModel, type FakeServer } from '../helpers/fake-model-server';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Browser contracts for the recommendations-only Intelligence release: every settings page renders with
 * its section navigation, an incident shows its suggestions, and the assistant opens from each entry
 * point and answers in basic mode (no AI provider). State is created directly and removed afterwards so
 * the assistant never appears in other specs that share this database.
 */
const prisma = new PrismaClient();
const email = 'e2e-intelligence@example.com';
const password = 'Intelligence-E2E-Pass-4417!';
const tag = `e2e-intel-${Date.now()}`;

let incidentId = '';
let precedentId = '';
let changeId = '';
let alertId = '';
let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
let fake: FakeServer;

async function cleanup() {
  await prisma.squireConversation.deleteMany({ where: { user: { email } } });
  await prisma.aiProvider.deleteMany({ where: { name: 'e2e-intel-model' } });
  await prisma.aiSettings.deleteMany({});
  // Switching intelligence off first stops the worker picking up anything else from this spec.
  await prisma.intelligenceSettings.deleteMany({});
  await prisma.intelligenceWorkItem.deleteMany({});
  await prisma.intelligenceFeedback.deleteMany({ where: { actor: { email } } });
  const policies = await prisma.intelligencePolicy.findMany({
    where: { scopeKey: 'global' },
    select: { id: true },
  });
  if (policies.length) {
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
  const services = { name: { startsWith: 'e2e-intel-' } };
  // Findings and change events cascade from these; incidents must go before their service.
  await prisma.incident.deleteMany({ where: { service: services } });
  await prisma.changeEvent.deleteMany({ where: { service: services } });
  await prisma.service.deleteMany({ where: services });
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    create: { email, name: 'Intelligence Admin', passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  await prisma.intelligenceSettings.create({ data: { id: 'default', enabled: true } });
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
      squireAnimations: true,
      squireHistoryEnabled: false,
      updatedAt: new Date(),
    },
  });

  const service = await prisma.service.create({ data: { name: tag } });
  const now = Date.now();
  const precedent = await prisma.incident.create({
    data: {
      title: 'Checkout database connection pool exhausted (last month)',
      serviceId: service.id,
      status: 'RESOLVED',
      urgency: 'LOW',
      createdAt: new Date(now - 30 * 86_400_000),
      resolvedAt: new Date(now - 30 * 86_400_000 + 3_600_000),
    },
  });
  const incident = await prisma.incident.create({
    data: {
      title: 'Checkout database connection pool exhausted',
      serviceId: service.id,
      status: 'OPEN',
      urgency: 'LOW',
      createdAt: new Date(now - 5 * 60_000),
    },
  });
  const change = await prisma.changeEvent.create({
    data: {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'checkout v42 rollout',
      occurredAt: new Date(now - 20 * 60_000),
    },
  });
  const alert = await prisma.alert.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      payload: { summary: 'Checkout synthetic alert' },
    },
  });
  changeId = change.id;
  alertId = alert.id;
  // The production server runs the real intelligence worker, which analyses this new incident too. Its
  // writes are fenced by generation, so a newer seeded generation is kept and the worker's older result
  // is dropped as stale. That is the same guarantee that stops a late analysis overwriting a fresh one.
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
        kind: 'SIMILAR_INCIDENT',
        rank: 1,
        confidence: 0.91,
        subjectRef: precedent.id,
        evidence: {
          type: 'similarity',
          calibrated: false,
          tier: 'FTS',
          components: {
            tokens: 0.9,
            template: 0.95,
            labels: 0,
            sameService: 1,
            recency: 0.5,
            resolved: 1,
          },
          matchedTokenCount: 5,
        },
      },
      {
        ...common,
        kind: 'CHANGE_CORRELATION',
        rank: 1,
        confidence: 0.6,
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
    ],
  });
  await prisma.incidentRelationship.create({
    data: {
      sourceIncidentId: incident.id,
      targetIncidentId: precedent.id,
      type: 'RELATED',
      origin: 'RULE',
      decision: 'ACCEPTED',
      score: 1,
      evidence: { type: 'correlation', automatic: true, ruleId: 'e2e-group' },
      engineVersion: 'e2e',
    },
  });
  incidentId = incident.id;
  precedentId = precedent.id;
}

async function login(page: Page) {
  // Authenticate normally once, then reuse only this fixture account's session across scenarios.
  // Repeated successful sign-ins otherwise exhaust production abuse limits in the combined CI suite.
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

/** The assistant marks the document once its client code is live; wait for it before interacting. */
async function assistantReady(page: Page) {
  await expect(page.locator('html[data-squire-name="Pip"]')).toHaveCount(1);
}

/** WCAG 2.1 AA scan scoped to the parts this feature owns, so unrelated shell issues do not mask ours. */
async function expectAccessible(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
  ).toEqual([]);
}

/**
 * Paints dark (or light) as the theme provider does, with transitions off like its
 * disableTransitionOnChange, so axe reads settled colours rather than a fade in progress.
 */
async function paintDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(on => {
    if (!document.getElementById('e2e-no-transitions')) {
      const style = document.createElement('style');
      style.id = 'e2e-no-transitions';
      style.textContent = '*,*::before,*::after{transition:none!important}';
      document.head.append(style);
    }
    const root = document.documentElement;
    root.classList.toggle('dark', on);
    root.dataset.theme = on ? 'dark' : 'light';
  }, dark);
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.serial('intelligence responder workflows', () => {
  test.beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
      throw new Error('Dedicated test DB required');
    await cleanup();
    await seed();
    fake = await startFakeModel();
  });

  test.afterAll(async () => {
    await cleanup();
    await fake?.close();
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('every settings section renders with its navigation', async ({ page }) => {
    // Five groups, each one page with anchored sections (Workstream I3).
    const groups: Array<[string, string, RegExp, string[]]> = [
      [
        '/settings/intelligence',
        'Engine',
        /^Intelligence$/,
        ['lane-health', 'general', 'global-policy', 'triage', 'correlation-rules'],
      ],
      [
        '/settings/intelligence/noise-controls',
        'Noise controls',
        /^Noise controls$/,
        [
          'policy',
          'suppression-rules',
          'maintenance-windows',
          'policy-history',
          'heartbeats',
          'simulation',
          'decisions',
        ],
      ],
      [
        '/settings/intelligence/services',
        'Services & changes',
        /^Services & changes$/,
        [
          'service-policies',
          'dependencies',
          'topology-sources',
          'metric-evidence',
          'change-sources',
          'alert-quality',
        ],
      ],
      [
        '/settings/intelligence/ai',
        'Assistant',
        /Assistant and AI/,
        [
          'assistant',
          'providers',
          'model-routing',
          'prompts',
          'checks',
          'connections',
          'knowledge-memory',
          'proactive',
        ],
      ],
      [
        '/settings/intelligence/evaluation',
        'Evaluation & spend',
        /^Evaluation & spend$/,
        ['grouping-quality', 'answer-feedback', 'insights', 'learned-weights', 'usage'],
      ],
    ];
    const nav = page.getByRole('navigation', { name: 'Intelligence sections' });
    for (const [path, tab, heading, anchors] of groups) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(nav.getByRole('link')).toHaveCount(groups.length);
      await expect(nav.getByRole('link', { name: tab, exact: true })).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      // Every "on this page" link has a section to land on, and every expected section is there.
      const onThisPage = page.getByRole('navigation', { name: 'On this page' });
      for (const href of await onThisPage
        .getByRole('link')
        .evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''))) {
        await expect(page.locator(href)).toHaveCount(1);
      }
      for (const anchor of anchors) await expect(page.locator(`#${anchor}`)).toHaveCount(1);
      await expectAccessible(page, '#main-content');
    }

    // Intelligence is a first-class settings area: its breadcrumb leads back to it from every group page,
    // and the settings hub lists it. (The settings shell renders the hub and breadcrumb, not a tab bar.)
    await expect(
      page
        .locator('#main-content')
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Intelligence', exact: true })
    ).toHaveAttribute('href', '/settings/intelligence');
    await page.goto('/settings');
    await expect(
      page.locator('#main-content a[href="/settings/intelligence"]').first()
    ).toBeVisible();

    // Every earlier address still works and lands on the section that now holds its controls.
    const moved: Array<[string, string]> = [
      ['/settings/intelligence/response', '/settings/intelligence/services#dependencies'],
      ['/settings/intelligence/insights', '/settings/intelligence/evaluation#insights'],
      [
        '/settings/intelligence/quality?q=zz',
        '/settings/intelligence/evaluation?q=zz#grouping-quality',
      ],
      ['/settings/intelligence/connections', '/settings/intelligence/ai#connections'],
      ['/settings/intelligence/ai/memory', '/settings/intelligence/ai#knowledge-memory'],
      ['/settings/intelligence/ai?spend=30', '/settings/intelligence/evaluation?spend=30#ai-spend'],
    ];
    for (const [from, to] of moved) {
      await page.goto(from);
      await expect(page).toHaveURL(url => `${url.pathname}${url.search}${url.hash}` === to);
      // The redirect can leave a hidden copy of the page in the DOM; the visible one is the answer.
      await expect(page.locator(`#${to.split('#')[1]}`).filter({ visible: true })).toBeVisible();
    }
    // Alert quality has a single home in settings.
    await page.goto('/settings/intelligence/services#alert-quality');
    await expect(page.getByRole('heading', { name: 'Alert quality', exact: true })).toHaveCount(1);
    // Triage is its own card with its own save, no longer a checkbox in the global policy form.
    await page.goto('/settings/intelligence#triage');
    const triage = page.locator('#triage');
    await expect(triage.getByRole('checkbox', { name: /Suggest triage/ })).toBeVisible();
    await expect(triage.getByRole('button', { name: 'Save triage setting' })).toBeVisible();
    await expect(
      page.locator('#global-policy').getByRole('checkbox', { name: /Suggest triage/ })
    ).toHaveCount(0);

    // The settings page reflects what was configured and never offers AUTO.
    await page.goto('/settings/intelligence');
    await expect(page.getByRole('option', { name: /Automatic/ })).toBeDisabled();
    await page.goto('/settings/intelligence/ai');
    await expect(page.getByRole('textbox', { name: 'Assistant name', exact: true })).toHaveValue(
      'Pip'
    );
    // The seed stores the SQUIRE mascot (the chat tests below rely on it).
    await expect(page.getByRole('radio', { name: 'Squire mascot' })).toBeChecked();
  });

  test('administrators can pause and adjust the background allocation through the settings form', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/intelligence/ai');
    await noHorizontalOverflow(page);
    const allocation = page.getByRole('spinbutton', {
      name: 'Background embedding allocation (%)',
      exact: true,
    });
    await expect(allocation).toHaveValue('20');
    await expect(allocation).toHaveAttribute('min', '0');
    await expect(allocation).toHaveAttribute('max', '80');
    const form = page.locator('form').filter({ has: allocation });
    for (const percent of [0, 40, 20]) {
      await allocation.fill(String(percent));
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await prisma.aiSettings.findUniqueOrThrow({ where: { id: 'default' } }))
              .backgroundEmbeddingBudgetPercent
        )
        .toBe(percent);
      await page.reload();
      await expect(allocation).toHaveValue(String(percent));
      // Usage lives on Evaluation & spend since the settings regroup (Workstream I3).
      await page.goto('/settings/intelligence/evaluation#usage');
      await expect(page.locator('#main-content').getByText(/Background embedding:/)).toContainText(
        `${percent}% of the total allowance`
      );
      await page.goto('/settings/intelligence/ai');
    }
    expect(
      (await prisma.aiSettings.findUniqueOrThrow({ where: { id: 'default' } })).dailyTokenBudget
    ).toBe(500000);
    const metrics = await page.request.get('/api/metrics');
    expect(metrics.status()).toBe(200);
    const body = await metrics.text();
    expect(body).toContain('# TYPE opsknight_intelligence_embedding_pending gauge');
    expect(body).toMatch(/^opsknight_intelligence_embedding_budget_remaining_tokens 100000$/m);
    expect(body).toMatch(/^opsknight_intelligence_feature_probe_failed 0$/m);
    expect(body).toContain('# TYPE opsknight_intelligence_squire_actions_uncertain_last_24h gauge');
  });

  test('an incident shows explainable suggestions and accepts feedback', async ({ page }) => {
    await page.goto(`/incidents/${incidentId}`);
    // One row of chips under the command bar; the full analysis is one click away in the inspector.
    // Streaming can leave a hidden copy of a server-rendered block for a moment: match the visible one.
    const strip = page.getByTestId('intelligence-strip').filter({ visible: true });
    await expect(
      strip.getByRole('link', { name: 'Likely cause: checkout v42 rollout' })
    ).toBeVisible();
    await strip.getByRole('link', { name: '1 similar', exact: true }).click();
    const inspector = page.getByRole('dialog', { name: 'Insights' });
    await expect(inspector).toBeVisible();
    await expect(page).toHaveURL(/[?&]insights=similar/);
    const similar = inspector.getByRole('region', { name: 'Similar past incidents' });
    await expect(similar).toBeVisible();
    await expect(similar.getByRole('link', { name: /last month/ })).toHaveAttribute(
      'href',
      `/incidents/${precedentId}`
    );

    await similar.getByText('Why this matched', { exact: true }).click();
    await expect(similar.getByLabel('Why this matched')).toBeVisible();
    // Causes are a section of the same panel, not another tab bar.
    const causes = inspector.getByRole('region', { name: 'Possible causes' });
    await expect(causes.getByText('checkout v42 rollout')).toBeVisible();
    await expect(causes.getByText(/leads to verify, not confirmed causes/)).toBeVisible();

    await expectAccessible(page, '[data-testid="insights-inspector"]');
    await expectAccessible(page, '[data-testid="intelligence-strip"]');
    const helpful = similar.getByRole('button', { name: 'Helpful', exact: true });
    await helpful.click();
    await expect(helpful).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() =>
        prisma.intelligenceFeedback.count({ where: { actor: { email }, verdict: 'HELPFUL' } })
      )
      .toBe(1);
  });

  test('core incident content stays first: one strip, the core tabs near the fold, insights on demand', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/incidents/${incidentId}`);
    const strip = page.getByTestId('intelligence-strip').filter({ visible: true });
    await expect(strip).toBeVisible();
    // The old seven-tab panel and its cards are gone from the main column.
    await expect(page.getByRole('tablist', { name: 'Incident intelligence' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Intelligence', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Similar past incidents' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^Ask / })).toHaveCount(0);

    // Density: hero, command bar, strip, health, description and the top of the core tabs within 1.5 screens.
    const top = async (locator: ReturnType<Page['locator']>) =>
      (await locator.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
    const tabsTop = await top(page.getByRole('tab', { name: 'Overview', exact: true }));
    const stripTop = await top(strip);
    expect(tabsTop).toBeLessThanOrEqual(800 * 1.5);
    expect(stripTop).toBeLessThan(800);
    expect(stripTop).toBeLessThan(tabsTop);
    expect(await top(page.locator('#main-content h1').first())).toBeLessThan(stripTop);

    // Keyboard: I opens and closes the inspector; it is not modal, so the page behind stays usable.
    await page.locator('body').press('i');
    const inspector = page.getByRole('dialog', { name: 'Insights' });
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute('data-layout', 'side-panel');
    await expect(inspector.getByRole('region', { name: 'Similar past incidents' })).toBeVisible();

    // Timeline: intelligence events are rows of the core timeline, behind one toggle.
    await page.getByRole('tab', { name: /^Timeline/ }).click();
    await expect(inspector).toBeVisible();
    const toggle = page.getByRole('checkbox', { name: /Show intelligence events/ });
    await expect(toggle).toBeChecked();
    const timeline = page.getByRole('tabpanel', { name: /^Timeline/ });
    await expect(timeline.getByRole('link', { name: 'checkout v42 rollout' })).toBeVisible();
    await timeline.getByRole('button', { name: 'Intelligence', exact: true }).click();
    await expect(timeline.locator('[data-intelligence-kind]').first()).toBeVisible();
    await toggle.uncheck();
    await expect(timeline.locator('[data-intelligence-kind]')).toHaveCount(0);
    await expect(timeline.getByRole('link', { name: 'checkout v42 rollout' })).toHaveCount(0);
    await page.locator('body').press('i');
    await expect(inspector).toBeHidden();

    // Shareable link straight to a section.
    await page.goto(`/incidents/${incidentId}?insights=why`);
    await expect(
      page
        .getByRole('dialog', { name: 'Insights' })
        .getByRole('region', { name: 'Possible causes' })
    ).toBeVisible();
    await expectAccessible(page, '[data-testid="insights-inspector"]');

    // Dark mode keeps the strip and the inspector accessible.
    await paintDark(page, true);
    await expectAccessible(page, '[data-testid="insights-inspector"]');
    await expectAccessible(page, '[data-testid="intelligence-strip"]');
    await paintDark(page, false);
  });

  test('the shortcut for insights is listed with the other incident shortcuts', async ({
    page,
  }) => {
    await page.goto('/shortcuts');
    await expect(page.getByText('Open or close insights on an incident')).toBeVisible();
  });

  test('the assistant answers about one insight in basic mode', async ({ page }) => {
    await page.goto(`/incidents/${incidentId}?insights=similar`);
    await assistantReady(page);
    const inspector = page.getByRole('dialog', { name: 'Insights' });
    const similar = inspector.getByRole('region', { name: 'Similar past incidents' });
    // The standalone Ask Squire card is gone; every item asks about itself instead.
    await similar.getByRole('button', { name: /^Ask Pip about .*last month/ }).click();
    const dialog = page.getByRole('dialog', { name: /Pip/ });
    await expect(dialog).toBeVisible();
    // The question is written into the composer for the person to confirm, not sent for them.
    const composer = dialog.getByLabel('Message Pip');
    await expect(composer).toHaveValue(/last month/);
    await composer.press('Enter');
    await expect(dialog.getByText('Basic answer from your incident data')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      dialog.locator(`a[href="/incidents/${precedentId}"]`, { hasText: 'View incident' }).first()
    ).toBeVisible();
    // The inspector does not cover the assistant it opened.
    await dialog.getByLabel('Message Pip').click({ trial: true });
    await expectAccessible(page, 'section[role="dialog"]');
  });

  test('the floating launcher is keyboard friendly and the search entry opens it', async ({
    page,
  }) => {
    await page.goto('/');
    await assistantReady(page);
    const launcher = page.getByRole('button', { name: /Ask Pip/ });
    await expect(launcher).toBeVisible();
    await launcher.click();
    const dialog = page.getByRole('dialog', { name: /Pip/ });
    await expect(page.getByLabel('Message Pip')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(launcher).toBeFocused();

    const search = page.getByPlaceholder('Search...');
    await search.click();
    await search.fill('pip');
    await page.getByText('Ask Pip', { exact: true }).last().click();
    await expect(dialog).toBeVisible();
  });

  test('Squire opens from a deep link, pins the incident briefing, docks beside the page and takes the palette question', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const sent: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/intelligence/squire'))
        sent.push(request.postData() ?? '');
    });
    await page.goto(`/incidents/${incidentId}?squire=open&q=What%20changed%3F`);
    await assistantReady(page);
    const dialog = page.getByRole('dialog', { name: /Pip/ });
    await expect(dialog).toBeVisible();
    // A link only writes the question; the person sends it.
    await expect(page.getByLabel('Message Pip')).toHaveValue('What changed?');
    await expect(page).not.toHaveURL(/squire=open/);
    expect(sent).toEqual([]);
    await expect(dialog.getByText('Discussing this incident')).toBeVisible();

    const briefing = dialog.getByRole('region', { name: 'Incident briefing' });
    await expect(briefing).toBeVisible();
    // Findings link to their anchor in the incident's insights, the one place each finding lives.
    expect(await briefing.getByRole('link', { name: /last month/ }).getAttribute('href')).toMatch(
      /^\/incidents\/[A-Za-z0-9_-]+\?insights=similar#finding-[A-Za-z0-9_-]+$/
    );
    const changeHref = await briefing
      .getByRole('link', { name: /checkout v42 rollout/ })
      .getAttribute('href');
    expect(changeHref).toMatch(/\?insights=why#finding-[A-Za-z0-9_-]+$/);
    expect(changeHref?.startsWith(`/incidents/${incidentId}?`)).toBe(true);

    const content = page.locator('.content-shell');
    const rightEdge = async (target: typeof content) => {
      const box = (await target.boundingBox())!;
      return box.x + box.width;
    };
    const floatingEdge = await rightEdge(content);
    await dialog.getByRole('button', { name: 'Dock Pip beside the page' }).click();
    await expect(page.locator('html.squire-docked')).toHaveCount(1);
    // Docked: the page ends where the panel starts, so nothing is covered.
    await expect
      .poll(async () => (await rightEdge(content)) - (await dialog.boundingBox())!.x)
      .toBeLessThanOrEqual(1);
    expect(await rightEdge(content)).toBeLessThan(floatingEdge);
    expect(await rightEdge(dialog)).toBeLessThanOrEqual(1440);
    await noHorizontalOverflow(page);
    await expect(dialog.getByRole('button', { name: 'Expand chat' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('opsknight.squire.display'))).toBe(
      'docked'
    );
    await expectAccessible(page, 'section[role="dialog"]');

    await page.getByLabel('Message Pip').focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('html.squire-docked')).toHaveCount(0);
    await expect.poll(() => rightEdge(content)).toBe(floatingEdge);

    // The choice is remembered; floating again restores the default for the other specs.
    await page.keyboard.press('Control+j');
    await expect(page.locator('html.squire-docked')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Float Pip over the page' }).click();
    await expect(page.locator('html.squire-docked')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.removeItem('opsknight.squire.display'));

    // Below the desktop breakpoint docking is not offered.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.keyboard.press('Control+j');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Dock Pip|Float Pip/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });

    const search = page.getByPlaceholder('Search...');
    await search.click();
    await search.fill('ask pip what is on fire?');
    await page.getByText('Ask Pip', { exact: true }).last().click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => sent.length).toBe(1);
    expect(JSON.parse(sent[0])).toMatchObject({ message: 'what is on fire?', incidentId });

    await page.goto('/shortcuts');
    await expect(page.getByText('Open or close Squire')).toBeVisible();
  });

  test('the assistant dialog is modal: Tab stays inside, the shortcut restores focus, and AI-off is explained', async ({
    page,
  }) => {
    await page.goto('/shortcuts');
    await expect(page.getByText('Open or close Squire')).toBeVisible();
    await assistantReady(page);
    const origin = page.getByPlaceholder(/Search shortcuts/);
    await origin.focus();
    const shortcut = process.platform === 'darwin' ? 'Meta+j' : 'Control+j';
    await page.keyboard.press(shortcut);
    const dialog = page.getByRole('dialog', { name: /Pip/ });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByLabel('Message Pip')).toBeFocused();

    // AI is off in this spec: the notice says so and, for this administrator, links to the setting.
    const notice = dialog.getByTestId('squire-availability');
    await expect(notice).toHaveAttribute('data-state', 'disabled');
    await expect(notice.getByRole('link', { name: 'Turn on AI' })).toHaveAttribute(
      'href',
      '/settings/intelligence/ai'
    );

    // However far Tab and Shift+Tab go, focus never leaves the dialog.
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press(shortcut);
    await expect(dialog).toBeHidden();
    await expect(origin).toBeFocused();
  });

  test('basic mode answers reports and service questions with durable citations and no provider call', async ({
    page,
  }) => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await prisma.aiSettings.update({
      where: { id: 'default' },
      data: { enabled: false, squireHistoryEnabled: true },
    });
    try {
      await page.goto('/services');
      await assistantReady(page);
      await page.getByRole('button', { name: /Ask Pip/ }).click();
      const dialog = page.getByRole('dialog', { name: /Pip/ });
      const requests = fake.requests.length;
      await page.getByLabel('Message Pip').fill('How many incidents this week?');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: /Incident report/ })).toBeVisible();
      await expect(dialog.getByText(/Basic answer from your incident data/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(
        0
      );
      await page.getByLabel('Message Pip').fill(`Who owns "${tag}"?`);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: tag, exact: true })).toBeVisible();
      await expect(dialog.getByText(/Recorded service status/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(
        0
      );
      await expect
        .poll(() =>
          prisma.squireConversation.count({ where: { userId: owner.id, incidentId: null } })
        )
        .toBeGreaterThan(0);
      const response = await page.request.get('/api/intelligence/squire/conversations');
      expect(response.status()).toBe(200);
      const saved = (await response.json()).data.conversations.find(
        (item: { title: string }) => item.title === 'How many incidents this week?'
      );
      expect(saved).toBeTruthy();
      const detail = await page.request.get(`/api/intelligence/squire/conversations/${saved.id}`);
      expect(detail.status()).toBe(200);
      const messages = (await detail.json()).data.conversation.messages;
      expect(
        messages.some((message: { envelope?: { citations?: Array<{ kind: string }> } }) =>
          message.envelope?.citations?.some(citation => citation.kind === 'service')
        )
      ).toBe(true);
      expect(fake.requests.length).toBe(requests);
      await expectAccessible(page, 'section[role="dialog"]');
    } finally {
      await prisma.aiSettings.update({
        where: { id: 'default' },
        data: { squireHistoryEnabled: false },
      });
    }
  });

  test('Squire chat uses meaningful expressions, readable markdown and accessible mobile controls', async ({
    page,
  }, testInfo) => {
    await page.goto(`/incidents/${precedentId}`);
    await assistantReady(page);
    await page.keyboard.press('Control+j');
    const dialog = page.getByRole('dialog', { name: /Pip/ });
    const face = dialog.locator('header svg[data-variant="avatar"]');
    await expect(dialog).toBeVisible();
    await dialog.screenshot({
      path: testInfo.outputPath('squire-welcome-desktop.png'),
      animations: 'disabled',
    });
    await page.getByLabel('Message Pip').fill('Investigate this incident');
    await expect(face).toHaveAttribute('data-state', 'listening');
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const proposal = {
      token: 'browser-contract',
      action: 'add_incident_note',
      kind: 'WRITE',
      title: 'Add incident note',
      detail: 'A fixture action for this browser contract.',
      incidentId: precedentId,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    await page.route('**/api/intelligence/squire', async route => {
      await waiting;
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body:
          [
            { type: 'meta', mode: 'ai', availability: 'ready', name: 'Pip' },
            {
              type: 'delta',
              text: '## Investigation\n\n**Compare the evidence.**\n\n- Inspect connection usage\n- Check the deployment\n\n```sh\nprintf "read only"\n```',
            },
            { type: 'proposal', proposal },
            { type: 'done' },
          ]
            .map(event => JSON.stringify(event))
            .join('\n') + '\n',
      });
    });
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(face).toHaveAttribute('data-state', 'thinking');
    release();
    await expect(dialog.getByRole('heading', { name: 'Investigation' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy code' })).toBeVisible();
    await expect(face).toHaveAttribute('data-state', 'idle');
    await page.route('**/api/intelligence/squire/actions', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Fixture action completed.' }),
      })
    );
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(face).toHaveAttribute('data-state', 'success');
    await expect(dialog.getByText('Your confirmed action completed.')).toBeVisible();
    await expectAccessible(page, 'section[role="dialog"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await paintDark(page, true);
    await noHorizontalOverflow(page);
    await expectAccessible(page, 'section[role="dialog"]');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await face.locator('.oksq-rig').evaluate(element => getComputedStyle(element).animationName)
    ).toBe('none');
    await dialog.screenshot({
      path: testInfo.outputPath('squire-chat-mobile-dark.png'),
      animations: 'disabled',
    });
    await page.context().setOffline(true);
    await page.getByLabel('Message Pip').fill('Keep my draft');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await expect(face).toHaveAttribute('data-state', 'offline');
    await page.context().setOffline(false);
    await expect(page.getByLabel('Message Pip')).toHaveValue('Keep my draft');
  });

  test('fits a 390px phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of [
      '/settings/intelligence',
      '/settings/intelligence/noise-controls',
      '/settings/intelligence/services',
      '/settings/intelligence/ai',
      '/settings/intelligence/evaluation',
      `/incidents/${incidentId}`,
    ]) {
      await page.goto(path);
      await expect(page.locator('#main-content')).toBeVisible();
      await noHorizontalOverflow(page);
    }
    // The strip is on screen without scrolling, scrolls sideways instead of wrapping, and opens the
    // inspector as a bottom sheet.
    const strip = page.getByTestId('intelligence-strip').filter({ visible: true });
    await expect(strip).toBeVisible();
    const stripBox = (await strip.boundingBox())!;
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(844);
    expect(stripBox.height).toBeLessThanOrEqual(64);
    const chip = strip.getByRole('link', { name: '1 similar', exact: true });
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await chip.click();
    const sheet = page.getByRole('dialog', { name: 'Insights' });
    await expect(sheet).toHaveAttribute('data-layout', 'bottom-sheet');
    await expect(sheet.getByRole('region', { name: 'Similar past incidents' })).toBeVisible();
    const sheetBox = (await sheet.boundingBox())!;
    expect(sheetBox.x).toBeGreaterThanOrEqual(0);
    expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(390);
    await expectAccessible(page, '[data-testid="insights-inspector"]');
    await noHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // The mobile route has the same strip and the same bottom sheet, and no separate intelligence card.
    await page.goto(`/m/incidents/${incidentId}`);
    const mobileStrip = page.getByTestId('intelligence-strip').filter({ visible: true });
    await expect(mobileStrip).toBeVisible();
    const mobileBox = (await mobileStrip.boundingBox())!;
    expect(mobileBox.y + mobileBox.height).toBeLessThanOrEqual(844);
    await expect(page.getByTestId('mobile-intelligence')).toHaveCount(0);
    await mobileStrip.getByRole('link', { name: '1 similar', exact: true }).click();
    const mobileSheet = page.getByRole('dialog', { name: 'Insights' });
    await expect(mobileSheet).toHaveAttribute('data-layout', 'bottom-sheet');
    await expect(
      mobileSheet
        .getByRole('region', { name: 'Similar past incidents' })
        .getByRole('link', { name: /last month/ })
    ).toHaveAttribute('href', `/m/incidents/${precedentId}`);
    await noHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await page.goto(`/incidents/${incidentId}`);
    await assistantReady(page);
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    const box = await page.getByRole('dialog', { name: /Pip/ }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
  test('validated change and alert citations open readable source pages', async ({ page }) => {
    await page.goto(`/changes/${changeId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'checkout v42 rollout' })
    ).toBeVisible();
    await expectAccessible(page, '#main-content');
    await page.goto(`/alerts/${alertId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Checkout synthetic alert' })
    ).toBeVisible();
    // Scoped to the page body: the Squire launcher and the sidebar also name incidents.
    await expect(
      page.locator('#main-content').getByRole('link', { name: 'Open incident', exact: true })
    ).toHaveAttribute('href', `/incidents/${incidentId}`);
    await expectAccessible(page, '#main-content');
  });

  test('an automatic relationship can be ungrouped after intelligence is switched off', async ({
    page,
  }) => {
    await prisma.intelligenceSettings.update({
      where: { id: 'default' },
      data: { enabled: false },
    });
    try {
      // Off means off: no strip, no chips, nothing in the main column or on the timeline.
      await page.goto(`/incidents/${incidentId}`);
      await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
      await expect(page.getByTestId('intelligence-strip')).toHaveCount(0);
      await expect(page.getByTestId('incident-group-line')).toHaveCount(0);
      await page.getByRole('tab', { name: /^Timeline/ }).click();
      await expect(page.getByRole('checkbox', { name: /Show intelligence events/ })).toHaveCount(0);
      // An intelligence manager can still open the inspector: it says intelligence is off and keeps the
      // links made before the switch-off, so a wrong automatic grouping can be undone. Waiting on the
      // inspector itself (not on a tab that may not have hydrated yet) keeps this step deterministic.
      await page.goto(`/incidents/${incidentId}?insights=related`);
      const inspector = page.getByRole('dialog', { name: 'Insights' });
      await expect(inspector.getByTestId('insights-off-hint')).toContainText(
        'Intelligence is off for this service'
      );
      await expect(inspector.getByRole('region', { name: 'Similar past incidents' })).toHaveCount(
        0
      );
      const related = inspector.getByRole('region', { name: 'Related incidents' });
      await expect(
        related.getByText('Automatically grouped after paging', { exact: false })
      ).toBeVisible();
      await related.getByRole('button', { name: 'Ungroup' }).click();
      await expect
        .poll(() =>
          prisma.incidentRelationship.count({
            where: { sourceIncidentId: incidentId, decision: 'REVERTED' },
          })
        )
        .toBe(1);
    } finally {
      await prisma.intelligenceSettings.update({
        where: { id: 'default' },
        data: { enabled: true },
      });
    }
  });

  test('a real streamed proposal changes nothing until confirmation and cannot execute twice', async ({
    page,
  }) => {
    await prisma.aiProvider.create({
      data: {
        name: 'e2e-intel-model',
        kind: 'OPENAI_COMPATIBLE',
        model: 'm',
        baseUrl: fake.url,
        isExternal: false,
        allowPrivateNetwork: true,
        maxDataClass: 'PERSONAL',
      },
    });
    await page.goto('/settings/intelligence/ai');
    await page.getByRole('checkbox', { name: /^Enable AI\b/ }).check();
    await page
      .locator('form:visible')
      .filter({ has: page.getByRole('checkbox', { name: /^Enable AI\b/ }) })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: /saved/i }).first()).toBeVisible();
    fake.script.push(
      {
        toolCall: {
          name: 'propose_add_incident_note',
          args: JSON.stringify({ incidentId, content: 'Browser confirmed note' }),
        },
      },
      { content: 'Review the proposed note and confirm it.' }
    );
    await page.goto(`/incidents/${incidentId}`);
    await assistantReady(page);
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    await page.getByLabel('Message Pip').fill('Please add a note saying Browser confirmed note');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const proposal = page.getByRole('group', { name: /Suggested action: Add/ });
    await expect(proposal).toBeVisible();
    expect(
      await prisma.incidentNote.count({ where: { incidentId, content: 'Browser confirmed note' } })
    ).toBe(0);
    await page.route('**/api/intelligence/squire/actions', async route => {
      await route.fetch(); // Let the real domain transaction commit, then lose its response.
      await route.abort('failed');
    });
    const sent = page.waitForRequest(
      request =>
        request.url().endsWith('/api/intelligence/squire/actions') && request.method() === 'POST'
    );
    await proposal.getByRole('button', { name: 'Confirm', exact: true }).click();
    const request = await sent;
    await expect(proposal.getByRole('status')).toContainText('Could not confirm the result');
    await proposal.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(proposal.getByRole('status')).toHaveText('Note added.');
    await page.unroute('**/api/intelligence/squire/actions');
    const replay = await page.request.post('/api/intelligence/squire/actions', {
      data: request.postDataJSON(),
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(await replay.json()).toMatchObject({
      ok: true,
      message: 'Note added.',
    });
    expect(
      await prisma.incidentNote.count({ where: { incidentId, content: 'Browser confirmed note' } })
    ).toBe(1);
    await page.getByRole('button', { name: 'Close Pip', exact: true }).click();
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    await expect(proposal.getByRole('status')).toHaveText('Note added.');
    await expect(proposal.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expectAccessible(page, 'section[role="dialog"]');
  });
  test('stopping a streamed answer preserves evidence and releases its token reservation on mobile', async ({
    page,
  }, testInfo) => {
    fake.script.push({ content: 'Evidence collected so far.', finishDelayMs: 30_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/incidents/${incidentId}`);
    await assistantReady(page);
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    await page.getByLabel('Message Pip').fill('Summarise the available evidence');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Evidence collected so far.', { exact: true })).toBeVisible();
    const actor = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    expect(
      await prisma.aiTokenReservation.count({ where: { actorId: actor.id, settledAt: null } })
    ).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Stop response', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Evidence collected so far.');
    await expect(page.getByText(/Response stopped/)).toBeVisible();
    await expect(page.getByLabel('Message Pip')).toBeFocused();
    await expect
      .poll(
        () => prisma.aiTokenReservation.count({ where: { actorId: actor.id, settledAt: null } }),
        { timeout: 10_000 }
      )
      .toBe(0);
    await noHorizontalOverflow(page);
    await expectAccessible(page, 'section[role="dialog"]');
    await page.screenshot({
      path: testInfo.outputPath('squire-stopped-mobile.png'),
      fullPage: true,
    });
  });
  test('an Internal-only provider receives no browser question or history', async ({ page }) => {
    await prisma.aiProvider.updateMany({
      where: { name: 'e2e-intel-model' },
      data: { maxDataClass: 'INTERNAL' },
    });
    // Saving through the native settings command refreshes the running gateway policy cache.
    await page.goto('/settings/intelligence/ai');
    await page
      .locator('form:visible')
      .filter({ has: page.getByRole('checkbox', { name: /^Enable AI\b/ }) })
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: /saved/i }).first()).toBeVisible();
    const requestsBefore = fake.requests.length;
    await page.goto(`/incidents/${incidentId}`);
    await assistantReady(page);
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    await page
      .getByLabel('Message Pip')
      .fill('Responder Alice privacy-canary-browser-73 needs help');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(
      'provider permitted to receive Personal data'
    );
    await expect(page.getByText(/Basic answer from your incident data/)).toBeVisible();
    expect(fake.requests).toHaveLength(requestsBefore);
    await expectAccessible(page, 'section[role="dialog"]');
  });
  test('saved history cannot silently switch to another incident', async ({ page }) => {
    await prisma.aiSettings.update({
      where: { id: 'default' },
      data: { squireHistoryEnabled: true },
    });
    await page.goto(`/incidents/${incidentId}`);
    await assistantReady(page);
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    await page.getByLabel('Message Pip').fill('Help with original incident context');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const owner = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await expect
      .poll(() => prisma.squireConversation.count({ where: { userId: owner.id, incidentId } }))
      .toBe(1);
    await page.goto(`/incidents/${precedentId}`);
    await assistantReady(page);
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    await page.getByRole('button', { name: 'Saved conversations', exact: true }).click();
    await page.getByRole('button', { name: /^Help with original incident context/ }).click();
    await expect(
      page.getByRole('dialog').getByRole('link', { name: 'Return to original context' })
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('This chat keeps its original context.');
    await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
    await expectAccessible(page, 'section[role="dialog"]');
  });
  test('quality service search reaches beyond the first hundred services on mobile', async ({
    page,
  }, testInfo) => {
    const prefix = `${tag}-fleet-`;
    await prisma.service.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        name: `${prefix}${String(i).padStart(3, '0')}`,
      })),
    });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/settings/intelligence/evaluation?q=${encodeURIComponent(prefix)}`);
      const choose = page.getByRole('combobox', { name: 'Service', exact: true });
      await expect(choose.locator('option')).toHaveCount(25);
      await page.getByRole('link', { name: 'More services', exact: true }).click();
      await expect(choose.locator('option')).toHaveCount(26); // 25 matches plus the retained selection.
      await expect(page.getByRole('link', { name: 'First page', exact: true })).toBeVisible();
      await page
        .getByRole('searchbox', { name: 'Search services', exact: true })
        .fill(`${prefix}119`);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await choose.selectOption({ label: `${prefix}119` });
      await page.getByRole('button', { name: 'View quality', exact: true }).click();
      await expect(page.getByRole('heading', { name: `${prefix}119`, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
      await expectAccessible(page, '#main-content');
      await page.screenshot({
        path: testInfo.outputPath('quality-service-search-mobile.png'),
        fullPage: true,
      });
    } finally {
      await prisma.service.deleteMany({ where: { name: { startsWith: prefix } } });
    }
  });

  test('operator diagnostics withhold legacy error payloads and retain reviewed replay controls', async ({
    page,
  }) => {
    const raw = 'legacy-private-provider-body Alice password=browser-canary';
    const work = await prisma.intelligenceWorkItem.create({
      data: {
        kind: 'ANALYZE_INCIDENT',
        subjectKey: 'diagnostic-test-source',
        attempts: 8,
        failedAt: new Date(),
        lastError: raw,
      },
    });
    try {
      await page.goto('/settings/intelligence');
      const failed = page.getByRole('heading', { name: 'Failed work', exact: true }).locator('..');
      await expect(
        page.getByText('The work could not be completed. Detailed exception text is withheld.', {
          exact: true,
        })
      ).toBeVisible();
      expect(await page.locator('body').textContent()).not.toContain(raw);
      expect(await page.content()).not.toContain(raw);
      await expect(failed).toBeVisible();
      await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
      await expectAccessible(page, '#main-content');
    } finally {
      await prisma.intelligenceWorkItem.deleteMany({ where: { id: work.id } });
    }
  });

  test('freshness explains unfinished analysis and operator refresh uses the native queue', async ({
    page,
  }, testInfo) => {
    const source = await prisma.incident.findUniqueOrThrow({
      where: { id: incidentId },
      select: { serviceId: true },
    });
    const pending = await prisma.incident.create({
      data: { title: 'Freshness browser source', serviceId: source.serviceId, urgency: 'LOW' },
    });
    // Hold a synthetic in-flight lease so the background worker cannot finish before the UI assertion.
    await prisma.intelligenceWorkItem.upsert({
      where: { kind_subjectKey: { kind: 'INDEX_INCIDENT', subjectKey: pending.id } },
      create: {
        kind: 'INDEX_INCIDENT',
        subjectKey: pending.id,
        claimToken: 'freshness-browser-lease',
        claimedAt: new Date(),
        leaseUntil: new Date(Date.now() + 600_000),
      },
      update: {
        claimToken: 'freshness-browser-lease',
        claimedAt: new Date(),
        leaseUntil: new Date(Date.now() + 600_000),
      },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/incidents/${pending.id}`);
    // A web-only fixture can retain paging work from the earlier action cases. With the held
    // analysis lease, both waiting and deliberately yielding are valid unfinished states.
    // Completed, unavailable and failed analysis must still fail this assertion.
    // Freshness is stated once, as the strip's dot; its message is announced without opening it.
    const freshness = page.getByRole('group', { name: 'Recommendation freshness' });
    await expect(freshness).toHaveCount(1);
    await expect(page.getByTestId('intelligence-strip').filter({ visible: true })).toContainText(
      /Analysing|Paused/
    );
    await expect(freshness.getByRole('status')).toHaveText(
      /^(?:Waiting for recommendation analysis\. An empty panel does not mean analysis found no matches\.|Analysis is yielding to paging work\. Earlier suggestions have not been refreshed\.)$/
    );
    const dot = freshness.getByRole('button', { name: /recommendation freshness details/ });
    expect((await dot.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Opening the inspector does not repeat it.
    await page.locator('body').press('i');
    await expect(page.getByRole('dialog', { name: 'Insights' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Recommendation freshness' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Insights' })).toBeHidden();
    await dot.click();
    await expect(dot).toHaveAttribute('aria-expanded', 'true');
    const requested = page.waitForResponse(
      response =>
        response.url().endsWith(`/api/intelligence/incidents/${pending.id}/analysis`) &&
        response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Refresh recommendations', exact: true }).click();
    expect((await requested).status()).toBe(202);
    await expect
      .poll(() =>
        prisma.auditLog.count({
          where: { action: 'intelligence.analysis.requested', entityId: pending.id },
        })
      )
      .toBe(1);
    expect(
      await prisma.intelligenceWorkItem.count({
        where: { kind: 'INDEX_INCIDENT', subjectKey: pending.id },
      })
    ).toBe(1);
    await expectAccessible(page, '#main-content');
    await page.screenshot({
      path: testInfo.outputPath('recommendation-freshness-mobile.png'),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
});
