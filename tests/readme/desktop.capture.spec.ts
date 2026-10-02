import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DOCS_FIXTURES } from '../docs/fixtures/constants';
import { assertEvidenceReady } from '../docs/helpers/evidence';

const output = resolve('generated/readme-captures/desktop');

async function capture(page: Page, name: string) {
  await assertEvidenceReady(page);
  // Let charts and count-up animations settle; `animations: 'disabled'` only
  // covers CSS animations and transitions.
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
}

test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
});

test('captures current desktop product surfaces', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Command Center', { exact: true }).first()).toBeVisible();
  await capture(page, 'command-center');

  await page.goto('/incidents');
  await expect(page.getByText(DOCS_FIXTURES.incident, { exact: true }).first()).toBeVisible();
  await capture(page, 'incident-list');
  await page.getByText(DOCS_FIXTURES.incident, { exact: true }).first().click();
  await expect(page).toHaveURL(/\/incidents\/[^/]+$/);
  await capture(page, 'incident-detail');

  await page.goto('/analytics');
  await expect(page.getByText('Analytics & Insights', { exact: true })).toBeVisible();
  await capture(page, 'analytics-overview');

  await page.goto('/schedules');
  await expect(page.getByText(DOCS_FIXTURES.schedule, { exact: true }).first()).toBeVisible();
  await page.getByText(DOCS_FIXTURES.schedule, { exact: true }).first().click();
  await expect(page).toHaveURL(/\/schedules\/[^/]+$/);
  await capture(page, 'on-call-schedule');

  await page.goto('/policies');
  await expect(page.getByText(DOCS_FIXTURES.policy, { exact: true }).first()).toBeVisible();
  await page.getByText(DOCS_FIXTURES.policy, { exact: true }).first().click();
  await expect(page).toHaveURL(/\/policies\/[^/]+$/);
  await capture(page, 'escalation-policy');

  await page.goto('/services');
  await expect(page.getByText(DOCS_FIXTURES.service, { exact: true }).first()).toBeVisible();
  await capture(page, 'service-catalog');
});
