import { expect, test } from '@playwright/test';
import { DOCS_FIXTURES } from '../fixtures/constants';
import { captureEvidence } from '../helpers/evidence';

test.describe.serial('incident lifecycle documentation journey', () => {
  test('lists and acknowledges the synthetic incident', async ({ page }, testInfo) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
    await expect(page.getByText(DOCS_FIXTURES.incident).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'incidents', 'list');

    await page.getByRole('link', { name: DOCS_FIXTURES.incident, exact: true }).first().click();
    await expect(page).toHaveURL(/\/incidents\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: DOCS_FIXTURES.incident, exact: true })).toBeVisible();
    await captureEvidence(page, testInfo, 'incidents', 'detail');

    const acknowledge = page.getByRole('button', { name: 'Acknowledge', exact: true }).first();
    if (await acknowledge.isVisible()) await acknowledge.click();
    await expect(page.getByText('Acknowledged').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'incidents', 'acknowledge');

    await page.getByText('Timeline', { exact: true }).first().click();
    const timelineEvent = page.getByText(/Incident triggered by production monitoring|acknowledged/i).first();
    await expect(timelineEvent).toBeVisible();
    await timelineEvent.scrollIntoViewIfNeeded();
    await captureEvidence(page, testInfo, 'incidents', 'timeline');

    await page.goto('/incidents');
    await expect(page.getByText(DOCS_FIXTURES.incident).first()).toBeVisible();
    await page.getByRole('button', { name: /Create incident/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Declare Incident' })).toBeVisible();
    await expect(page.getByLabel(/Incident Title/)).toBeVisible();
    await captureEvidence(page, testInfo, 'incidents', 'create');
  });
});
