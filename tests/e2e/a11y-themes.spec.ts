import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { THEME_STORAGE_KEY } from '@/lib/theme-preference';

const prisma = new PrismaClient();
const email = process.env.E2E_ADMIN_EMAIL || 'e2e-a11y-themes@example.com';
const password = process.env.E2E_ADMIN_PASSWORD || 'A11yThemes-Secure-Pass-417!';

const ROUTES = ['/', '/services', '/teams', '/policies', '/schedules', '/users', '/settings'];
const THEMES = [
  { name: 'light', preference: 'LIGHT', htmlClass: /\blight\b/ },
  { name: 'dark', preference: 'DARK', htmlClass: /\bdark\b/ },
] as const;

async function ensureTestUser() {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    create: { email, name: 'A11y Themes Admin', passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
}

async function login(page: Page) {
  await page.goto('/login');
  if (new URL(page.url()).pathname === '/login') {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
  }
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

test.describe.serial('accessibility in light and dark themes', () => {
  test.beforeAll(ensureTestUser);

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  for (const theme of THEMES) {
    test.describe(`${theme.name} theme`, () => {
      test.beforeEach(async ({ page }) => {
        // The account preference wins over the browser copy, so set both.
        await prisma.user.update({ where: { email }, data: { themePreference: theme.preference } });
        await page.addInitScript(
          ([key, value]) => {
            try {
              localStorage.setItem(key, value);
            } catch {
              // storage blocked; the account preference still applies
            }
          },
          [THEME_STORAGE_KEY, theme.name]
        );
        await login(page);
      });

      for (const route of ROUTES) {
        test(`${route} has no serious or critical WCAG A/AA violations`, async ({
          page,
        }, testInfo) => {
          await page.goto(route);
          await page.waitForLoadState('networkidle');
          await expect(page.locator('html')).toHaveClass(theme.htmlClass);

          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
          const blocking = results.violations.filter(
            violation => violation.impact === 'serious' || violation.impact === 'critical'
          );
          await testInfo.attach(`axe-${theme.name}-${route.replace(/\W+/g, '_') || 'root'}`, {
            body: JSON.stringify(blocking, null, 2),
            contentType: 'application/json',
          });
          expect(
            blocking.map(violation => `${violation.id}: ${violation.nodes.length} node(s)`)
          ).toEqual([]);
        });
      }
    });
  }
});
