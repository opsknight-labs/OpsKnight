import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Browser journey for intelligence on the service, service-list and team pages (Workstream I2): the
 * service Intelligence tab (dependency graph with a suggested edge an administrator approves, SLO burn,
 * alert quality with its fix links, recent changes, noise controls), the three list badges, and the team
 * tiles. A responder sees the same tab without the admin actions, and no tab at all on a service where
 * every engine is off. State is created directly and removed afterwards.
 */
const prisma = new PrismaClient();
const password = 'Service-Surfaces-E2E-7719!';
const adminEmail = 'e2e-svcintel-admin@example.com';
const responderEmail = 'e2e-svcintel-responder@example.com';
const prefix = 'e2e-svcintel-';
const stamp = Date.now();
const names = {
  team: `${prefix}team-${stamp}`,
  checkout: `${prefix}checkout-${stamp}`,
  payments: `${prefix}payments-${stamp}`,
  ledger: `${prefix}ledger-${stamp}`,
  quiet: `${prefix}quiet-${stamp}`,
};
const ids = { team: '', checkout: '', payments: '', ledger: '', quiet: '' };

async function cleanup() {
  const services = { name: { startsWith: prefix } };
  await prisma.prePagingDecision.deleteMany({ where: { service: services } });
  await prisma.noiseControlPolicy.deleteMany({ where: { service: services } });
  await prisma.noiseMaintenanceWindow.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.heartbeatMonitor.deleteMany({ where: { service: services } });
  // Objective revisions are immutable (a row trigger refuses DELETE), so the fixture rows are removed with
  // the trigger switched off inside one transaction. beforeAll refuses any database that is not a test one.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      'ALTER TABLE "ServiceObjective" DISABLE TRIGGER "ServiceObjective_immutable_revision"'
    ),
    prisma.serviceObjective.deleteMany({ where: { service: services } }),
    prisma.$executeRawUnsafe(
      'ALTER TABLE "ServiceObjective" ENABLE TRIGGER "ServiceObjective_immutable_revision"'
    ),
  ]);
  await prisma.serviceDependency.deleteMany({
    where: { OR: [{ upstream: services }, { downstream: services }] },
  });
  await prisma.alert.deleteMany({ where: { service: services } });
  await prisma.incident.deleteMany({ where: { service: services } });
  await prisma.changeEvent.deleteMany({ where: { service: services } });
  await prisma.service.deleteMany({ where: services });
  await prisma.team.deleteMany({ where: { name: { startsWith: prefix } } });
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
      create: { email, name: `Service surfaces ${role}`, passwordHash, role, status: 'ACTIVE' },
    });
  }
  ids.team = (await prisma.team.create({ data: { name: names.team } })).id;
  const service = async (name: string, teamId: string | null) =>
    (await prisma.service.create({ data: { name, teamId } })).id;
  ids.checkout = await service(names.checkout, ids.team);
  ids.payments = await service(names.payments, ids.team);
  ids.ledger = await service(names.ledger, ids.team);
  ids.quiet = await service(names.quiet, null);
  const now = Date.now();
  // Checkout depends on Payments (declared); Ledger was observed and awaits review.
  await prisma.serviceDependency.create({
    data: {
      upstreamServiceId: ids.payments,
      downstreamServiceId: ids.checkout,
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
      evidence: {},
    },
  });
  await prisma.serviceDependency.create({
    data: {
      upstreamServiceId: ids.ledger,
      downstreamServiceId: ids.checkout,
      origin: 'OBSERVED',
      status: 'SUGGESTED',
      confidence: 0.72,
      evidence: {},
    },
  });
  // An availability objective and an incident open for 20 minutes: the budget burns at a paging rate.
  await prisma.serviceObjective.create({
    data: {
      lineageId: `${prefix}${stamp}`,
      serviceId: ids.checkout,
      name: `${prefix}availability`,
      metricType: 'AVAILABILITY',
      target: 99.9,
      comparator: 'GREATER_THAN_OR_EQUAL',
      windowType: 'THIRTY_DAYS',
      activeFrom: new Date(now - 86_400_000),
    },
  });
  const open = await prisma.incident.create({
    data: {
      title: `${prefix}checkout down`,
      serviceId: ids.checkout,
      status: 'OPEN',
      urgency: 'HIGH',
      createdAt: new Date(now - 20 * 60_000),
    },
  });
  await prisma.alert.create({
    data: { incidentId: open.id, serviceId: ids.checkout, payload: { summary: 'e2e' } },
  });
  // Six quick, never-acknowledged incidents flag the service as noisy.
  for (let i = 0; i < 6; i += 1) {
    const createdAt = new Date(now - (i + 8) * 3_600_000);
    await prisma.incident.create({
      data: {
        title: `${prefix}checkout latency ${i}`,
        serviceId: ids.checkout,
        status: 'RESOLVED',
        urgency: 'LOW',
        createdAt,
        resolvedAt: new Date(createdAt.getTime() + 60_000),
      },
    });
  }
  await prisma.changeEvent.create({
    data: {
      serviceId: ids.checkout,
      source: 'ci',
      kind: 'DEPLOY',
      summary: `${prefix}checkout v43 rollout`,
      version: 'v43',
      occurredAt: new Date(now - 3 * 3_600_000),
      riskScore: 0.81,
    },
  });
  await prisma.noiseControlPolicy.create({
    data: {
      scopeKey: `service:${ids.checkout}`,
      serviceId: ids.checkout,
      mode: 'ON',
      definition: {},
    },
  });
  // Explicit OFF rows keep the other services out of any global policy another spec may have left.
  for (const serviceId of [ids.payments, ids.ledger, ids.quiet])
    await prisma.noiseControlPolicy.create({
      data: { scopeKey: `service:${serviceId}`, serviceId, mode: 'OFF', definition: {} },
    });
  for (let i = 0; i < 3; i += 1)
    await prisma.prePagingDecision.create({
      data: {
        serviceId: ids.checkout,
        control: 'SUPPRESSION',
        action: 'SUPPRESS',
        mode: 'ON',
        applied: true,
        reason: 'e2e',
        evidence: {},
        createdAt: new Date(now - 2 * 3_600_000),
      },
    });
  await prisma.noiseMaintenanceWindow.create({
    data: {
      name: `${prefix}database upgrade`,
      scope: 'SERVICE',
      serviceId: ids.checkout,
      startsAt: new Date(now - 3_600_000),
      endsAt: new Date(now + 4 * 3_600_000),
    },
  });
  await prisma.heartbeatMonitor.create({
    data: {
      name: `${prefix}nightly export`,
      serviceId: ids.checkout,
      tokenHash: `${prefix}${stamp}`,
      tokenPrefix: 'hb_e2e',
      intervalSeconds: 3600,
      state: 'MISSING',
      missingSince: new Date(now - 30 * 60_000),
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

async function expectAccessible(page: Page, scope: string) {
  const result = await new AxeBuilder({ page })
    .include(scope)
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

const TAB = '[data-testid="service-intelligence"]';

test.describe.serial('intelligence on the service, service list and team pages', () => {
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

  test('the service list badges maintenance, SLO burn and noise controls, and nothing on a quiet service', async ({
    browser,
  }) => {
    const page = await signIn(browser, adminEmail);
    await page.goto(`/services?search=${encodeURIComponent(prefix)}`);
    // The status cell renders in the table and in the narrow-screen card; check the one on screen.
    const badges = page
      .getByTestId(`service-intelligence-badges-${ids.checkout}`)
      .filter({ visible: true });
    await expect(badges.getByText('In maintenance')).toBeVisible();
    await expect(badges.getByText('SLO burning fast')).toBeVisible();
    await expect(badges.getByText('Noise controls on')).toBeVisible();
    await expect(page.getByRole('link', { name: names.quiet })).toBeVisible();
    await expect(page.getByTestId(`service-intelligence-badges-${ids.quiet}`)).toHaveCount(0);
    await expectAccessible(page, `[data-testid="service-intelligence-badges-${ids.checkout}"]`);
    await page.context().close();
  });

  test('an administrator reads the Intelligence tab, reaches the fixes and approves a suggested dependency', async ({
    browser,
  }, testInfo) => {
    const page = await signIn(browser, adminEmail);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The core tabs keep their order and default; Intelligence is one more tab, opened on demand.
    await page.goto(`/services/${ids.checkout}`);
    await expect(page.getByRole('tab', { name: /Incidents/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator(TAB)).toHaveCount(0);
    await page.getByRole('tab', { name: 'Intelligence' }).click();
    await expect(page).toHaveURL(/tab=intelligence/);
    const tab = page.locator(TAB);
    await expect(tab).toBeVisible();

    const dependencies = tab.getByRole('region', { name: 'Dependencies', exact: true });
    await expect(dependencies.getByTestId('service-dependency-graph')).toBeVisible();
    await expect(
      dependencies.locator(
        '[data-testid="service-dependency-graph"] [data-edge-status="suggested"]'
      )
    ).toHaveCount(1);
    await expect(
      dependencies.getByRole('list', { name: 'Dependencies' }).getByRole('link', {
        name: names.payments,
      })
    ).toHaveAttribute('href', `/services/${ids.payments}?tab=intelligence`);
    const suggestion = `${names.checkout} depends on ${names.ledger}`;
    await expect(
      dependencies.getByRole('list', { name: 'Suggested dependencies' }).getByText(suggestion)
    ).toBeVisible();

    const burn = tab.getByRole('region', { name: 'SLO burn', exact: true });
    await expect(burn.getByText('Burning fast')).toBeVisible();

    const quality = tab.getByRole('region', { name: 'Alert quality', exact: true });
    await expect(quality.getByText('Flagged as noisy')).toBeVisible();
    await expect(
      quality.getByRole('link', { name: `Create suppression rule for ${names.checkout}` })
    ).toHaveAttribute('href', `/settings/intelligence/noise-controls?service=${ids.checkout}`);
    await expect(
      quality.getByRole('link', { name: `Lower severity for ${names.checkout}` })
    ).toHaveAttribute('href', `/services/${ids.checkout}?tab=automation`);

    const changes = tab.getByRole('region', { name: 'Recent changes', exact: true });
    await expect(
      changes.getByRole('link', { name: `${prefix}checkout v43 rollout` })
    ).toBeVisible();
    await expect(changes.getByText('High risk · 81%')).toBeVisible();

    const noise = tab.getByRole('region', { name: 'Noise controls', exact: true });
    await expect(noise.getByText('Set for this service')).toBeVisible();
    await expect(
      noise
        .getByRole('list', { name: 'Active maintenance windows' })
        .getByText(`${prefix}database upgrade`)
    ).toBeVisible();
    await expect(
      noise.getByRole('list', { name: 'Missing heartbeats' }).getByText(`${prefix}nightly export`)
    ).toBeVisible();

    await expectAccessible(page, TAB);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expectAccessible(page, TAB);
    await page.screenshot({ path: testInfo.outputPath('service-intelligence-dark.png') });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    // Approving the suggestion turns it into a real dependency, with an audit entry.
    await dependencies
      .getByRole('button', { name: `Approve suggested dependency: ${suggestion}` })
      .click();
    await expect(
      dependencies.getByRole('list', { name: 'Dependencies' }).getByRole('link', {
        name: names.ledger,
      })
    ).toBeVisible();
    await expect(dependencies.getByRole('list', { name: 'Suggested dependencies' })).toHaveCount(0);
    await expect
      .poll(() =>
        prisma.serviceDependency.count({
          where: {
            upstreamServiceId: ids.ledger,
            downstreamServiceId: ids.checkout,
            status: 'ACTIVE',
          },
        })
      )
      .toBe(1);

    // The shareable address lands on the same tab.
    await page.goto(`/services/${ids.checkout}/intelligence`);
    await expect(page).toHaveURL(
      url =>
        url.pathname === `/services/${ids.checkout}` &&
        url.searchParams.get('tab') === 'intelligence'
    );
    await expect(page.locator(TAB)).toBeVisible();
    await page.context().close();
  });

  test('a responder sees the tab without admin actions, and no tab where every engine is off', async ({
    browser,
  }) => {
    const page = await signIn(browser, responderEmail);
    await page.goto(`/services/${ids.checkout}?tab=intelligence`);
    const tab = page.locator(TAB);
    await expect(tab.getByRole('region', { name: 'SLO burn', exact: true })).toBeVisible();
    await expect(tab.getByRole('link', { name: /Create suppression rule/ })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: /Approve suggested dependency/ })).toHaveCount(0);
    await expect(tab.getByRole('link', { name: /noise controls/i })).toHaveCount(0);

    // The quiet service has noise controls OFF and no intelligence policy of its own. Unless another
    // spec left a global intelligence policy behind, every engine is off for it.
    const globalPolicy = await prisma.intelligencePolicy.count({ where: { scopeKey: 'global' } });
    test.skip(globalPolicy > 0, 'a global intelligence policy is published in this database');
    await page.goto(`/services/${ids.quiet}?tab=intelligence`);
    await expect(page.getByRole('tab', { name: /Incidents/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByRole('tab', { name: 'Intelligence' })).toHaveCount(0);
    await expect(page.locator(TAB)).toHaveCount(0);
    await page.context().close();
  });

  test('the tab fits a 390 px phone, where the list replaces the diagram', async ({ browser }) => {
    const page = await signIn(browser, adminEmail);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/services/${ids.checkout}?tab=intelligence`);
    const tab = page.locator(TAB);
    await expect(tab.getByRole('region', { name: 'Dependencies', exact: true })).toBeVisible();
    await expect(tab.getByTestId('service-dependency-graph')).toBeHidden();
    await expect(tab.getByRole('list', { name: 'Dependencies' })).toBeVisible();
    await noHorizontalOverflow(page);
    const link = await tab
      .getByRole('link', { name: `Create suppression rule for ${names.checkout}` })
      .boundingBox();
    expect(link?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectAccessible(page, TAB);
    await page.context().close();
  });

  test('the team page shows the noise load of its services, and nothing for a silent team', async ({
    browser,
  }) => {
    const page = await signIn(browser, adminEmail);
    await page.goto(`/teams/${ids.team}`);
    const tile = page.getByTestId('team-noise-load');
    await expect(tile).toBeVisible();
    await expect(tile.getByText('Incidents created')).toBeVisible();
    await expect(tile.getByText('Pages avoided')).toBeVisible();
    await expect(tile.getByRole('link', { name: 'AIOps overview' })).toHaveAttribute(
      'href',
      '/intelligence#overview-noise'
    );
    await expectAccessible(page, '[data-testid="team-intelligence-tiles"]');

    const silent = await prisma.team.create({ data: { name: `${prefix}silent-${stamp}` } });
    await page.goto(`/teams/${silent.id}`);
    await expect(page.locator('#main-content').getByText(silent.name).first()).toBeVisible();
    await expect(page.getByTestId('team-intelligence-tiles')).toHaveCount(0);
    await page.context().close();
  });
});
