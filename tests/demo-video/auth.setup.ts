import { test as setup, expect } from '@playwright/test';

setup('authenticate Demo Video capture user', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebarCollapsed', '0');
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  });

  await page.goto('/login');
  if (new URL(page.url()).pathname === '/login') {
    await page.waitForLoadState('domcontentloaded');
    await page.locator('input[type="email"]').fill('maya.chen@opsknight.com');
    await page.locator('input[type="password"]').fill('Docs-only-harbor-482!');
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
  }

  await page.context().storageState({ path: 'test-results/demo-video-auth.json' });
  console.log('[auth.setup] Demo Video auth state saved to test-results/demo-video-auth.json');
});
