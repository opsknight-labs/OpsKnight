import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5432/opsknight_e2e?schema=public';
const useProductionServer = process.env.PLAYWRIGHT_PRODUCTION_SERVER === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  // The generated service-worker contract has its own production-build config.
  // Never run it against `next dev`, where next-pwa intentionally does not emit /sw.js.
  testIgnore: /mobile-pwa-production\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    // Development runs compile routes lazily. Keep the extra allowance locally;
    // CI runs the production server below so browser contracts are deterministic.
    timeout: 30_000,
  },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /auth-recovery\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /mobile-pwa\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-webkit',
      testMatch: /mobile-pwa\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: useProductionServer
      ? 'npm run build && npm run start'
      : 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/setup',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      NEXTAUTH_URL: 'http://127.0.0.1:3100',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
      NEXTAUTH_SECRET: 'opsknight-e2e-nextauth-secret-change-me',
      ENCRYPTION_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      AUTH_TRUST_HOST: 'true',
      PORT: '3100',
      HOSTNAME: '127.0.0.1',
    },
  },
});
