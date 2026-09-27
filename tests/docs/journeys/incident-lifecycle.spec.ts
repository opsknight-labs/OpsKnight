import { expect, test } from '@playwright/test';
import { DOCS_FIXTURES } from '../fixtures/constants';
import { captureEvidence } from '../helpers/evidence';
import { loginAsDocsAdmin } from '../helpers/session';

test.describe.serial('incident lifecycle documentation journey', () => {
  test.beforeEach(async ({ page }) => loginAsDocsAdmin(page));

  test('lists and acknowledges the synthetic incident', async ({ page }, testInfo) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
    await expect(page.getByText(DOCS_FIXTURES.incident).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'incidents', 'list');

    await page.getByText(DOCS_FIXTURES.incident).first().click();
    await expect(page.getByRole('heading', { name: DOCS_FIXTURES.incident })).toBeVisible();
    await captureEvidence(page, testInfo, 'incidents', 'detail');

    const acknowledge = page.getByRole('button', { name: 'Acknowledge', exact: true }).first();
    if (await acknowledge.isVisible()) await acknowledge.click();
    await expect(page.getByText('Acknowledged').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'incidents', 'acknowledge');
  });
});

