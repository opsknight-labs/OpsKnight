import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DOCS_FIXTURES } from '../docs/fixtures/constants';
import { assertEvidenceReady } from '../docs/helpers/evidence';

async function capture(page: Page, scheme: string, name: string) {
  await assertEvidenceReady(page);
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: resolve('generated/readme-captures/mobile', scheme, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
}

test('captures current mobile PWA surfaces in WebKit', async ({ page }, testInfo) => {
  const scheme = testInfo.project.use.colorScheme === 'dark' ? 'dark' : 'light';
  await mkdir(resolve('generated/readme-captures/mobile', scheme), { recursive: true });

  await page.goto('/m');
  await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
  await capture(page, scheme, 'home');

  await page.goto('/m/incidents');
  await expect(page.getByText(DOCS_FIXTURES.incident, { exact: true }).first()).toBeVisible();
  await capture(page, scheme, 'incidents');
  await page.getByText(DOCS_FIXTURES.incident, { exact: true }).first().click();
  await expect(page).toHaveURL(/\/m\/incidents\/[^/]+$/);
  await expect(page.getByText(DOCS_FIXTURES.incident, { exact: true }).first()).toBeVisible();
  await capture(page, scheme, 'incident-detail');

  await page.goto('/m/schedules');
  await expect(page.getByText(DOCS_FIXTURES.schedule, { exact: true }).first()).toBeVisible();
  await capture(page, scheme, 'on-call');

  await page.goto('/m/analytics');
  await expect(page.getByText(/Analytics/i).first()).toBeVisible();
  await capture(page, scheme, 'analytics');
});
