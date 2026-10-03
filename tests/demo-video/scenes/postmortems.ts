import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 13: Postmortems & Action Items
 * Go `/postmortems` -> Open `/postmortems/[incidentId]` ->
 * Show summary, impact, root cause, resolution -> Go `/action-items` follow-up work.
 */
export async function playPostmortemsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Postmortems & Prevention', 'Learn from every incident', 'postmortems');

  await page.goto('/postmortems');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Click into the featured Checkout API postmortem
  const postmortemLink = page.getByText('Postmortem: Checkout API').first();
  if (await postmortemLink.isVisible()) {
    await director.moveCursorTo(postmortemLink, { durationMs: 650 });
    await director.clickNaturally(postmortemLink);
    await page.waitForLoadState('domcontentloaded');
  }

  if (!page.url().includes('/postmortems/incident-checkout-auth-failures')) {
    await page.goto('/postmortems/incident-checkout-auth-failures');
    await page.waitForLoadState('domcontentloaded');
  }
  await director.pause(1400);

  // Hover over Root Cause section
  const rootCause = page.locator('text=Root Cause').or(page.locator('text=rootCause')).first();
  if (await rootCause.isVisible()) {
    await director.hover(rootCause, 900);
  }

  // Scroll through resolution & lessons learned
  await director.scrollSlowly(420, 1000);
  await director.pause(1400);

  // Navigate to Action Items tracking
  await page.goto('/action-items');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Inspect prioritized preventative action items
  const highAction = page.locator('text=Increase acquiring bank gateway').first();
  if (await highAction.isVisible()) {
    await director.hover(highAction, 900);
  }

  await director.scrollSlowly(300, 800);
  await director.cinematicPause(1800);
}
