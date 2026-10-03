import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 02: Command Center
 * Start `/`, show active incidents, on-call, health, operational numbers, recent activity.
 */
export async function playDashboardScene(director: DemoDirector): Promise<void> {
  const page = director.page;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await director.setChapter('Command Center', 'See your operations in one place', 'command-center');

  // Let metrics and charts settle
  await director.pause(1500);

  // Slow, natural exploration of key dashboard elements
  // 1. Move to Critical Focus / Active Incident metric
  const criticalCard = page.locator('text=Critical Focus').first();
  if (await criticalCard.isVisible()) {
    await director.moveCursorTo(criticalCard, { durationMs: 700 });
    await director.pause(900);
  }

  // 2. Move to Services at Risk / Service Health
  const servicesCard = page.locator('text=Services at Risk').first();
  if (await servicesCard.isVisible()) {
    await director.moveCursorTo(servicesCard, { durationMs: 700 });
    await director.pause(800);
  }

  // 3. Move to SLA / Operational metrics
  const slaWidget = page.locator('text=SLA').first();
  if (await slaWidget.isVisible()) {
    await director.moveCursorTo(slaWidget, { durationMs: 650 });
    await director.pause(800);
  }

  // 4. Scroll smoothly down to view Recent Incidents & activity
  await director.scrollSlowly(380, 800);
  await director.pause(1000);

  // Hover over an incident card or on-call responder
  const onCallBadge = page.locator('text=Maya Patel').first();
  if (await onCallBadge.isVisible()) {
    await director.hover(onCallBadge, 1000);
  }

  await director.cinematicPause(1400);
  await director.scrollSlowly(0, 600);
}
