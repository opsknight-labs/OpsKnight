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
  timeout: 60_000,
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
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /(auth-recovery|navigation-fast-path|host-bootstrap-routing)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--host-resolver-rules=MAP *.opsknight.test 127.0.0.1,MAP opsknight.test 127.0.0.1,MAP *.customer.test 127.0.0.1,MAP customer.test 127.0.0.1,MAP *.attacker.test 127.0.0.1,MAP attacker.test 127.0.0.1',
          ],
        },
      },
    },
    {
      name: 'mobile-chromium',
      testMatch: /mobile-(pwa|responsive-matrix)\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-webkit',
      testMatch: /mobile-(pwa|responsive-matrix)\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: useProductionServer
      ? 'npm run start:dev -- --hostname 0.0.0.0 --port 3100'
      : 'npm run dev -- --hostname 0.0.0.0 --port 3100',
    url: 'http://127.0.0.1:3100/setup',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      NEXTAUTH_SECRET: 'opsknight-e2e-nextauth-secret-change-me',
      ENCRYPTION_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      NEXTAUTH_COOKIE_SECURE: 'false',
      TRUST_PROXY_HEADERS: process.env.TRUST_PROXY_HEADERS || 'false',
      PORT: '3100',
      HOSTNAME: '0.0.0.0',
    },
  },
});
