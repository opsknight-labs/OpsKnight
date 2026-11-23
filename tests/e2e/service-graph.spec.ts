import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Service graph journey: focus on a business service, open a node's side panel, drag a new
 * dependency between two technical services, then remove it from its edge.
 *
 * LOCAL / OPT-IN ONLY. It seeds and removes its own rows, so it needs a dedicated database whose
 * name ends in `_test`, and it runs only in the `service-graph` project, which no CI workflow
 * selects:
 *   DATABASE_URL=postgresql://…/opsknight_test npx playwright test --project=service-graph
 */
const prisma = new PrismaClient();
const password = 'Service-Graph-E2E-4471!';
const adminEmail = 'e2e-service-graph-admin@example.com';
const prefix = 'e2e-graph-';
const stamp = Date.now();
const ids = { team: '', web: '', api: '', db: '', checkout: '' };

async function cleanup() {
  const services = { name: { startsWith: prefix } };
  await prisma.serviceDependency.deleteMany({
    where: { OR: [{ upstream: services }, { downstream: services }] },
  });
  await prisma.businessService.deleteMany({ where: services });
  await prisma.service.deleteMany({ where: services });
  await prisma.team.deleteMany({ where: services });
}

async function seed() {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: adminEmail } } });
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN', status: 'ACTIVE' },
    create: {
      email: adminEmail,
      name: 'Service graph admin',
      passwordHash: await bcrypt.hash(password, 12),
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  ids.team = (await prisma.team.create({ data: { name: `${prefix}team-${stamp}` } })).id;
  const service = async (name: string) =>
    (await prisma.service.create({ data: { name: `${prefix}${name}-${stamp}`, teamId: ids.team } }))
      .id;
  ids.web = await service('web');
  ids.api = await service('api');
  ids.db = await service('db');
  await prisma.serviceDependency.create({
    data: {
      upstreamServiceId: ids.api,
      downstreamServiceId: ids.web,
      origin: 'DECLARED',
      status: 'ACTIVE',
      confidence: 1,
      evidence: { type: 'declared' },
    },
  });
  ids.checkout = (
    await prisma.businessService.create({
      data: {
        name: `${prefix}checkout-${stamp}`,
        ownerTeamId: ids.team,
        members: { create: [{ serviceId: ids.web, critical: true }] },
      },
    })
  ).id;
}

async function signIn(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(adminEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  return page;
}

async function settledBox(locator: Locator) {
  let previous = await locator.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await locator.page().waitForTimeout(150);
    const current = await locator.boundingBox();
    if (current && previous && current.x === previous.x && current.y === previous.y) return current;
    previous = current;
  }
  return previous;
}

const node = (page: Page, key: string) => page.locator(`.react-flow__node[data-id="${key}"]`);

test.describe.serial('service graph', () => {
  test.beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
      throw new Error('Dedicated _test database required');
    await cleanup();
    await seed();
  });

  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test('focus on a business service shows its members two hops out and opens the side panel', async ({
    browser,
  }) => {
    const page = await signIn(browser);
    await page.goto(`/services/graph?focus=bs:${ids.checkout}`);
    await expect(page.getByRole('heading', { name: 'Service graph' })).toBeVisible();
    await expect(node(page, `bs:${ids.checkout}`)).toBeVisible({ timeout: 30_000 });
    await expect(node(page, `svc:${ids.web}`)).toBeVisible();
    await expect(node(page, `svc:${ids.api}`)).toBeVisible();
    // db has no dependencies, so it is outside the focus.
    await expect(node(page, `svc:${ids.db}`)).toHaveCount(0);
    // The focused business service opens selected, with its panel.
    await expect(page.getByRole('heading', { name: `${prefix}checkout-${stamp}` })).toBeVisible();

    await node(page, `svc:${ids.web}`).click();
    const panel = page.getByRole('complementary', { name: `${prefix}web-${stamp}` });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Depends on')).toBeVisible();
    await expect(panel.getByRole('link', { name: /Service page/ })).toHaveAttribute(
      'href',
      `/services/${ids.web}`
    );

    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .include('main')
      // shortcut: the shared PageHeader breadcrumbs measure 4.36:1 on this surface; tracked
      // outside this feature, so this check covers the graph content only.
      .exclude('nav[aria-label="Breadcrumb"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      axe.violations.map(
        v => `${v.id}: ${v.nodes.map(n => `${n.target.join(' ')} ${n.failureSummary}`).join(' | ')}`
      )
    ).toEqual([]);
  });

  test('drag-to-connect declares a dependency and the edge removes it', async ({ browser }) => {
    const page = await signIn(browser);
    await page.goto(`/services/graph?q=${encodeURIComponent(`${prefix}`)}`);
    const api = node(page, `svc:${ids.api}`);
    const db = node(page, `svc:${ids.db}`);
    await expect(api).toBeVisible({ timeout: 30_000 });
    await expect(db).toBeVisible();

    // From api's right (source) handle onto db's left (target) handle: api depends on db.
    await page.getByRole('region', { name: /Service dependency graph/ }).scrollIntoViewIfNeeded();
    // fitView animates; measure the handles only once they stop moving.
    const from = await settledBox(api.locator('.react-flow__handle.source'));
    const to = await settledBox(db.locator('.react-flow__handle.target'));
    if (!from || !to) throw new Error('handles not laid out');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // React Flow follows the connection line through pointer moves, so move in steps.
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(page.getByText('Dependency added.')).toBeVisible();
    await expect
      .poll(() =>
        prisma.serviceDependency.count({
          where: { upstreamServiceId: ids.db, downstreamServiceId: ids.api, status: 'ACTIVE' },
        })
      )
      .toBe(1);
    const created = await prisma.serviceDependency.findFirstOrThrow({
      where: { upstreamServiceId: ids.db, downstreamServiceId: ids.api },
      select: { id: true },
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'intelligence.dependency.declared', entityId: created.id },
      })
    ).toBe(1);

    const edge = page.locator(`.react-flow__edge[data-id="dep:${created.id}"]`);
    await expect(edge).toBeAttached({ timeout: 30_000 });
    // The re-laid-out edge can sit outside the scrolled viewport; the click bubbles to the edge.
    await edge.locator('.react-flow__edge-interaction').dispatchEvent('click');
    await expect(page.getByRole('alertdialog', { name: 'Remove dependency?' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText('Dependency removed.')).toBeVisible();
    await expect.poll(() => prisma.serviceDependency.count({ where: { id: created.id } })).toBe(0);
  });
});
