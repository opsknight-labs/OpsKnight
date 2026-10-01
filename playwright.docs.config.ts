import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.DOCS_DATABASE_URL ||
  'postgresql://opsknight_docs:opsknight_docs@127.0.0.1:15432/opsknight_docs?schema=public';
process.env.DOCS_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;
process.env.DOCS_OPSKNIGHT_IMAGE ||= 'opsknight-docs-v2@sha256:c5a9bce0deaa5bc64747b064020d3f2a678aeabd4a7ee43f3ef1d005d7812701';
const baseURL = process.env.DOCS_BASE_URL || 'http://localhost:13200';

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
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'docs-auth', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'docs-chromium',
      testIgnore: /auth\.setup\.ts/,
      dependencies: ['docs-auth'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'test-results/docs-auth.json' },
    },
  ],
  webServer: process.env.DOCS_EXTERNAL_RUNTIME === 'true' ? undefined : {
    command: 'sh scripts/docs/serve-test-image.sh',
    url: 'http://localhost:13200/login',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
