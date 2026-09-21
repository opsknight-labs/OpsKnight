import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  assertResponsiveIntegrity,
  assertSingleLineLabels,
} from '../lib/assert-responsive-integrity';
import { VIEWPORT_MATRIX } from '../lib/responsive-viewport-matrix';

const prisma = new PrismaClient();
const FIXTURE_EMAIL = 'mobile-matrix-fixture@example.invalid';
const FIXTURE_PASSWORD = 'Mobile-matrix-harbor-472!';

let matrixServiceId = '';

async function clearRateLimits() {
  await prisma.rateLimit.deleteMany();
}

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login?callbackUrl=%2Fm');
  await page.locator('input[type="email"]').fill(FIXTURE_EMAIL);
  await page.locator('input[type="password"]').fill(FIXTURE_PASSWORD);
  await Promise.all([
    page.waitForURL(url => url.pathname === '/m', { waitUntil: 'load', timeout: 30_000 }),
    page.locator('form button[type="submit"]').click(),
  ]);
  await expect(page.locator('.mobile-nav')).toBeVisible();
}

// Forces the App Lock card to render (and therefore be measured by the
// responsive-integrity touch-target check) even in headless CI, where
// a real platform authenticator is never available.
async function mockPlatformAuthenticator(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    class MockPublicKeyCredential {
      static isUserVerifyingPlatformAuthenticatorAvailable() {
        return Promise.resolve(true);
      }
    }
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: MockPublicKeyCredential,
    });
  });
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
    matrixServiceId = service.id;

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

  test.beforeEach(async ({ page }) => {
    await clearRateLimits();
    await page.route('**/api/realtime/stream', route => route.abort());
    await page.route('**/api/notifications/stream', route => route.abort());
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

  // Authenticated pages checked across key viewports (Gate 7)
  for (const vp of [
    VIEWPORT_MATRIX.verySmallPhone,
    VIEWPORT_MATRIX.compactAndroid,
    VIEWPORT_MATRIX.iphoneCompact,
    VIEWPORT_MATRIX.modernIphone390,
    VIEWPORT_MATRIX.modernIphone393,
    VIEWPORT_MATRIX.mediumPhone,
    VIEWPORT_MATRIX.largePhone,
    VIEWPORT_MATRIX.phoneLandscape,
  ]) {
    test(`dashboard and core pages maintain integrity at ${vp.width}px (${vp.name})`, async ({
      page,
    }) => {
      await mockPlatformAuthenticator(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page);

      // 1. Dashboard
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
      // Regression guard: Appearance's Light/System/Dark labels must never split mid-word.
      await assertSingleLineLabels(page, '.mobile-segmented-option span');
      await page.screenshot({ path: `screenshots/responsive/more-${vp.width}.png` });

      // 7. Schedules
      await page.goto('/m/schedules');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/schedules-${vp.width}.png` });

      // 8. Services
      await page.goto('/m/services');
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/services-${vp.width}.png` });

      // 9. Service detail
      await page.goto(`/m/services/${matrixServiceId}`);
      await assertResponsiveIntegrity(page);

      // 10. Status
      await page.goto('/m/status');
      await assertResponsiveIntegrity(page);

      // 11. Users
      await page.goto('/m/users');
      await assertResponsiveIntegrity(page);

      // 12. Teams
      await page.goto('/m/teams');
      await assertResponsiveIntegrity(page);

      // 13. Policies
      await page.goto('/m/policies');
      await assertResponsiveIntegrity(page);

      // 14. Postmortems
      await page.goto('/m/postmortems');
      await assertResponsiveIntegrity(page);

      // 15. Analytics
      await page.goto('/m/analytics');
      await assertResponsiveIntegrity(page);
    });
  }
});
