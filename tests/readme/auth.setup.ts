import { test as setup } from '@playwright/test';
import { loginAsDocsAdmin } from '../docs/helpers/session';

setup('authenticate README capture user', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sidebarCollapsed', '0'));
  await loginAsDocsAdmin(page);
  await page.context().storageState({ path: 'test-results/readme-auth.json' });
});
