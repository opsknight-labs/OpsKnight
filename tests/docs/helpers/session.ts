import { expect, type Page } from '@playwright/test';
import { DOCS_ADMIN } from '../fixtures/constants';

export async function loginAsDocsAdmin(page: Page) {
  await page.goto('/login');
  if (new URL(page.url()).pathname !== '/login') return;
  // Wait for the login client to hydrate before submitting the form.
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(DOCS_ADMIN.email);
  await page.locator('input[type="password"]').fill(DOCS_ADMIN.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}
