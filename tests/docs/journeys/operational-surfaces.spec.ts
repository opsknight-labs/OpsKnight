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

  test('captures service and team ownership', async ({ page }, testInfo) => {
    await page.goto('/services');
    await expect(page.getByText(DOCS_FIXTURES.service).first()).toBeVisible();
    await expect(page.getByText('Edge Gateway').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'services', 'list');

    await page.goto('/teams');
    await expect(page.getByText(DOCS_FIXTURES.team).first()).toBeVisible();
    await expect(page.getByText('Platform Infrastructure').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'teams', 'list');
  });

  test('captures action and reporting surfaces', async ({ page }, testInfo) => {
    await page.goto('/action-items');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'response', 'action-items');

    await page.goto('/analytics');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'analytics', 'overview');

    await page.goto('/reports');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'analytics', 'reports');
  });

  test('captures audit and operational inspection surfaces', async ({ page }, testInfo) => {
    await page.goto('/audit');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'administration', 'audit-log');

    await page.goto('/events');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'operations', 'events');

    await page.goto('/system-logs');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'operations', 'system-logs');
  });
});
