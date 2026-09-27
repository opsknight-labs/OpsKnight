import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.DOCS_DATABASE_URL ||
  'postgresql://opsknight_docs:opsknight_docs@127.0.0.1:55432/opsknight_docs?schema=public';
process.env.DOCS_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  testDir: './tests/docs/journeys',
  globalSetup: './tests/docs/environment/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [['line'], ['html', { outputFolder: 'generated/docs-test-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'docs-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --hostname 0.0.0.0 --port 3200',
    url: 'http://127.0.0.1:3200/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_DATABASE_URL: databaseUrl,
      NEXTAUTH_URL: 'http://127.0.0.1:3200',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3200',
      NEXTAUTH_SECRET: 'docs-runtime-only-nextauth-secret',
      ENCRYPTION_KEY: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      NEXTAUTH_COOKIE_SECURE: 'false',
      PORT: '3200',
      HOSTNAME: '0.0.0.0',
    },
  },
});
