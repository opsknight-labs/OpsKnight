import { expect, test } from '@playwright/test';
import { DOCS_FIXTURES } from '../fixtures/constants';
import { captureEvidence } from '../helpers/evidence';

test.describe.serial('operational documentation surfaces', () => {
  test('captures schedule and escalation policy state', async ({ page }, testInfo) => {
    await page.goto('/schedules');
    await expect(page.getByText(DOCS_FIXTURES.schedule).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'on-call', 'schedules');

    await page.goto('/policies');
    await expect(page.getByText(DOCS_FIXTURES.policy).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'escalation', 'policies');
  });

  test('captures notification and status administration', async ({ page }, testInfo) => {
    await page.goto('/settings/notifications');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'notifications', 'settings');

    await page.goto('/settings/status-pages');
    await expect(page.getByText(DOCS_FIXTURES.statusPage).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'status-pages', 'list');
  });

  test('captures integration and user administration', async ({ page }, testInfo) => {
    await page.goto('/settings/integrations');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'integrations', 'settings');

    await page.goto('/users');
    await expect(page.getByText('daniel.kim@opsknight.com').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'administration', 'users');
  });
});
