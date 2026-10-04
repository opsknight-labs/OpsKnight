import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const EMAIL = 'runbook-ui-fixture@example.invalid';
const PASSWORD = 'Runbook-ui-test-harbor-472!';
let runbookId = '';
let serviceId = '';
let incidentId = '';
test.beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/runbook_ui_test')
    throw new Error('Dedicated test database required');
  await prisma.user.upsert({
    where: { email: EMAIL },
    update: { role: 'ADMIN', status: 'ACTIVE', passwordHash: await bcrypt.hash(PASSWORD, 12) },
    create: {
      email: EMAIL,
      name: 'Runbook UI Fixture',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    },
  });
  const service = await prisma.service.upsert({
    where: { name: 'Runbook UI Fixture Service' },
    update: {},
    create: { name: 'Runbook UI Fixture Service' },
  });
  serviceId = service.id;
  const incident = await prisma.incident.create({
    data: { title: 'Runbook UI Fixture Incident', serviceId },
  });
  incidentId = incident.id;
});
test.afterAll(async () => prisma.$disconnect());
async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/runbooks');
  await expect(page.getByRole('heading', { name: 'Runbooks', exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  ).toBe(true);
}
test('library, ordered builder, typed inputs and publish confirmation', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'New Runbook', exact: true }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('UI Service Recovery');
  await page.getByLabel('Slug', { exact: true }).fill(`ui-service-recovery-${Date.now()}`);
  await page.getByRole('combobox', { name: 'Runbook template' }).click();
  await page
    .getByRole('option', { name: 'Service recovery · approval before restart', exact: true })
    .click();
  await page.getByRole('button', { name: 'Create Runbook', exact: true }).click();
  await expect(page).toHaveURL(/\/runbooks\/[a-z0-9]+/);
  runbookId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('list', { name: 'Runbook steps' })).toBeVisible();
  await expect(page.getByLabel('Definition JSON')).not.toBeVisible();
  await page.getByRole('button', { name: 'Configure step' }).first().click();
  await page.getByLabel('Step name', { exact: true }).fill('Capture baseline diagnostics');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Capture baseline diagnostics' })).toBeVisible();
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await page.getByLabel('Input 1 key', { exact: true }).fill('service');
  await page.getByLabel('Input 1 label', { exact: true }).fill('Service unit');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  await expect(page.getByLabel('Input 1 key', { exact: true })).toHaveValue('service');
  await page.getByRole('button', { name: 'Publish draft', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Only the saved draft is published');
  await page.getByRole('button', { name: 'Keep unchanged', exact: true }).click();
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/runbooks-builder-desktop.png', fullPage: true });
});
test('390px infrastructure, health and builder have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await noOverflow(page);
  await page.getByRole('textbox', { name: 'Search runbooks' }).fill('UI Service');
  await expect(page.getByRole('heading', { name: 'UI Service Recovery' }).first()).toBeVisible();
  for (const route of [
    '/runbooks/agents',
    '/runbooks/health',
    '/runbooks/executions',
    `/runbooks/${runbookId}`,
    `/services/${serviceId}`,
    `/incidents/${incidentId}`,
  ]) {
    await page.goto(route);
    await noOverflow(page);
    if (route === `/runbooks/${runbookId}`) {
      await page.screenshot({ path: 'test-results/runbooks-builder-mobile.png', fullPage: true });
    }
    if (route === '/runbooks/agents') {
      await page.getByRole('tab', { name: /^Pools/ }).click();
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await noOverflow(page);
      await page.getByRole('tab', { name: /^Secrets/ }).click();
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await noOverflow(page);
    }
  }
  await page.screenshot({ path: 'test-results/runbooks-incident-mobile.png', fullPage: true });
});
