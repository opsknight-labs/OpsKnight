import { test, expect } from '@playwright/test';

const APP_URL = process.env.CERTIFICATION_APP_URL || 'http://localhost:3000';
const ADMIN_EMAIL = 'cert-admin@opsknight.local';
const ADMIN_PASSWORD = 'Secure-Cert-Passphrase-2026!';

test.describe('Gate 2: Fresh-Install UI Journey', () => {
  test('completes system setup, logs in, and explores the Compliance Control Center', async ({
    page,
  }) => {
    // 1. Visit /setup or /login
    await page.goto(`${APP_URL}/setup`);

    // If redirected to /login, log in directly; otherwise complete first-admin claim
    if (!page.url().includes('/login')) {
      const nameInput = page.getByLabel(/Full name/i);
      if (await nameInput.isVisible()) {
        await nameInput.fill('Certification Lead');
        await page.getByLabel(/Email address/i).fill(ADMIN_EMAIL);
        await page.getByLabel(/^Administrator password$/i).fill(ADMIN_PASSWORD);
        await page.getByLabel(/Confirm password/i).fill(ADMIN_PASSWORD);
        await page.getByRole('button', { name: /Create administrator/i }).click();

        await expect(page.getByText(/Administrator created/i)).toBeVisible({ timeout: 15000 });
        await page.goto(`${APP_URL}/login`);
      }
    }

    // 2. Log in
    if (page.url().includes('/login')) {
      await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
      await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
      await page.locator('form button[type="submit"]').click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20000 });
    }

    // 3. Navigate to Security & Compliance
    await page.goto(`${APP_URL}/settings/security-compliance`);
    await expect(page.getByText(/Security & Compliance/i)).toBeVisible({ timeout: 15000 });

    // 4. Verify Compliance Control Center
    await expect(page.getByText(/Compliance Control Center/i)).toBeVisible();

    // Verify Control Center primary tabs
    const overviewTab = page.getByRole('tab', { name: /Overview/i });
    if (await overviewTab.isVisible()) {
      await overviewTab.click();
    }

    const controlsTab = page.getByRole('tab', { name: /Controls/i });
    if (await controlsTab.isVisible()) {
      await controlsTab.click();
      await expect(page.getByText(/Runtime Controls/i)).toBeVisible();
    }

    const driftTab = page.getByRole('tab', { name: /Control Drift/i });
    if (await driftTab.isVisible()) {
      await driftTab.click();
      await expect(page.getByText(/Drift Episodes/i)).toBeVisible();
    }

    const frameworksTab = page.getByRole('tab', { name: /Frameworks/i });
    if (await frameworksTab.isVisible()) {
      await frameworksTab.click();
      await expect(page.getByText(/GDPR/i)).toBeVisible();
    }
  });
});
