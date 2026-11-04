import { defineConfig } from '@playwright/test';

// The complete single sign-on journey against a disposable instance and the local mock
// provider in tests/e2e/fixtures/mock-oidc-provider.mjs. See the spec header for setup.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'sso-journey.spec.ts',
  timeout: 600000,
  expect: { timeout: 60000 },
  workers: 1,
  use: {
    headless: true,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
    // Both the instance (behind a local TLS proxy) and the mock provider use a self-signed cert.
    ignoreHTTPSErrors: process.env.SSO_JOURNEY_ALLOW_SELF_SIGNED === '1',
    launchOptions: { args: ['--host-resolver-rules=MAP idp.example.test 127.0.0.1'] },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
