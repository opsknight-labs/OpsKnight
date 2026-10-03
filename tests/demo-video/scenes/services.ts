import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 06: Service Catalog
 * Go `/services` -> Open `/services/[id]` ->
 * Show service status, owning team, escalation policy, SLA targets ->
 * Visit `/services/[id]/settings` or integrations.
 */
export async function playServicesScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Service Catalog', 'Operational configuration around every service', 'services');

  await page.goto('/services');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Click into Checkout API
  const checkoutService = page.getByText('Checkout API').first();
  await director.moveCursorTo(checkoutService, { durationMs: 650 });
  await director.pause(700);

  await director.clickNaturally(checkoutService);
  await page.waitForURL(/\/services\/[^/]+$/, { timeout: 6000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1300);

  // 1. Inspect Service metadata: Team, Policy, Tier
  const teamBadge = page.locator('text=Payments Platform').first();
  if (await teamBadge.isVisible()) {
    await director.hover(teamBadge, 700);
  }

  const policyBadge = page.locator('text=Payments Critical').first();
  if (await policyBadge.isVisible()) {
    await director.hover(policyBadge, 700);
  }

  // 2. Scroll through recent incidents / health metrics
  await director.scrollSlowly(350, 800);
  await director.pause(1200);

  // 3. Briefly visit service settings tab or route
  const currentUrl = page.url();
  await page.goto(`${currentUrl}/settings`);
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  await director.cinematicPause(1600);
}
