import { defineConfig, devices } from '@playwright/test';

/**
 * Email rendering suite: renders every template from src/emails and checks it in
 * Chromium (Gmail web / new Outlook / Outlook.com are browser-rendered) and WebKit
 * (the Apple Mail engine), in light, dark and forced-inversion, at mobile → 4K widths.
 * No app server or database needed. Screenshots land in test-results/email/.
 *   npm run test:email:visual
 */
export default defineConfig({
  testDir: './tests/e2e/email',
  outputDir: './test-results/email',
  fullyParallel: true,
  retries: 0,
  timeout: 60_000,
  reporter: [['line']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
