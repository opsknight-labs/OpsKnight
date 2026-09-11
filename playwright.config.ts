import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5432/opsknight_e2e?schema=public';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    // CI exercises the real Next.js dev server. The first invocation of a
    // Server Action may include on-demand compilation, so keep assertions
    // strict but avoid treating that one-time compile as an auth failure.
    timeout: 15_000,
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
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
    },
  },
});
