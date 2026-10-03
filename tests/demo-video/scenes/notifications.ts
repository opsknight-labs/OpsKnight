import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 09: Notifications & Paging
 * Go `/settings/notifications` -> Inspect multi-channel paging ->
 * Go `/settings/notifications/history` -> Show delivery evidence and tracking.
 */
export async function playNotificationsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Multi-Channel Paging', 'Reliable alerting with full delivery tracking', 'notifications');

  await page.goto('/settings/notifications');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // Hover supported paging channels: Push, Email, SMS, WhatsApp, Voice
  const channelList = page.locator('text=Email').first();
  if (await channelList.isVisible()) {
    await director.hover(channelList, 700);
  }

  const voiceOption = page.locator('text=Voice').or(page.locator('text=SMS')).first();
  if (await voiceOption.isVisible()) {
    await director.hover(voiceOption, 700);
  }

  // Navigate to Delivery History
  await page.goto('/settings/notifications/history');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1300);

  // Inspect verified delivery status records
  const deliveredBadge = page.locator('text=DELIVERED').first();
  if (await deliveredBadge.isVisible()) {
    await director.hover(deliveredBadge, 900);
  }

  await director.scrollSlowly(300, 800);
  await director.cinematicPause(1800);
}
