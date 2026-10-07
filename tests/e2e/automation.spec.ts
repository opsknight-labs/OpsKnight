import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db = new PrismaClient();
const email = 'automation-e2e@example.com',
  password = 'Automation-Local-Test-938!';
let serviceId: string;
test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.upsert({
    where: { email },
    create: { email, name: 'Automation Admin', role: 'ADMIN', status: 'ACTIVE', passwordHash },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  const service = await db.service.create({ data: { name: `Automation UI ${Date.now()}` } });
  serviceId = service.id;
});
test.afterAll(async () => {
  await db.service.delete({ where: { id: serviceId } }).catch(() => {});
  await db.$disconnect();
});
test('operator authors, tests, publishes, and enables shadow on desktop and mobile', async ({
  page,
}, testInfo) => {
  const csrfResponse = await page.request.get('/api/auth/csrf');
  const { csrfToken } = await csrfResponse.json();
  const login = await page.request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      email,
      password,
      json: 'true',
      callbackUrl: 'http://127.0.0.1:3193/services',
    },
  });
  expect(login.ok()).toBe(true);
  const session = await page.request.get('/api/auth/session');
  expect((await session.json()).user.email).toBe(email);
  await page.goto('/settings/system?section=automation');
  const settings = page.getByRole('region', { name: 'Global automation settings' });
  await expect(
    settings.getByText('Manage automation across all services.', { exact: false })
  ).toBeVisible();
  await settings.getByLabel('Enable service automation globally').check();
  await settings.getByLabel('Trace and observation retention (days)').fill('120');
  await settings.getByRole('button', { name: 'Save automation settings' }).click();
  // The first Server Action compiles on demand in the local Next dev server.
  await expect(settings.getByRole('status')).toHaveText('Automation settings saved.', {
    timeout: 90000,
  });
  await page.reload();
  await expect(settings.getByLabel('Enable service automation globally')).toBeChecked();
  await expect(settings.getByLabel('Trace and observation retention (days)')).toHaveValue('120');
  await page.goto(`/services/${serviceId}?tab=automation`);
  const workspace = page.getByRole('region', { name: 'Service automation' });
  await expect(workspace.getByRole('heading', { name: /Automation/ })).toBeVisible();
  await workspace.getByRole('button', { name: 'Edit automation', exact: true }).click();
  await workspace.getByRole('button', { name: 'Route production alerts', exact: true }).click();
  await expect(workspace.getByLabel('Rule name')).toHaveValue('Production alerts');
  await expect(workspace.getByText(/· Saved/)).toBeVisible();
  await workspace.getByRole('button', { name: 'Test', exact: true }).click();
  await workspace.getByRole('button', { name: 'Test sample', exact: true }).click();
  await expect(workspace.getByText(/semantic fixtures passed/)).toBeVisible();
  await workspace.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(workspace.getByText(/Version 1 ·/)).toBeVisible();
  await workspace.getByLabel('Automation mode').selectOption('SHADOW');
  await expect(workspace.getByLabel('Automation mode')).toHaveValue('SHADOW');
  await workspace.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(workspace.getByText('Recognized: production, staging, development')).toBeVisible();
  await workspace.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(workspace.getByText(/Fallback: service default/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
    .toBe(true);
  if (testInfo.project.name === 'desktop') {
    const sidebar = await page.locator('#app-sidebar').boundingBox();
    const automation = await workspace.boundingBox();
    expect(automation!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  }
  await page.screenshot({ path: `/tmp/automation-${testInfo.project.name}.png`, fullPage: true });
  await workspace.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(workspace.getByText('Version 1', { exact: false }).first()).toBeVisible();
  await workspace.getByRole('button', { name: 'Restore as new version', exact: true }).click();
  await expect(workspace.getByText(/Version 2 ·/)).toBeVisible();
});
