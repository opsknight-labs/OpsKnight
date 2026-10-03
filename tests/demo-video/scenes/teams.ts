import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 07: Teams & Ownership
 * Go `/teams` -> Open `/teams/[id]` ->
 * Show members, roles, owned services, schedules, relationships.
 */
export async function playTeamsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Teams & Ownership', 'OpsKnight models real operational ownership', 'teams');

  await page.goto('/teams');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // Open Payments Platform team
  const paymentsTeam = page.getByText('Payments Platform').first();
  await director.moveCursorTo(paymentsTeam, { durationMs: 650 });
  await director.pause(700);

  await director.clickNaturally(paymentsTeam);
  await page.waitForURL(/\/teams\/[^/]+$/, { timeout: 6000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1300);

  // Hover team lead / members
  const teamLead = page.locator('text=Maya Patel').first();
  if (await teamLead.isVisible()) {
    await director.hover(teamLead, 800);
  }

  // Scroll slowly through team members & owned services
  await director.scrollSlowly(350, 800);
  await director.pause(1400);

  const ownedService = page.locator('text=Checkout API').first();
  if (await ownedService.isVisible()) {
    await director.hover(ownedService, 800);
  }

  await director.cinematicPause(1600);
}
