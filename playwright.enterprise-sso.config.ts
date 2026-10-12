import { defineConfig } from '@playwright/test';

// Supply SSO_E2E_BASE_URL / SSO_E2E_ADMIN_EMAIL / SSO_E2E_ADMIN_PASSWORD for a
// disposable migrated instance. This config never starts or modifies a deployment.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'enterprise-authentication.spec.ts',
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  use: {
    headless: true,
    trace: 'off',
    // Self-signed TLS is permitted only for this explicitly selected local fixture.
    ignoreHTTPSErrors:
      process.env.SSO_E2E_ALLOW_SELF_SIGNED === '1' &&
      Boolean(
        process.env.SSO_E2E_BASE_URL &&
        new URL(process.env.SSO_E2E_BASE_URL).hostname === 'localhost'
      ),
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
