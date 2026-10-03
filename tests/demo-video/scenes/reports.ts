import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 11: Reports & Executive Dashboards
 * Open `/reports` -> Inspect widgets, trends & service health ->
 * Visit `/reports/executive`.
 */
export async function playReportsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Reports & Dashboards', 'Turn incident data into operational insight', 'reports');

  await page.goto('/reports');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // Inspect total incidents & MTTR widgets
  const mttrWidget = page.locator('text=MTTR').first();
  if (await mttrWidget.isVisible()) {
    await director.hover(mttrWidget, 900);
  }

  // Scroll through charts and service breakdown
  await director.scrollSlowly(400, 1000);
  await director.pause(1400);

  // Visit `/reports/executive`
  await page.goto('/reports/executive');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  await director.scrollSlowly(350, 900);
  await director.cinematicPause(1800);
  await director.scrollSlowly(0, 600);
}
