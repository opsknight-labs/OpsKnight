import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 05: Escalation Policies
 * Go `/policies` -> Open `/policies/[id]` ->
 * Show Step 1 (Current on-call), Step 2 (Platform Team), Step 3 (Secondary schedule).
 */
export async function playEscalationScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Escalation Policies', 'Route incidents through reliable escalation', 'escalation');

  await page.goto('/policies');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Move to Payments Critical policy card
  const policyLink = page.getByText('Payments Critical').first();
  await director.moveCursorTo(policyLink, { durationMs: 650 });
  await director.pause(700);

  // Open policy detail
  await director.clickNaturally(policyLink);
  await page.waitForURL(/\/policies\/[^/]+$/, { timeout: 6000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1300);

  // Step 1: Target = Current on-call schedule
  const step1 = page.locator('text=Step 1').or(page.locator('text=Step 0')).first();
  if (await step1.isVisible()) {
    await director.hover(step1, 800);
  }

  // Step 2: 5 minutes -> Team
  const step2 = page.locator('text=5 min').or(page.locator('text=5m')).first();
  if (await step2.isVisible()) {
    await director.hover(step2, 800);
  }

  // Step 3: 15 minutes -> Secondary schedule
  const step3 = page.locator('text=15 min').or(page.locator('text=15m')).first();
  if (await step3.isVisible()) {
    await director.hover(step3, 800);
  }

  await director.scrollSlowly(300, 800);
  await director.cinematicPause(1800);
  await director.scrollSlowly(0, 500);
}
