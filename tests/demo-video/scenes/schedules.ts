import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 04: Schedules
 * Go `/schedules` -> Open `/schedules/[id]` ->
 * Show name/team, current responder, rotation, schedule layers, calendar/timeline.
 */
export async function playSchedulesScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('On-Call Schedules', "Know exactly who's on call", 'schedules');

  await page.goto('/schedules');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Find Payments Primary On-Call
  const scheduleLink = page.getByText('Payments Primary On-Call').first();
  await director.moveCursorTo(scheduleLink, { durationMs: 650 });
  await director.pause(800);

  // Click into schedule detail page
  await director.clickNaturally(scheduleLink);
  await page.waitForURL(/\/schedules\/[^/]+$/, { timeout: 6000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // 1. Hover current on-call responder card
  const currentResponder = page.locator('text=Maya Patel').first();
  if (await currentResponder.isVisible()) {
    await director.hover(currentResponder, 1000);
  }

  // 2. View layers and rotation details
  const rotationBadge = page.locator('text=Weekly').first();
  if (await rotationBadge.isVisible()) {
    await director.hover(rotationBadge, 700);
  }

  // 3. Scroll slowly down through the calendar / coverage timeline
  await director.scrollSlowly(420, 1000);
  await director.pause(1600);

  // 4. Hover over upcoming shift block in timeline
  const shiftBlock = page.locator('.h-full, [data-shift], td').nth(4);
  if (await shiftBlock.isVisible()) {
    await director.hover(shiftBlock, 900);
  }

  await director.cinematicPause(1800);
  await director.scrollSlowly(0, 600);
}
