import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { enableSuggestMode } from '../lib/intelligence-e2e-fixture';

/**
 * Browser contracts for intelligence on the incident page and the incident list: the hero's one-line group
 * state, the storm group view in the insights inspector with its "Ungroup and page" control (which
 * re-ingests the alert so it pages), and the list's noise badges and noise-decision filter. State is created
 * directly and removed afterwards. The group respects the service's intelligence mode, so the spec switches
 * the engine to SUGGEST for its run and restores what it found.
 */
const prisma = new PrismaClient();
const email = 'e2e-intelligence-h2@example.com';
const password = 'Intelligence-H2-E2E-Pass-5521!';
const tag = `e2e-intel-h2-${Date.now()}`;

let serviceId = '';
let parentId = '';
let childId = '';
let suppressedId = '';
let decisionId = '';
let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
let restoreIntelligence: (() => Promise<void>) | null = null;

const ref = (id: string) => `#${id.slice(-5).toUpperCase()}`;

async function cleanup() {
  const services = { name: { startsWith: 'e2e-intel-h2-' } };
  await prisma.alert.deleteMany({ where: { service: services } });
  await prisma.incident.deleteMany({ where: { service: services } });
  await prisma.service.deleteMany({ where: services });
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    create: { email, name: 'Intelligence H2 Admin', passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  restoreIntelligence = await enableSuggestMode(prisma, admin.id);
  const service = await prisma.service.create({ data: { name: tag } });
  serviceId = service.id;
  const now = Date.now();
  const parent = await prisma.incident.create({
    data: {
      title: 'Storm parent: database cluster degraded',
      serviceId,
      status: 'OPEN',
      urgency: 'LOW',
      createdAt: new Date(now - 10 * 60_000),
    },
  });
  const child = await prisma.incident.create({
    data: {
      title: 'Checkout returns 502',
      serviceId,
      status: 'OPEN',
      urgency: 'LOW',
      createdAt: new Date(now - 8 * 60_000),
    },
  });
  const suppressed = await prisma.incident.create({
    data: { title: 'Synthetic probe flaps', serviceId, status: 'SUPPRESSED', urgency: 'LOW' },
  });
  await prisma.incidentRelationship.create({
    data: {
      sourceIncidentId: child.id,
      targetIncidentId: parent.id,
      type: 'PARENT_CHILD',
      origin: 'RULE',
      decision: 'ACCEPTED',
      score: 1,
      evidence: { type: 'correlation', automatic: true, linkType: 'PARENT_CHILD' },
      engineVersion: 'e2e',
    },
  });
  const alert = await prisma.alert.create({
    data: {
      incidentId: parent.id,
      serviceId,
      dedupKey: `${tag}-db7`,
      payload: { summary: 'db-7 CPU saturated', severity: 'warning', source: 'e2e' },
      createdAt: new Date(now - 6 * 60_000),
    },
  });
  const decision = await prisma.prePagingDecision.create({
    data: {
      serviceId,
      incidentId: parent.id,
      alertId: alert.id,
      control: 'STORM',
      action: 'GROUP_CHILD',
      mode: 'ON',
      applied: true,
      reason: 'Storm: 9 incidents in 300s; grouped under the parent',
      evidence: { recentIncidents: 9, threshold: 5 },
      createdAt: new Date(now - 6 * 60_000),
    },
  });
  await prisma.prePagingDecision.create({
    data: {
      serviceId,
      incidentId: suppressed.id,
      control: 'SUPPRESSION',
      action: 'SUPPRESS',
      mode: 'ON',
      applied: true,
      sourceName: 'E2E noisy probe',
      reason: 'Matched probe=synthetic',
      evidence: {},
    },
  });
  parentId = parent.id;
  childId = child.id;
  suppressedId = suppressed.id;
  decisionId = decision.id;
}

async function login(page: Page) {
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

async function expectAccessible(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
  ).toEqual([]);
}

test.describe.serial('intelligence on incidents and incident lists', () => {
  test.beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
      throw new Error('Dedicated test DB required');
    await cleanup();
    await seed();
  });

  test.afterAll(async () => {
    await restoreIntelligence?.();
    await cleanup();
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the list shows noise badges and filters by noise decision', async ({ page }) => {
    await page.goto(`/incidents?serviceId=${serviceId}&noise=grouped`);
    await expect(
      page.getByRole('link', { name: `Grouped under parent incident ${ref(parentId)}` })
    ).toHaveAttribute('href', `/incidents/${parentId}`);
    await expect(page.getByRole('link', { name: 'Checkout returns 502' })).toBeVisible();
    await expect(page.getByText('2 grouped').locator('visible=true')).toHaveCount(1);
    // Suppressed incidents are not grouped: filtered out.
    await expect(page.getByRole('link', { name: 'Synthetic probe flaps' })).toHaveCount(0);
    await expectAccessible(page, '[data-testid="incident-intelligence-badges"]');

    await page.goto(`/incidents?serviceId=${serviceId}&noise=suppressed&filter=all`);
    await expect(page.getByRole('link', { name: 'Synthetic probe flaps' })).toBeVisible();
    await expect(
      page.getByText('Suppressed by E2E noisy probe').locator('visible=true')
    ).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Checkout returns 502' })).toHaveCount(0);
    expect(suppressedId).toBeTruthy();
  });

  test('a child states its parent in one line under the title and opens the group on demand', async ({
    page,
  }) => {
    await page.goto(`/incidents/${childId}`);
    // The group is one slim line in the hero, not a card in the main column.
    // Streaming can leave a hidden copy of a server-rendered block for a moment: match the visible one.
    const line = page.getByTestId('incident-group-line').filter({ visible: true });
    await expect(line).toContainText('Grouped under');
    await expect(
      line.getByRole('link', { name: `${ref(parentId)} Storm parent: database cluster degraded` })
    ).toHaveAttribute('href', `/incidents/${parentId}`);
    await expect(page.getByTestId('incident-group-view')).toHaveCount(0);

    await line.getByRole('link', { name: 'View group' }).click();
    const inspector = page.getByRole('dialog', { name: 'Insights' });
    const group = inspector.getByTestId('incident-group-view');
    await expect(group.getByRole('heading', { name: 'Part of a group' })).toBeVisible();
    await expect(
      group.getByRole('link', { name: `${ref(parentId)} Storm parent: database cluster degraded` })
    ).toHaveAttribute('href', `/incidents/${parentId}`);
    await expect(group.getByText(/\(this incident\)/)).toBeVisible();
    await expect(page).toHaveURL(/[?&]insights=related/);
  });

  test('ungroup and page releases the grouped alert as its own paging incident', async ({
    page,
  }) => {
    await page.goto(`/incidents/${parentId}`);
    const line = page.getByTestId('incident-group-line').filter({ visible: true });
    await expect(line).toContainText('Parent of 1 grouped incident and 1 grouped alert');
    await expectAccessible(page, '[data-testid="incident-group-line"]');
    await line.getByRole('link', { name: 'View group' }).click();
    const group = page.getByRole('dialog', { name: 'Insights' }).getByTestId('incident-group-view');
    await expect(group.getByRole('heading', { name: 'Grouped under this incident' })).toBeVisible();
    await expect(group.getByRole('img', { name: /Mini timeline/ })).toBeVisible();
    await expect(group.getByRole('link', { name: 'db-7 CPU saturated' })).toBeVisible();
    await expectAccessible(page, '[data-testid="incident-group-view"]');

    const trigger = group.getByRole('button', { name: 'Ungroup and page' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('pages the on-call responder');
    await dialog.getByRole('button', { name: 'Ungroup and page' }).click();
    await expect(
      group.getByText(/re-ingested as its own incident and pages normally/)
    ).toBeVisible();
    const open = group.getByRole('link', { name: 'Open the new incident' });
    await expect(open).toBeVisible();

    const decision = await prisma.prePagingDecision.findUniqueOrThrow({
      where: { id: decisionId },
    });
    expect(decision.reversedAt).not.toBeNull();
    const released = await prisma.incident.findMany({
      where: { serviceId, id: { notIn: [parentId, childId, suppressedId] } },
      select: { id: true, status: true },
    });
    expect(released).toHaveLength(1);
    await expect(open).toHaveAttribute('href', `/incidents/${released[0].id}`);
  });
});
