import { defineConfig, devices } from '@playwright/test';

/**
 * Dashboard live-incident certification.
 *
 * Runs against an isolated local database only (see scripts/dev/seed-dashboard-live.ts):
 *   set -a && source .env.dashboard.local && set +a
 *   npm run dev                              # or a production build: npm run build && npm start
 *   npm run test:e2e:dashboard
 *
 * Projects run serially because every project mutates the same fixture dataset.
 */
const baseURL = process.env.DASHBOARD_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /dashboard-live\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: 'test-results/dashboard',
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
    {
      // Firefox has no mobile emulation; certify the narrow layout with a phone-sized viewport.
      name: 'mobile-firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: process.env.DASHBOARD_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
