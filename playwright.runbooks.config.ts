import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/runbook_ui_test') {
  throw new Error('Runbook browser tests require a dedicated runbook_ui_test database.');
}
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /runbooks-ui\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3205',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      process.env.PLAYWRIGHT_PRODUCTION_SERVER === 'true'
        ? 'npm run start:dev -- --hostname 127.0.0.1 --port 3205'
        : 'npm run dev -- --hostname 127.0.0.1 --port 3205',
    url: 'http://127.0.0.1:3205/login',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      NEXTAUTH_URL: 'http://127.0.0.1:3205',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3205',
      NEXTAUTH_SECRET: 'runbook-ui-test-session-signing-independent-secret',
      API_KEY_SECRET: 'runbook-ui-test-api-key-independent-secret',
      ENCRYPTION_KEY: '68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba',
      NEXTAUTH_COOKIE_SECURE: 'false',
      TRUST_PROXY_HEADERS: 'false',
    },
  },
});
