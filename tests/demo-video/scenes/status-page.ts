import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 10: Status Pages (Major Scene)
 * Admin `/settings/status-pages` -> Click "Manage" ->
 * Show attached services & configuration ->
 * Transition to public `/status/northstar-systems` ->
 * Full customer experience walkthrough: header, overall health, services, uptime history, announcements.
 */
export async function playStatusPageScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Status Pages', 'Keep customers informed in real time', 'status-page');

  // 1. Admin Status Page Management
  await page.goto('/settings/status-pages');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Click "Manage" button on Northstar Systems Status card
  const manageButton = page.locator('a:has-text("Manage")').first();
  if (await manageButton.isVisible()) {
    await director.moveCursorTo(manageButton, { durationMs: 650 });
    await director.clickNaturally(manageButton);
    await page.waitForLoadState('domcontentloaded');
    await director.pause(1400);
  }

  // Inspect status page admin configuration: Mapped Services & Tabs
  const servicesConfig = page.locator('text=Mapped Services').or(page.locator('text=Services')).first();
  if (await servicesConfig.isVisible()) {
    await director.hover(servicesConfig, 800);
  }

  // Scroll through workspace settings
  await director.scrollSlowly(350, 800);
  await director.pause(1200);

  // 2. Dramatic Transition: Leave Admin UI and open Public Status Page
  await director.pause(600);
  await page.goto('/status/northstar-systems');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1600);

  // Walk through customer experience:
  // Brand header & overall health pill
  const overallPill = page.locator('text=Operational').or(page.locator('text=Systems')).first();
  if (await overallPill.isVisible()) {
    await director.hover(overallPill, 900);
  }

  // Active / recent announcements
  const announcement = page.locator('text=Upcoming Maintenance').or(page.locator('text=Maintenance')).first();
  if (await announcement.isVisible()) {
    await director.hover(announcement, 1000);
  }

  // Scroll slowly through services and 90-day uptime bars
  await director.scrollSlowly(450, 1400);
  await director.pause(1600);

  const checkoutApiRow = page.locator('text=Checkout API').first();
  if (await checkoutApiRow.isVisible()) {
    await director.hover(checkoutApiRow, 1100);
  }

  // Continue scrolling to Past Incidents & Subscribe options
  await director.scrollSlowly(800, 1400);
  await director.pause(1800);

  const subscribeButton = page.locator('button:has-text("Subscribe"), a:has-text("Subscribe")').first();
  if (await subscribeButton.isVisible()) {
    await director.hover(subscribeButton, 900);
  }

  await director.cinematicPause(2200);
  await director.scrollSlowly(0, 800);
}
