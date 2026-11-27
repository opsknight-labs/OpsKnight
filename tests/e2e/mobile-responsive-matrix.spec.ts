import { test, expect } from '@playwright/test';
import bcrypt from 'bcryptjs';
import {
  assertResponsiveIntegrity,
  assertSingleLineLabels,
  checkResponsiveIntegrity,
} from '../lib/assert-responsive-integrity';
import { VIEWPORT_MATRIX } from '../lib/responsive-viewport-matrix';
import { createPrismaClient } from '../../src/lib/db/create-client';

const prisma = createPrismaClient();
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
    await page.route('**/api/realtime/stream', route =>
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: ': heartbeat\n\n',
      })
    );
    await page.route('**/api/notifications/stream', route =>
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: ': heartbeat\n\n',
      })
    );
  });

  test.afterAll(async () => {
    await prisma.incident.deleteMany({ where: { id: 'mobile-matrix-incident-fixture' } });
    await prisma.service.deleteMany({ where: { name: 'Matrix Service' } });
    await prisma.$disconnect();
  });

  test('auditor distinguishes real small targets from inert drawers and expanded hit areas', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`
      <style>
        body { margin: 0; }
        button { position: absolute; width: 32px; height: 32px; padding: 0; }
        #expanded { left: 50px; top: 50px; }
        #expanded::after, #clipped::after {
          content: ''; position: absolute; left: 50%; top: 50%;
          width: 44px; height: 44px; transform: translate(-50%, -50%);
        }
        #small { left: 150px; top: 50px; }
        #clip { position: absolute; left: 220px; top: 50px; width: 32px; height: 32px; overflow: hidden; }
        #clipped { left: 0; top: 0; }
        #closed { position: fixed; left: -300px; top: 50px; }
        #closed button { position: static; }
        #icon { left: 50px; top: 150px; white-space: nowrap; overflow: hidden; }
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
        #icon svg { width: 37px; height: 20px; }
      </style>
      <aside id="closed" inert><button>Hidden</button></aside>
      <button id="expanded" aria-label="Expanded"></button>
      <button id="small" aria-label="Too small"></button>
      <div id="clip"><button id="clipped" aria-label="Clipped"></button></div>
      <button id="icon"><svg></svg><span class="sr-only">Icon description</span></button>
    `);
    const violations = await checkResponsiveIntegrity(page);
    expect(
      violations
        .filter(item => item.type === 'TOUCH_TARGET_BELOW_44PX')
        .map(item => item.selector)
        .sort()
    ).toEqual(['#clipped', '#icon', '#small']);
    expect(violations.filter(item => item.type === 'NOWRAP_OVERFLOW_NO_ELLIPSIS')).toEqual([]);
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
      // Intelligence is one strip under the actions (only when it has something to say) and a bottom
      // sheet on demand: there is no separate mobile intelligence card, and never an empty one.
      await expect(page.getByTestId('mobile-intelligence')).toHaveCount(0);
      const intelligenceStrip = page.getByTestId('intelligence-strip');
      if (await intelligenceStrip.count()) {
        const stripBox = (await intelligenceStrip.boundingBox())!;
        expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(vp.height);
        expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(vp.width);
      }
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

      // 15. Analytics (responsive desktop page; no /m twin)
      await page.goto('/insights');
      await assertResponsiveIntegrity(page);

      // 16. AIOps (More menu): the overview's Noise section and, when non-empty, its inbox
      await page.goto('/m/intelligence');
      await expect(page.getByRole('region', { name: 'Noise', exact: true })).toBeVisible();
      await assertResponsiveIntegrity(page);
      await page.screenshot({ path: `screenshots/responsive/intelligence-${vp.width}.png` });
    });
  }
});
