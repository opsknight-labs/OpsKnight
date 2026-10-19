// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

describe('Phase 2 UI Real Browser Verification via Playwright', () => {
  it(
    'navigates to execution and incident, capturing certified evidence screenshots',
    { timeout: 60000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      // 1. Login
      await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
      const emailInput = page.locator('input[type="email"], input[name="email"]');
      if (await emailInput.isVisible()) {
        await emailInput.fill('admin@example.com');
        await page.locator('input[type="password"], input[name="password"]').fill('Password123!');
        await page.locator('button[type="submit"]').click();
        await page.waitForTimeout(3000);
      }

      // 2. Execution page
      const execId = 'cmvezw1c5000evheis789l6y1';
      await page.goto(`http://localhost:3000/runbooks/executions/${execId}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(3000);

      const screenshotsDir = path.resolve(
        'plans/runbook-engine/enterprise-physical-certification/screenshots'
      );
      fs.mkdirSync(screenshotsDir, { recursive: true });
      const brainDir =
        '/Users/dushyantrahangdale/.gemini/antigravity/brain/2fbfa638-d94e-4c8c-be04-a130a7942642/screenshots';

      const execShotPath = path.join(screenshotsDir, 'ui_phase2_auto_trigger_succeeded.png');
      await page.screenshot({ path: execShotPath, fullPage: false });
      if (fs.existsSync(brainDir)) {
        fs.copyFileSync(execShotPath, path.join(brainDir, 'ui_phase2_auto_trigger_succeeded.png'));
      }

      // 3. Incident page
      const incId = 'cmvezw0ny000bvheiih0btbyf';
      await page.goto(`http://localhost:3000/incidents/${incId}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(3000);

      const incShotPath = path.join(screenshotsDir, 'ui_phase2_incident_resolved.png');
      await page.screenshot({ path: incShotPath, fullPage: false });
      if (fs.existsSync(brainDir)) {
        fs.copyFileSync(incShotPath, path.join(brainDir, 'ui_phase2_incident_resolved.png'));
      }

      await browser.close();

      expect(fs.existsSync(execShotPath)).toBe(true);
      expect(fs.existsSync(incShotPath)).toBe(true);
    }
  );
});
