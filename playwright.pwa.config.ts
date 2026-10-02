import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5432/opsknight_e2e?schema=public';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /mobile-pwa-production\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'pwa-production-chromium',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'pwa-production-webkit',
      use: { ...devices['iPhone 14'], serviceWorkers: 'allow' },
    },
  ],
  webServer: {
    // The production PWA contract must run against a built Next.js application;
    // next-pwa intentionally disables service-worker generation in `next dev`.
    command: 'npm run start:dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      NEXTAUTH_URL: 'http://127.0.0.1:3100',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
      NEXTAUTH_SECRET: 'opsknight-e2e-session-signing-secret-7c41d9e2b8',
      API_KEY_SECRET: 'opsknight-e2e-api-key-secret-independent-32chars',
      ENCRYPTION_KEY: '68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba',
      AUTH_TRUST_HOST: 'true',
      NODE_ENV: 'production',
    },
  },
});
