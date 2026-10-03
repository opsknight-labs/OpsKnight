import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 03: Incidents
 * Open `/incidents` -> Select P1 incident -> Enter `/incidents/[id]` ->
 * Inspect severity, responder, SLA, watchers, notes -> Scroll to Incident Timeline.
 */
export async function playIncidentsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Incident Triage', 'Respond with full incident context', 'incidents');

  await page.goto('/incidents');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Smooth mouse movement across incident list
  const featuredItem = page.getByText('Checkout API: elevated authorization failures').first();
  await director.moveCursorTo(featuredItem, { durationMs: 700 });
  await director.pause(900);

  // Click into the incident detail page
  await director.clickNaturally(featuredItem);
  await page.waitForURL(/\/incidents\/[^/]+$/, { timeout: 6000 }).catch(async () => {
    await page.goto('/incidents/incident-checkout-auth-failures');
  });
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // 1. Hover priority and status badges
  const priorityBadge = page.locator('text=P1').first();
  if (await priorityBadge.isVisible()) {
    await director.hover(priorityBadge, 800);
  }

  // 2. Hover responder & service
  const responderEl = page.locator('text=Maya Patel').first();
  if (await responderEl.isVisible()) {
    await director.hover(responderEl, 800);
  }

  // 3. Inspect SLA timers & action bar
  const ackBadge = page.locator('text=ACK').first();
  if (await ackBadge.isVisible()) {
    await director.hover(ackBadge, 600);
  }

  // 4. Switch to or scroll down to Timeline Tab
  const timelineTab = page.locator('button[role="tab"]:has-text("Timeline")').first();
  if (await timelineTab.isVisible()) {
    await director.clickNaturally(timelineTab);
    await director.pause(800);
  }

  // Scroll through the detailed events: Triggered -> Assigned -> Acknowledged -> Updates -> Resolved
  await director.scrollSlowly(450, 1000);
  await director.pause(1600);

  const resolvedEvent = page.locator('text=Resolution confirmed').first();
  if (await resolvedEvent.isVisible()) {
    await director.hover(resolvedEvent, 900);
  }

  await director.cinematicPause(1800);
  await director.scrollSlowly(0, 600);
}
