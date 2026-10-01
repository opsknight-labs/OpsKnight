import { expect, test } from '@playwright/test';
import { DOCS_FIXTURES } from '../fixtures/constants';
import { captureEvidence } from '../helpers/evidence';

test.describe.serial('operational documentation surfaces', () => {
  test('captures schedule and escalation policy state', async ({ page }, testInfo) => {
    await page.goto('/schedules');
    await expect(page.getByText(DOCS_FIXTURES.schedule).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'on-call', 'schedules');
    await page.getByText(DOCS_FIXTURES.schedule, { exact: true }).first().click();
    await expect(page).toHaveURL(/\/schedules\/[^/]+$/);
    await expect(page.getByText(DOCS_FIXTURES.schedule, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /Rotation/ })).toBeVisible();
    await captureEvidence(page, testInfo, 'on-call', 'schedule-detail');

    await page.goto('/policies');
    await expect(page.getByText(DOCS_FIXTURES.policy).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'escalation', 'policies');
    await page.getByText(DOCS_FIXTURES.policy, { exact: true }).first().click();
    await expect(page).toHaveURL(/\/policies\/[^/]+$/);
    await expect(page.getByText(DOCS_FIXTURES.policy, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Escalation Steps', { exact: true }).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'escalation', 'policy-detail');
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
    await expect(page.getByText(/Incidents \(\d+d\)/).first()).toBeVisible();
    await expect(page.getByText(/Active Incidents · Current/).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'analytics', 'overview');

    await page.goto('/reports');
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.getByText('Production Reliability Overview').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'analytics', 'reports');

    await page.goto('/reports/executive?template=sre-operations');
    await expect(page.getByText('SRE Operations').first()).toBeVisible();
    await expect(page.getByText('Incident Calendar').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'analytics', 'dashboard-template');

    await page.goto('/reports/executive/docs-dashboard-executive');
    await expect(page.getByText('Production Reliability Overview').first()).toBeVisible();
    await expect(page.getByText('Service Health').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'analytics', 'dashboard-saved');

    await page.getByRole('button', { name: 'Dashboard settings' }).click();
    await page.getByText('Edit Dashboard', { exact: true }).click();
    await expect(page.getByText(/Editing mode/)).toBeVisible();
    await captureEvidence(page, testInfo, 'analytics', 'dashboard-edit');
  });

  test('captures audit and operational inspection surfaces', async ({ page }, testInfo) => {
    await page.goto('/audit');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'administration', 'audit-log');

    await page.goto('/events');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'operations', 'events');

    await page.goto('/system-logs');
    await expect(page).toHaveURL('/system-logs');
    await expect(page.getByRole('heading', { level: 1, name: 'System Logs' })).toBeVisible();
    await expect(page.getByText('Real-time application logging and error tracking')).toBeVisible();
    await captureEvidence(page, testInfo, 'operations', 'system-logs');
  });

  test('captures security and configuration surfaces', async ({ page }, testInfo) => {
    await page.goto('/settings/api-keys');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'administration', 'api-keys');

    await page.goto('/settings/custom-fields');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'administration', 'custom-fields');

    await page.goto('/settings/security');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'identity', 'security-settings');

    await page.goto('/settings/privacy-requests');
    await expect(page.locator('#main-content')).toBeVisible();
    await captureEvidence(page, testInfo, 'administration', 'privacy-requests');
  });

  test('captures runtime health', async ({ page }, testInfo) => {
    await page.goto('/settings/system/health');
    await expect(page).toHaveURL('/settings/system/health');
    await expect(page.getByText('System Health Center', { exact: true }).first()).toBeVisible();
    await captureEvidence(page, testInfo, 'operations', 'health-center');
  });

  test('captures the postmortem workflow', async ({ page }, testInfo) => {
    await page.goto('/postmortems');
    await expect(page.getByText('Transactional email delivery degradation review').first()).toBeVisible();
    await captureEvidence(page, testInfo, 'response', 'postmortems');
  });
});
