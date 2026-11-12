import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Noise-control builders in a real browser: schedule a recurring maintenance window, see its upcoming
 * occurrences, replay it against the last 7 days, save it and find it on the agenda. Plus the mobile
 * incident page's "intelligence is off" note for managers. Named `*.intelligence-ui.spec.ts` so the
 * chromium project's existing pattern picks it up without touching playwright.config.ts.
 */
const prisma = new PrismaClient();
const email = 'e2e-noise-builders@example.com';
const password = 'Noise-Builders-E2E-Pass-5521!';
const tag = `e2e-noise-${Date.now()}`;
const HOUR = 3_600_000;

let adminId = '';
let incidentId = '';
let alertAt = new Date();
let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];

async function cleanup() {
  await prisma.maintenanceWindow.deleteMany({ where: { name: { startsWith: 'e2e-noise-' } } });
  if (adminId)
    await prisma.intelligenceEvaluationRun.deleteMany({ where: { createdById: adminId } });
  const services = { name: { startsWith: 'e2e-noise-' } };
  await prisma.incident.deleteMany({ where: { service: services } });
  await prisma.service.deleteMany({ where: services });
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    create: { email, name: 'Noise Builders Admin', passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  adminId = admin.id;
  const service = await prisma.service.create({ data: { name: tag } });
  // Three incidents over the last week, each opened by one alert. Only the first falls in the window.
  const now = Date.now();
  const times = [now - 3 * 24 * HOUR, now - 2 * 24 * HOUR - 5 * HOUR, now - 20 * HOUR];
  alertAt = new Date(times[0]);
  for (const [i, at] of times.entries()) {
    const incident = await prisma.incident.create({
      data: {
        title: `${tag} incident ${i}`,
        serviceId: service.id,
        status: 'RESOLVED',
        urgency: 'HIGH',
        createdAt: new Date(at),
        resolvedAt: new Date(at + HOUR),
      },
    });
    if (i === 2) incidentId = incident.id;
    await prisma.alert.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        createdAt: new Date(at),
        dedupKey: `${tag}-${i}`,
        severity: 'critical',
        payload: { summary: `${tag} disk full ${i}`, source: 'prometheus' },
      },
    });
  }
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

/** `datetime-local` value in UTC (the browser runs in UTC below). */
const utcLocal = (date: Date) => date.toISOString().slice(0, 16);

test.use({ timezoneId: 'UTC' });

test.describe.serial('noise-control builders', () => {
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

  test('schedules a weekly maintenance window after replaying it against the last 7 days', async ({
    page,
  }) => {
    // Validation, a 7-day replay, an axe scan and a save in one journey: more than the 60 s default.
    test.setTimeout(180_000);
    await page.goto('/settings/intelligence/noise-controls');
    const form = page.getByRole('form', { name: 'New maintenance window' });
    await expect(form).toBeVisible();

    // Validation first: nothing is saved without a name and a service.
    await form.getByRole('button', { name: 'Add window' }).click();
    await expect(form.getByText('Give the window a name.')).toBeVisible();
    await expect(form.getByText('Pick a service.')).toBeVisible();

    const name = `${tag} weekly patching`;
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Service').selectOption({ label: tag });
    // A weekly window anchored 30 minutes before the oldest alert, one hour long.
    await form
      .getByLabel('Starts (your time)')
      .fill(utcLocal(new Date(alertAt.getTime() - HOUR / 2)));
    await expect(form.getByLabel('Ends (your time)')).toHaveValue(
      utcLocal(new Date(alertAt.getTime() + 1.5 * HOUR))
    );
    await form
      .getByLabel('Ends (your time)')
      .fill(utcLocal(new Date(alertAt.getTime() + HOUR / 2)));
    await form.getByLabel('Repeats').selectOption('weekly');
    await expect(
      form.getByRole('list', { name: 'Upcoming occurrences' }).getByRole('listitem')
    ).toHaveCount(5);

    await form.getByRole('button', { name: 'Test against the last 7 days' }).click();
    await expect(
      form.getByText('Over the last 7 days, 1 of 3 incidents would not have paged.')
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(form.getByRole('link', { name: `${tag} disk full 0` })).toBeVisible();

    const scan = await new AxeBuilder({ page })
      .include('form[aria-label="New maintenance window"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
    ).toEqual([]);

    await form.getByRole('button', { name: 'Add window' }).click();
    await expect(form.getByText('Maintenance window saved.')).toBeVisible();
    const agenda = page.getByRole('list', { name: 'Maintenance agenda' });
    await expect(agenda.getByText(name).first()).toBeVisible();
    const saved = await prisma.maintenanceWindow.findFirstOrThrow({ where: { name } });
    expect(saved.recurrence).toBe(
      `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(alertAt.getTime() - HOUR / 2).getUTCDay()]}`
    );
    expect(saved.createdById).toBe(adminId);
  });

  test('the mobile incident page tells managers how to turn intelligence on', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/m/incidents/${incidentId}`);
    await expect(
      page.getByRole('heading', { name: 'Intelligence is off for this service' })
    ).toBeVisible();
    const link = page.getByRole('link', { name: 'Open intelligence settings' });
    await expect(link).toHaveAttribute('href', '/settings/intelligence');
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
