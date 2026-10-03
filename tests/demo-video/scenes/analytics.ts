import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 12: Analytics & Insights
 * Go `/analytics` -> Show MTTA, MTTR, SLA compliance, trends, historical performance.
 */
export async function playAnalyticsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Analytics & Insights', 'Deep analytics across your incident lifecycle', 'analytics');

  await page.goto('/analytics');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // Inspect MTTA & MTTR metric cards
  const mttaCard = page.locator('text=MTTA').first();
  if (await mttaCard.isVisible()) {
    await director.hover(mttaCard, 800);
  }

  const mttrCard = page.locator('text=MTTR').first();
  if (await mttrCard.isVisible()) {
    await director.hover(mttrCard, 800);
  }

  // Scroll through SLA compliance gauges & incident distribution charts
  await director.scrollSlowly(420, 1000);
  await director.pause(1600);

  await director.cinematicPause(1800);
  await director.scrollSlowly(0, 600);
}
