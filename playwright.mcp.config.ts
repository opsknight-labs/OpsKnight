import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'mcp.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  outputDir: process.env.MCP_E2E_OUTPUT ?? join(tmpdir(), 'opsknight-mcp-browser-results'),
  reporter: [['list']],
  use: {
    baseURL: process.env.MCP_E2E_BASE_URL ?? 'http://localhost:3042',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
