import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { DOCS_FIXTURES } from '../docs/fixtures/constants';
import { assertEvidenceReady } from '../docs/helpers/evidence';

const output = resolve('generated/readme-captures/desktop');

async function capture(page: import('@playwright/test').Page, name: string) {
  await assertEvidenceReady(page);
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    animations: 'disabled',
    fullPage: false,
  });
}

test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
});

test('captures current desktop product surfaces', async ({ page }) => {
  await page.goto('/incidents');
  await expect(page.getByText(DOCS_FIXTURES.incident, { exact: true }).first()).toBeVisible();
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
});
