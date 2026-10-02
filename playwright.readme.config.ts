import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.DOCS_DATABASE_URL ||
  'postgresql://opsknight_docs:opsknight_docs@127.0.0.1:15432/opsknight_docs?schema=public';

process.env.DOCS_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;
process.env.API_KEY_SECRET ||= 'docs-runtime-only-api-key-secret';
process.env.DOCS_OPSKNIGHT_IMAGE ||=
  'localhost:15000/opsknight-docs-v2@sha256:0ac0900f61f3a8d8f8c3b160661620261319ceb561882f1da5bfb4a985268107';
process.env.DOCS_IMAGE_PULL_POLICY ||= 'never';

const baseURL = process.env.DOCS_BASE_URL || 'http://localhost:13200';

export default defineConfig({
  testDir: './tests/readme',
  globalSetup: './tests/docs/environment/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [['line']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'readme-auth',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'readme-desktop',
      testMatch: /desktop\.capture\.spec\.ts/,
      dependencies: ['readme-auth'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: 2,
        storageState: 'test-results/readme-auth.json',
      },
    },
    ...(['light', 'dark'] as const).map(colorScheme => ({
      name: `readme-mobile-${colorScheme}`,
      testMatch: /mobile\.capture\.spec\.ts/,
      dependencies: ['readme-auth'],
      use: {
        ...devices['iPhone 15 Pro'],
        browserName: 'webkit' as const,
        colorScheme,
        // iPhone 15 Pro is 393x852 pt; the composed device frame draws the
        // 54 pt iOS status bar above the captured web content.
        viewport: { width: 393, height: 798 },
        storageState: 'test-results/readme-auth.json',
      },
    })),
  ],
  webServer:
    process.env.DOCS_EXTERNAL_RUNTIME === 'true'
      ? undefined
      : {
          command: 'sh scripts/docs/serve-test-image.sh',
          url: `${baseURL}/login`,
          reuseExistingServer: false,
          timeout: 300_000,
        },
});
