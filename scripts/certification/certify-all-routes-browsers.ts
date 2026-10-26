import dotenv from 'dotenv';
if (process.env.DOTENV_CONFIG_PATH) {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, override: true });
} else {
  dotenv.config({ override: false });
}
import { chromium, firefox, webkit, type Browser, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://opsknight:91de63e34fe6e0747d0126df7ccff379bd6252dc8801c12f@127.0.0.1:55490/opsknight?sslmode=disable';
const BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:3900';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

const TEST_EMAIL = 'cert-browser-admin@opsknight.internal';
const TEST_PASSWORD = 'Browser-Pass-2026-Cert!';

const VIEWPORTS = [
  { name: 'Desktop', width: 1280, height: 800 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 375, height: 812 },
];

const DESKTOP_ROUTES = [
  { path: '/', label: 'Command Center / Home' },
  { path: '/incidents', label: 'Incidents Directory' },
  { path: '/incidents/create', label: 'Create Incident Form' },
  { path: '/services', label: 'Services Directory' },
  { path: '/policies', label: 'Escalation Policies' },
  { path: '/policies/create', label: 'Create Escalation Policy' },
  { path: '/schedules', label: 'On-Call Schedules' },
  { path: '/teams', label: 'Teams Directory' },
  { path: '/users', label: 'User Directory' },
  { path: '/runbooks', label: 'Runbooks Catalog' },
  { path: '/runbooks/executions', label: 'Runbook Executions' },
  { path: '/analytics', label: 'Analytics & SLA' },
  { path: '/reports', label: 'Operational Reports' },
  { path: '/postmortems', label: 'Postmortems Workspace' },
  { path: '/audit', label: 'Audit Logs' },
  { path: '/settings', label: 'Settings Hub' },
  { path: '/settings/api-keys', label: 'API Keys Management' },
  { path: '/settings/integrations', label: 'Integrations Hub' },
  { path: '/settings/status-pages', label: 'Status Page Admin' },
  { path: '/settings/notifications', label: 'Notification Settings' },
  { path: '/settings/system/health', label: 'Health Center' },
];

const MOBILE_PWA_ROUTES = [
  { path: '/m', label: 'Mobile Home / Active Incidents' },
  { path: '/m/incidents', label: 'Mobile Incidents List' },
  { path: '/m/incidents/create', label: 'Mobile Quick Incident' },
  { path: '/m/services', label: 'Mobile Services' },
  { path: '/m/schedules', label: 'Mobile On-Call Schedule' },
  { path: '/m/policies', label: 'Mobile Escalation Policies' },
  { path: '/m/more', label: 'Mobile More / Settings' },
];

interface TestResult {
  browser: string;
  viewport: string;
  route: string;
  status: 'PASS' | 'FAIL';
  loadTimeMs: number;
  hasHorizontalOverflow: boolean;
  errors: string[];
}

async function ensureUser() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  await prisma.rateLimit.deleteMany({
    where: { key: { contains: TEST_EMAIL } },
  });
  await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    update: {
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      id: `usr-browser-cert-${Date.now()}`,
      email: TEST_EMAIL,
      name: 'Browser QA Certifier',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
}

async function checkHorizontalOverflow(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
}

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  await emailInput.fill(TEST_EMAIL);
  await page.locator('input[type="password"]').fill(TEST_PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 25000 });
}

async function main() {
  console.log('======================================================================');
  console.log('OpsKnight P1 Full-Route Cross-Browser UI Certification');
  console.log('Browsers: Chromium, Firefox, WebKit');
  console.log('Viewports: Desktop (1280x800), Tablet (768x1024), Mobile (375x812)');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('======================================================================\n');

  await ensureUser();

  const results: TestResult[] = [];
  const browsers = [
    { name: 'Chromium', launcher: chromium },
    { name: 'Firefox', launcher: firefox },
    { name: 'WebKit', launcher: webkit },
  ];

  for (const b of browsers) {
    console.log(`\n================== BROWSER: ${b.name} ==================`);
    const browserInstance: Browser = await b.launcher.launch({ headless: true });

    for (const vp of VIEWPORTS) {
      console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
      const context = await browserInstance.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent:
          vp.name === 'Mobile'
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
            : undefined,
      });

      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', err => pageErrors.push(`PageError: ${err.message}`));

      try {
        await login(page);
        console.log(`✓ Authenticated as ${TEST_EMAIL}`);

        const routesToTest = vp.name === 'Mobile' ? MOBILE_PWA_ROUTES : DESKTOP_ROUTES;

        for (const route of routesToTest) {
          const startTime = Date.now();
          const routeErrors: string[] = [];

          try {
            const resp = await page.goto(`${BASE_URL}${route.path}`, {
              waitUntil: 'domcontentloaded',
              timeout: 15000,
            });

            const loadTime = Date.now() - startTime;
            const status = resp?.status() || 0;
            const overflow = await checkHorizontalOverflow(page);

            if (status >= 400) {
              routeErrors.push(`HTTP ${status}`);
            }
            if (overflow && vp.name !== 'Desktop') {
              routeErrors.push('Horizontal overflow detected');
            }

            const isPass = routeErrors.length === 0;
            results.push({
              browser: b.name,
              viewport: vp.name,
              route: route.path,
              status: isPass ? 'PASS' : 'FAIL',
              loadTimeMs: loadTime,
              hasHorizontalOverflow: overflow,
              errors: routeErrors,
            });

            console.log(
              `  [${isPass ? 'PASS' : 'FAIL'}] ${route.path.padEnd(28)} (${loadTime}ms) ${
                overflow ? '[OVERFLOW]' : ''
              } ${routeErrors.join(', ')}`
            );
          } catch (err: any) {
            results.push({
              browser: b.name,
              viewport: vp.name,
              route: route.path,
              status: 'FAIL',
              loadTimeMs: Date.now() - startTime,
              hasHorizontalOverflow: false,
              errors: [err.message],
            });
            console.log(`  [FAIL] ${route.path.padEnd(28)} Error: ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error(`Error during ${b.name} ${vp.name} run:`, err.message);
      } finally {
        await context.close();
      }
    }

    await browserInstance.close();
  }

  // Summary
  console.log('\n======================================================================');
  console.log('CROSS-BROWSER UI CERTIFICATION MATRIX SUMMARY');
  console.log('======================================================================');
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total Route Executions: ${total}`);
  console.log(`Passed:                 ${passed} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`Failed:                 ${failed}`);

  if (failed > 0) {
    console.log('\nFailed Executions:');
    for (const f of results.filter(r => r.status === 'FAIL')) {
      console.log(`  - ${f.browser} / ${f.viewport} / ${f.route}: ${f.errors.join('; ')}`);
    }
  }

  console.log('======================================================================\n');
}

main()
  .catch(err => {
    console.error('Browser certification failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
