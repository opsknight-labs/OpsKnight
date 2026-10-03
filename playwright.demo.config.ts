import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.DOCS_BASE_URL || 'http://localhost:13200';

export default defineConfig({
  testDir: './tests/demo-video',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 420_000,
  expect: { timeout: 30_000 },
  outputDir: 'test-results/demo-video/output',
  reporter: [['line']],
  use: {
    baseURL,
    serviceWorkers: 'block',
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'demo-auth',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'demo-tour',
      testMatch: /tour\.spec\.ts/,
      dependencies: ['demo-auth'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        storageState: 'test-results/demo-video-auth.json',
        video: {
          mode: 'on',
          size: { width: 1920, height: 1080 },
        },
      },
    },
  ],
  webServer:
    process.env.DOCS_EXTERNAL_RUNTIME === 'true'
      ? undefined
      : {
          command: 'sh scripts/docs/serve-test-image.sh',
          url: `${baseURL}/login`,
          reuseExistingServer: true,
          timeout: 300_000,
        },
});
