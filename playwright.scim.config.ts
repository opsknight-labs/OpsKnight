import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'scim-provisioning.spec.ts',
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  use: {
    baseURL: process.env.SCIM_E2E_BASE_URL,
    headless: true,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
