import { test as setup } from '@playwright/test';
import { loginAsDocsAdmin } from '../helpers/session';

setup('authenticate documentation administrator', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sidebarCollapsed', '0'));
  await loginAsDocsAdmin(page);
  await page.context().storageState({ path: 'test-results/docs-auth.json' });
});
