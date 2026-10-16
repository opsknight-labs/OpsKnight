import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.RUNBOOK_UI_PORT ?? 3205);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('RUNBOOK_UI_PORT must be an integer between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;

const databaseUrl = process.env.DATABASE_URL;
if (
  !databaseUrl ||
  !['/runbook_ui_test', '/rbe_engine_test'].includes(new URL(databaseUrl).pathname)
) {
  throw new Error('Runbook browser tests require a dedicated runbook_ui_test database.');
}
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /runbooks-ui\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  timeout: 120000,
  expect: { timeout: 30000 },
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      process.env.PLAYWRIGHT_PRODUCTION_SERVER === 'true'
        ? `npm run start:dev -- --hostname 127.0.0.1 --port ${port}`
        : `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/login`,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: databaseUrl,
      // Planner/Agent boundaries are seeded explicitly by this UI suite.
      OPSKNIGHT_PROCESS_ROLE: 'web',
      DIRECT_URL: databaseUrl,
      NEXTAUTH_URL: origin,
      NEXT_PUBLIC_APP_URL: origin,
      NEXTAUTH_SECRET: 'runbook-ui-test-session-signing-independent-secret',
      API_KEY_SECRET: 'runbook-ui-test-api-key-independent-secret',
      ENCRYPTION_KEY: '68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba',
      NEXTAUTH_COOKIE_SECURE: 'false',
      TRUST_PROXY_HEADERS: 'false',
    },
  },
});
