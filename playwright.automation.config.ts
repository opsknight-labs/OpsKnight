import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /automation\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 30000 },
  reporter: [['line'], ['json', { outputFile: 'artifacts/automation-ui/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:3193',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'tablet', use: { ...devices['iPad Pro 11'] } },
  ],
  webServer: {
    command:
      process.env.PLAYWRIGHT_PRODUCTION_SERVER === 'true'
        ? 'npm run start:dev -- --hostname 127.0.0.1 --port 3193'
        : 'npm run dev -- --hostname 127.0.0.1 --port 3193',
    url: 'http://127.0.0.1:3193/login',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      NEXTAUTH_URL: 'http://127.0.0.1:3193',
      NEXTAUTH_SECRET: 'automation-local-e2e-signing-secret-32-characters',
      API_KEY_SECRET: 'automation-local-e2e-api-key-secret-32-characters',
      ENCRYPTION_KEY: '68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba',
      NEXTAUTH_COOKIE_SECURE: 'false',
      OPSKNIGHT_PROCESS_ROLE: 'web',
    },
  },
});
