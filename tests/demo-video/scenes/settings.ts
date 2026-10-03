import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 15: Administration & Governance
 * Smooth sequence through Settings: Profile, API Keys, Custom Fields,
 * Incident SLA, Service Objectives, Security & Compliance.
 */
export async function playSettingsScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('Settings & Governance', 'Enterprise controls, compliance and SLAs', 'settings');

  // 1. Settings Overview
  await page.goto('/settings');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1000);

  // 2. Incident SLA Policies
  await page.goto('/settings/incident-sla');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  // Hover SLA Target tier
  const slaTarget = page.locator('text=Tier 1').or(page.locator('text=SLO')).first();
  if (await slaTarget.isVisible()) {
    await director.hover(slaTarget, 800);
  }

  // 3. Service Objectives (SLOs)
  await page.goto('/settings/service-objectives');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1200);

  // 4. API Keys & Webhooks
  await page.goto('/settings/api-keys');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1000);

  // 5. Custom Fields
  await page.goto('/settings/custom-fields');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1000);

  // 6. Security & Compliance
  await page.goto('/settings/security-compliance');
  await page.waitForLoadState('domcontentloaded');
  await director.pause(1400);

  const complianceControl = page.locator('text=SOC 2').or(page.locator('text=ISO 27001')).or(page.locator('text=Control')).first();
  if (await complianceControl.isVisible()) {
    await director.hover(complianceControl, 900);
  }

  await director.cinematicPause(1600);
}
