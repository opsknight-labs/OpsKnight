import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Journey: business-service catalog → overview → status dashboard, for an admin and a stakeholder,
 * with axe at 1280 px and 390 px in light and dark.
 *
 * NEEDS THE P1b HEALTH ENGINE. Until `src/lib/business-services/health-impl.ts` is the real engine these
 * pages show "Health is being prepared", so the spec is skipped unless E2E_BUSINESS_SERVICES_ENGINE=1.
 */
test.skip(
  process.env.E2E_BUSINESS_SERVICES_ENGINE !== '1',
  'Needs the P1b business-service health engine (set E2E_BUSINESS_SERVICES_ENGINE=1)'
);

const prisma = new PrismaClient();
const password = 'Business-E2E-Pass-7731!';
const adminEmail = 'e2e-bs-admin@example.com';
const stakeholderEmail = 'e2e-bs-stakeholder@example.com';
const prefix = `e2e-bs-${Date.now()}-`;
const incidentTitle = `${prefix}card auth failing`;
let businessServiceId = '';

async function cleanup() {
  await prisma.statusDashboard.deleteMany({ where: { slug: { startsWith: 'e2e-bs-' } } });
  await prisma.businessService.deleteMany({ where: { name: { startsWith: 'e2e-bs-' } } });
  await prisma.incident.deleteMany({ where: { service: { name: { startsWith: 'e2e-bs-' } } } });
  await prisma.service.deleteMany({ where: { name: { startsWith: 'e2e-bs-' } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: 'e2e-bs-' } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: 'e2e-bs-' } } });
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 12);
  const team = await prisma.team.create({ data: { name: `${prefix}payments` } });
  for (const [email, role] of [
    [adminEmail, 'ADMIN'],
    [stakeholderEmail, 'STAKEHOLDER'],
  ] as const) {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role, status: 'ACTIVE' },
      create: { email, name: `BS ${role}`, passwordHash, role, status: 'ACTIVE' },
    });
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId: user.id, teamId: team.id } },
      update: {},
      create: { userId: user.id, teamId: team.id },
    });
  }
  const service = await prisma.service.create({
    data: { name: `${prefix}checkout-api`, teamId: team.id },
  });
  const businessService = await prisma.businessService.create({
    data: {
      name: `${prefix}Checkout`,
      criticality: 'TIER_0',
      ownerTeamId: team.id,
      members: { create: { serviceId: service.id, critical: true } },
    },
  });
  businessServiceId = businessService.id;
  await prisma.incident.create({
    data: { title: incidentTitle, serviceId: service.id, urgency: 'HIGH', status: 'OPEN' },
  });
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  return page;
}

async function expectAccessible(page: Page) {
  for (const width of [1280, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      const result = await new AxeBuilder({ page })
        .include('#main-content')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map(
          v => `${width}/${scheme} ${v.id}: ${v.nodes.map(n => n.target).join(', ')}`
        )
      ).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.describe.serial('business services', () => {
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

  test('admin: catalog → overview → status dashboard', async ({ browser }) => {
    const page = await signIn(browser, adminEmail);
    await page.goto(`/services/business?q=${encodeURIComponent(prefix)}`);
    const row = page.getByRole('row', { name: `${prefix}Checkout` });
    await expect(row).toContainText(/outage|Degraded/, { timeout: 30_000 });
    await expect(row).toContainText('Tier 0');
    await expectAccessible(page);

    await row.getByRole('link', { name: `${prefix}Checkout` }).click();
    await expect(page).toHaveURL(`/services/business/${businessServiceId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${prefix}Checkout`);
    await expect(page.getByRole('list', { name: 'Why it has this status' })).toContainText(
      'checkout-api has an open high-urgency incident'
    );
    await expect(page.getByRole('link', { name: incidentTitle })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/services/business/${businessServiceId}/edit`
    );
    await page.getByRole('tab', { name: /Members/ }).click();
    await expect(page.getByRole('row', { name: /checkout-api/ })).toContainText('Critical');
    await expectAccessible(page);

    await page.goto('/status-dashboard');
    const tile = page.getByRole('link', { name: `${prefix}Checkout:` });
    await expect(tile).toBeVisible();
    await expect(page.getByRole('region', { name: 'Overall status' })).toContainText('impacted');
    await expectAccessible(page);
    await tile.click();
    await expect(page).toHaveURL(`/services/business/${businessServiceId}`);
  });

  test('stakeholder: dashboard and overview without incident details', async ({ browser }) => {
    const page = await signIn(browser, stakeholderEmail);
    await page.goto('/status-dashboard');
    await expect(page.getByRole('link', { name: `${prefix}Checkout:` })).toBeVisible();
    await expect(page.getByText(incidentTitle)).toHaveCount(0);
    await page.goto(`/services/business/${businessServiceId}`);
    await expect(page.getByText('Open incidents').first()).toBeVisible();
    await expect(page.getByText(incidentTitle)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await page.goto(`/services/business/${businessServiceId}/edit`);
    await expect(page.getByText(/Access denied|don.t have access/i).first()).toBeVisible();
  });
});
