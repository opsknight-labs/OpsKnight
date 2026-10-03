import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 16: Operations & Health Center
 * Visit `/settings/system/health`, `/system-logs`, and `/audit`.
 * Demonstrates OpsKnight's built-in self-monitoring and auditing capabilities.
 */
export async function playHealthScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('System Health & Operations', 'Full operational visibility into OpsKnight itself', 'health');

  // 1. Health Center
  await page.goto('/settings/system/health');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  const healthyBadge = page.locator('text=Healthy').or(page.locator('text=operational')).first();
  if (await healthyBadge.isVisible()) {
    await director.hover(healthyBadge, 800);
  }

  // 2. System Logs
  await page.goto('/system-logs');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // 3. Audit Trail
  await page.goto('/audit');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  const auditEntry = page.locator('text=SERVICE_UPDATED').or(page.locator('text=SCHEDULE_ROTATION')).first();
  if (await auditEntry.isVisible()) {
    await director.hover(auditEntry, 900);
  }

  await director.scrollSlowly(250, 700);
  await director.cinematicPause(1600);
}
