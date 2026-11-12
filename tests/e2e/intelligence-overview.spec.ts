import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Browser journey for the responder-facing AIOps overview: an administrator and a responder open
 * /intelligence, switch the window, see each section, and the page stays accessible on a 390 px phone and
 * in dark mode. State is created directly and removed afterwards.
 */
const prisma = new PrismaClient();
const password = 'Overview-E2E-Pass-5521!';
const adminEmail = 'e2e-overview-admin@example.com';
const responderEmail = 'e2e-overview-responder@example.com';
const prefix = 'e2e-overview-';
const serviceName = `${prefix}checkout-${Date.now()}`;
let serviceId = '';

async function cleanup() {
  const services = { name: { startsWith: prefix } };
  await prisma.prePagingDecision.deleteMany({ where: { service: services } });
  await prisma.noiseControlPolicy.deleteMany({ where: { service: services } });
  await prisma.intelligenceFeedback.deleteMany({
    where: { actor: { email: { in: [adminEmail, responderEmail] } } },
  });
  await prisma.alert.deleteMany({ where: { service: services } });
  await prisma.incident.deleteMany({ where: { service: services } });
  await prisma.changeEvent.deleteMany({ where: { service: services } });
  await prisma.service.deleteMany({ where: services });
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 12);
  for (const [email, role] of [
    [adminEmail, 'ADMIN'],
    [responderEmail, 'RESPONDER'],
  ] as const) {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role, status: 'ACTIVE' },
      create: { email, name: `Overview ${role}`, passwordHash, role, status: 'ACTIVE' },
    });
  }
  const service = await prisma.service.create({ data: { name: serviceName } });
  serviceId = service.id;
  const now = Date.now();
  const change = await prisma.changeEvent.create({
    data: {
      serviceId,
      source: 'ci',
      kind: 'DEPLOY',
      summary: `${prefix}checkout v43 rollout`,
      occurredAt: new Date(now - 3 * 3_600_000),
      riskScore: 0.81,
    },
  });
  // Six quick, unacknowledged incidents make the service rank as noisy; three opened as flapping.
  for (let i = 0; i < 6; i += 1) {
    const createdAt = new Date(now - (i + 1) * 3_600_000);
    const incident = await prisma.incident.create({
      data: {
        title: `${prefix}checkout latency ${i}`,
        serviceId,
        status: i < 3 ? 'SUPPRESSED' : 'RESOLVED',
        urgency: 'LOW',
        createdAt,
        acknowledgedAt: i === 5 ? new Date(createdAt.getTime() + 4 * 60_000) : null,
        resolvedAt: i < 3 ? null : new Date(createdAt.getTime() + 60_000),
      },
    });
    for (let a = 0; a < 3; a += 1)
      await prisma.alert.create({
        data: { incidentId: incident.id, serviceId, payload: { summary: 'e2e' }, createdAt },
      });
    await prisma.intelligenceFinding.create({
      data: {
        incidentId: incident.id,
        kind: i === 0 ? 'CHANGE_CORRELATION' : 'SIMILAR_INCIDENT',
        subjectRef: i === 0 ? change.id : incident.id,
        evidence: {},
        generation: 1_000_000,
        engineVersion: 'e2e',
        createdAt: new Date(createdAt.getTime() + 20_000),
      },
    });
  }
  await prisma.noiseControlPolicy.create({
    data: { scopeKey: `service:${serviceId}`, serviceId, mode: 'ON', definition: {} },
  });
  for (const [control, sourceName, count] of [
    ['SUPPRESSION', `${prefix}known disk alarm`, 4],
    ['MAINTENANCE', `${prefix}Sunday patching`, 2],
  ] as const)
    for (let i = 0; i < count; i += 1)
      await prisma.prePagingDecision.create({
        data: {
          serviceId,
          control,
          action: 'SUPPRESS',
          mode: 'ON',
          applied: true,
          sourceId: sourceName,
          sourceName,
          reason: 'e2e',
          evidence: {},
          createdAt: new Date(now - 2 * 3_600_000),
        },
      });
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  return page;
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('#main-content')
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

