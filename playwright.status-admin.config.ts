import { defineConfig } from '@playwright/test';
import runbookBrowserConfig from './playwright.runbooks.config';

// Fixtures and the reused application server must sign credentials with the same key.
process.env.API_KEY_SECRET = 'runbook-ui-test-api-key-independent-secret';

// Reuse the isolated production-app browser matrix and database safety checks.
export default defineConfig(runbookBrowserConfig, {
  testMatch: /status-page-administration\.spec\.ts/,
});
