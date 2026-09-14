import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { assertResponsiveIntegrity } from '../lib/assert-responsive-integrity';
import { ALL_VIEWPORTS, VIEWPORT_MATRIX } from '../lib/responsive-viewport-matrix';

const prisma = new PrismaClient();
const FIXTURE_EMAIL = 'mobile-matrix-fixture@example.invalid';
const FIXTURE_PASSWORD = 'Mobile-matrix-harbor-472!';

async function clearRateLimits() {
  await prisma.rateLimit.deleteMany();
}

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login?callbackUrl=%2Fm');
  await page.locator('input[type="email"]').fill(FIXTURE_EMAIL);
  await page.locator('input[type="password"]').fill(FIXTURE_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/m(?:$|\?)/, { timeout: 30_000 });
  await expect(page.locator('.mobile-nav')).toBeVisible();
}

test.describe('mobile responsive visual integrity matrix', () => {
  test.beforeAll(async () => {
    await clearRateLimits();

    await prisma.user.upsert({
      where: { email: FIXTURE_EMAIL },
      update: {
        status: 'ACTIVE',
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, 12),
      },
      create: {
        email: FIXTURE_EMAIL,
        name: 'Mobile Matrix Fixture',
        passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, 12),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    const service = await prisma.service.upsert({
      where: { name: 'Matrix Service' },
      update: { status: 'OPERATIONAL' },
      create: { name: 'Matrix Service', status: 'OPERATIONAL' },
    });

    await prisma.incident.upsert({
      where: { id: 'mobile-matrix-incident-fixture' },
      update: {
        title: 'High Priority Database Connection Pool Exhaustion Active Alert',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceId: service.id,
      },
      create: {
        id: 'mobile-matrix-incident-fixture',
        title: 'High Priority Database Connection Pool Exhaustion Active Alert',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceId: service.id,
      },
    });
  });

  test.beforeEach(async () => {
    await clearRateLimits();
  });

  test.afterAll(async () => {
    await prisma.incident.deleteMany({ where: { id: 'mobile-matrix-incident-fixture' } });
    await prisma.service.deleteMany({ where: { name: 'Matrix Service' } });
    await prisma.$disconnect();
  });

  // Login page checked across 320, 375, 390, 430 and landscape
  for (const vp of [
    VIEWPORT_MATRIX.verySmallPhone,
    VIEWPORT_MATRIX.iphoneCompact,
    VIEWPORT_MATRIX.modernIphone390,
    VIEWPORT_MATRIX.largePhone,
    VIEWPORT_MATRIX.phoneLandscape,
  ]) {
    test(`login maintains responsive integrity at ${vp.name} (${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await expect(page.locator('input[type="email"]')).toBeVisible();

      // Check responsive integrity without horizontal overflow or collisions
      await assertResponsiveIntegrity(page, {
        enforceTouchTargets: true,
        touchTargetExclusions: ['input[type="checkbox"]', 'button.absolute'],
      });

      // Capture screenshot at 320, 375/390 and 430
      if ([320, 375, 390, 430].includes(vp.width)) {
        await page.screenshot({
          path: `screenshots/responsive/login-${vp.width}.png`,
          fullPage: true,
        });
      }
    });
  }

  // Authenticated pages checked across key viewports
  for (const vp of [
    VIEWPORT_MATRIX.verySmallPhone,
    VIEWPORT_MATRIX.iphoneCompact,
    VIEWPORT_MATRIX.largePhone,
  ]) {
    test(`dashboard and core pages maintain integrity at ${vp.width}px (${vp.name})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page);

      // 1. Dashboard
      await page.goto('/m');
      await expect(page.locator('.mobile-nav')).toBeVisible();
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/dashboard-${vp.width}.png` });

      // 2. Incidents List
      await page.goto('/m/incidents');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/incidents-${vp.width}.png` });

      // 3. Incident Detail
      await page.goto('/m/incidents/mobile-matrix-incident-fixture');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/incident-detail-${vp.width}.png` });

      // 4. Create Incident
      await page.goto('/m/incidents/create');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/incident-create-${vp.width}.png` });

      // 5. Notifications
      await page.goto('/m/notifications');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/notifications-${vp.width}.png` });

      // 6. More / Settings
      await page.goto('/m/more');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/more-${vp.width}.png` });

      // 7. Schedules
      await page.goto('/m/schedules');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/schedules-${vp.width}.png` });

      // 8. Services
      await page.goto('/m/services');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/services-${vp.width}.png` });
    });
  }
});
