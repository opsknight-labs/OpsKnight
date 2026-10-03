import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 14: Integration Ecosystem
 * Go `/settings/integrations` -> Smooth scroll through catalogue:
 * Datadog, Grafana, Prometheus, Sentry, CloudWatch, GitHub, Slack, Teams, Jira.
 */
export async function playIntegrationsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Integration Ecosystem', 'Seamless connection to your monitoring stack', 'integrations');

  await page.goto('/settings/integrations');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // Smooth scroll through observability & chat integrations
  await director.scrollSlowly(350, 1000);
  await director.pause(1200);

  // Hover over Datadog or Prometheus
  const datadogCard = page.locator('text=Datadog').or(page.locator('text=Prometheus')).first();
  if (await datadogCard.isVisible()) {
    await director.hover(datadogCard, 900);
  }

  // Scroll further down through ticketing & developer tools
  await director.scrollSlowly(700, 1000);
  await director.pause(1200);

  const jiraCard = page.locator('text=Jira').or(page.locator('text=GitHub')).first();
  if (await jiraCard.isVisible()) {
    await director.hover(jiraCard, 900);
  }

  await director.cinematicPause(1800);
  await director.scrollSlowly(0, 600);
}
