import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 08: ChatOps & Incident Collaboration
 * Show ChatOps settings & Microsoft Teams / Slack war-room coordination views.
 */
export async function playChatOpsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('ChatOps & Collaboration', 'Coordinate where your team already works', 'chatops');

  // Go to ChatOps Integrations Settings
  await page.goto('/settings/integrations/chatops');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // Inspect Slack & Microsoft Teams connected integrations
  const teamsCard = page.locator('text=Microsoft Teams').first();
  if (await teamsCard.isVisible()) {
    await director.hover(teamsCard, 1000);
  }

  const slackCard = page.locator('text=Slack').first();
  if (await slackCard.isVisible()) {
    await director.hover(slackCard, 1000);
  }

  // Scroll through War Room auto-creation & channel dispatch settings
  await director.scrollSlowly(300, 800);
  await director.pause(1400);

  await director.cinematicPause(1800);
}