test.describe.serial('AIOps overview', () => {
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

  test('an administrator reads every section, switches the window and reaches the fixes', async ({
    browser,
  }, testInfo) => {
    const page = await signIn(browser, adminEmail);
    await page.goto('/');
    await page.getByRole('link', { name: 'AIOps Overview' }).first().click();
    await expect(page).toHaveURL(/\/intelligence$/);
    await expect(page.getByRole('heading', { level: 1, name: 'AIOps overview' })).toBeVisible();
    const windows = page.getByRole('navigation', { name: 'Time window' });
    await expect(windows.locator('a[aria-current="page"]')).toHaveText(/7d/);

    for (const name of ['Noise', 'Speed', 'Outcomes', 'Alert quality', 'Changes', 'Lane health'])
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();

    const noise = page.getByRole('region', { name: 'Noise', exact: true });
    const bars = noise.getByRole('list', { name: /suppressed per rule or maintenance window/ });
    await expect(
      bars.getByRole('listitem').filter({ hasText: `${prefix}known disk alarm` })
    ).toContainText('4');
    await expect(noise.getByText('Pages avoided')).toBeVisible();

    const changes = page.getByRole('region', { name: 'Changes', exact: true });
    await expect(
      changes.getByRole('link', { name: `${prefix}checkout v43 rollout` })
    ).toBeVisible();
    await expect(changes.getByText(/High risk · 81%/)).toBeVisible();

    const quality = page.getByRole('region', { name: 'Alert quality', exact: true });
    const fix = quality
      .getByRole('link', { name: `Create suppression rule for ${serviceName}` })
      .first();
    await expect(fix).toHaveAttribute(
      'href',
      `/settings/intelligence/noise-controls?service=${serviceId}`
    );

    await page
      .getByRole('region', { name: 'Outcomes', exact: true })
      .getByText('Show data table')
      .click();
    await expect(page.getByRole('table')).toBeVisible();

    await expectAccessible(page);
    await windows.getByRole('link', { name: /24h/ }).click();
    await expect(page).toHaveURL(/window=24h/);
    await expect(windows.locator('a[aria-current="page"]')).toHaveText(/24h/);
    await expect(page.getByRole('region', { name: 'Noise', exact: true })).toBeVisible();

    // Keyboard: the window links are reachable with Tab and show a visible focus ring.
    await windows.getByRole('link', { name: /7d/ }).focus();
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveText(/30d/);
    expect(await focused.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');

    await page.screenshot({ path: testInfo.outputPath('overview-desktop.png'), fullPage: true });
    for (const name of ['Outcomes', 'Alert quality', 'Changes', 'Lane health'])
      await page
        .getByRole('region', { name, exact: true })
        .screenshot({ path: testInfo.outputPath(`overview-${name.replace(' ', '-')}.png`) });
    await page.context().close();
  });

  test('a responder sees the overview without operational health or admin fixes', async ({
    browser,
  }) => {
    const page = await signIn(browser, responderEmail);
    await page.goto('/intelligence');
    await expect(page.getByRole('heading', { level: 1, name: 'AIOps overview' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Noise', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lane health', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Create suppression rule/ })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: `View service ${serviceName}` }).first()
    ).toHaveAttribute('href', `/services/${serviceId}`);
    await expectAccessible(page);
    await page.context().close();
  });

  test('fits a 390 px phone in dark mode and stays accessible', async ({ browser }, testInfo) => {
    const page = await signIn(browser, adminEmail);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/intelligence?window=30d');
    await expect(page.getByRole('region', { name: 'Outcomes', exact: true })).toBeVisible();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await noHorizontalOverflow(page);
    const target = await page
      .getByRole('navigation', { name: 'Time window' })
      .getByRole('link', { name: /7d/ })
      .boundingBox();
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectAccessible(page);
    await page.screenshot({
      path: testInfo.outputPath('overview-mobile-dark.png'),
      fullPage: true,
    });
    await page.context().close();
  });
});
