import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Browser contracts for the recommendations-only Intelligence release: every settings page renders with
 * its section navigation, an incident shows its suggestions, and the assistant opens from each entry
 * point and answers in basic mode (no AI provider). State is created directly and removed afterwards so
 * the assistant never appears in other specs that share this database.
 */
const prisma = new PrismaClient();
const email = 'e2e-intelligence@example.com';
const password = 'Intelligence-E2E-Pass-4417!';
const tag = `e2e-intel-${Date.now()}`;

let incidentId = '';
let precedentId = '';

async function cleanup() {
  await prisma.aiSettings.deleteMany({});
  // Switching intelligence off first stops the worker picking up anything else from this spec.
  await prisma.intelligenceSettings.deleteMany({});
  await prisma.intelligenceWorkItem.deleteMany({});
  await prisma.intelligenceFeedback.deleteMany({ where: { actor: { email } } });
  const policies = await prisma.intelligencePolicy.findMany({ where: { scopeKey: 'global' }, select: { id: true } });
  if (policies.length) {
    await prisma.$executeRawUnsafe('ALTER TABLE "IntelligencePolicyVersion" DISABLE TRIGGER USER');
    try {
      await prisma.intelligencePolicyVersion.deleteMany({ where: { policyId: { in: policies.map(p => p.id) } } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "IntelligencePolicyVersion" ENABLE TRIGGER USER');
    }
    await prisma.intelligencePolicy.deleteMany({ where: { id: { in: policies.map(p => p.id) } } });
  }
  const services = { name: { startsWith: 'e2e-intel-' } };
  // Findings and change events cascade from these; incidents must go before their service.
  await prisma.incident.deleteMany({ where: { service: services } });
  await prisma.changeEvent.deleteMany({ where: { service: services } });
  await prisma.service.deleteMany({ where: services });
}

async function seed() {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.rateLimit.deleteMany({ where: { key: { contains: email } } });
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    create: { email, name: 'Intelligence Admin', passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  await prisma.intelligenceSettings.create({ data: { id: 'default', enabled: true } });
  const policy = await prisma.intelligencePolicy.create({ data: { scopeKey: 'global', headVersion: 1 } });
  await prisma.intelligencePolicyVersion.create({
    data: { policyId: policy.id, version: 1, mode: 'SUGGEST', definition: { schemaVersion: 1 }, createdById: admin.id },
  });
  await prisma.aiSettings.create({
    data: { id: 'default', enabled: false, squireEnabled: true, squireName: 'Pip', squireAvatar: 'KNIGHT', updatedAt: new Date() },
  });

  const service = await prisma.service.create({ data: { name: tag } });
  const now = Date.now();
  const precedent = await prisma.incident.create({
    data: {
      title: 'Checkout database connection pool exhausted (last month)',
      serviceId: service.id,
      status: 'RESOLVED',
      urgency: 'LOW',
      createdAt: new Date(now - 30 * 86_400_000),
      resolvedAt: new Date(now - 30 * 86_400_000 + 3_600_000),
    },
  });
  const incident = await prisma.incident.create({
    data: { title: 'Checkout database connection pool exhausted', serviceId: service.id, status: 'OPEN', urgency: 'LOW', createdAt: new Date(now - 5 * 60_000) },
  });
  const change = await prisma.changeEvent.create({
    data: { serviceId: service.id, source: 'ci', kind: 'DEPLOY', summary: 'checkout v42 rollout', occurredAt: new Date(now - 20 * 60_000) },
  });
  // The production server runs the real intelligence worker, which analyses this new incident too. Its
  // writes are fenced by generation, so a newer seeded generation is kept and the worker's older result
  // is dropped as stale. That is the same guarantee that stops a late analysis overwriting a fresh one.
  const common = { incidentId: incident.id, generation: 1_000_000, engineVersion: 'e2e', policyVersion: 1 };
  await prisma.intelligenceFinding.createMany({
    data: [
      {
        ...common,
        kind: 'SIMILAR_INCIDENT',
        rank: 1,
        confidence: 0.91,
        subjectRef: precedent.id,
        evidence: { type: 'similarity', calibrated: false, tier: 'FTS', components: { tokens: 0.9, template: 0.95, labels: 0, sameService: 1, recency: 0.5, resolved: 1 }, matchedTokenCount: 5 },
      },
      {
        ...common,
        kind: 'CHANGE_CORRELATION',
        rank: 1,
        confidence: 0.6,
        subjectRef: change.id,
        evidence: { type: 'change', calibrated: false, kind: 'DEPLOY', relation: 'SAME_SERVICE', depth: 0, leadSeconds: 900, components: { proximity: 0.78, relation: 1, kind: 1 } },
      },
    ],
  });
  incidentId = incident.id;
  precedentId = precedent.id;
}

async function login(page: Page) {
  await page.goto('/login');
  if (new URL(page.url()).pathname === '/login') {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
  }
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/** The assistant marks the document once its client code is live; wait for it before interacting. */
async function assistantReady(page: Page) {
  await expect(page.locator('html[data-squire-name="Pip"]')).toHaveCount(1);
}

/** WCAG 2.1 AA scan scoped to the parts this feature owns, so unrelated shell issues do not mask ours. */
async function expectAccessible(page: Page, selector: string) {
  const result = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.serial('intelligence (recommendations only)', () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });

  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('every settings section renders with its navigation', async ({ page }) => {
    const sections: Array<[string, string, RegExp]> = [
      ['/settings/intelligence', 'Overview', /^Intelligence$/],
      ['/settings/intelligence/services', 'Per-service policies', /Per-service policies/],
      ['/settings/intelligence/response', 'Dependencies & changes', /Dependencies, changes and alert quality/],
      ['/settings/intelligence/insights', 'Insights', /^Insights$/],
      ['/settings/intelligence/ai', 'Assistant & AI', /Assistant and AI/],
    ];
    for (const [path, tab, heading] of sections) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      const nav = page.getByRole('navigation', { name: 'Intelligence sections' });
      await expect(nav.getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expectAccessible(page, '#main-content');
    }
    // The settings page reflects what was configured and never offers AUTO.
    await page.goto('/settings/intelligence');
    await expect(page.getByRole('option', { name: /Automatic/ })).toBeDisabled();
    await page.goto('/settings/intelligence/ai');
    await expect(page.getByLabel('Assistant name')).toHaveValue('Pip');
    await expect(page.getByRole('radio', { name: 'Knight' })).toBeChecked();
  });

  test('an incident shows explainable suggestions and accepts feedback', async ({ page }) => {
    await page.goto(`/incidents/${incidentId}`);
    const similar = page.getByRole('region', { name: 'Similar past incidents' });
    await expect(similar).toBeVisible();
    await expect(similar.getByRole('link', { name: /last month/ })).toHaveAttribute('href', `/incidents/${precedentId}`);

    const causes = page.getByRole('region', { name: 'Possible causes' });
    await expect(causes.getByText('checkout v42 rollout')).toBeVisible();
    await expect(causes.getByText(/leads to verify, not confirmed causes/)).toBeVisible();

    const helpful = similar.getByRole('button', { name: 'Helpful', exact: true });
    await helpful.click();
    await expect(helpful).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() => prisma.intelligenceFeedback.count({ where: { actor: { email }, verdict: 'HELPFUL' } }))
      .toBe(1);
  });

  test('the assistant answers from the incident panel in basic mode', async ({ page }) => {
    await page.goto(`/incidents/${incidentId}`);
    await assistantReady(page);
    const panel = page.getByRole('region', { name: 'Ask Pip' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Have we seen this before?' }).click();
    const dialog = page.getByRole('dialog', { name: /Pip/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/last month/)).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText('Basic answer from your incident data')).toBeVisible();
    await expect(dialog.getByRole('link', { name: `/incidents/${precedentId}` })).toBeVisible();
    await expectAccessible(page, 'section[role="dialog"]');
    await expectAccessible(page, 'section[aria-labelledby="similar-incidents-heading"]');
    await expectAccessible(page, 'section[aria-labelledby="response-intelligence-heading"]');
    await expectAccessible(page, 'section[aria-labelledby="ask-squire-heading"]');
  });

  test('the floating launcher is keyboard friendly and the search entry opens it', async ({ page }) => {
    await page.goto('/');
    await assistantReady(page);
    const launcher = page.getByRole('button', { name: /Ask Pip/ });
    await expect(launcher).toBeVisible();
    await launcher.click();
    const dialog = page.getByRole('dialog', { name: /Pip/ });
    await expect(page.getByLabel('Message Pip')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(launcher).toBeFocused();

    const search = page.getByPlaceholder('Search...');
    await search.click();
    await search.fill('pip');
    await page.getByText('Ask Pip', { exact: true }).last().click();
    await expect(dialog).toBeVisible();
  });

  test('fits a 390px phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/settings/intelligence', '/settings/intelligence/ai', '/settings/intelligence/insights', `/incidents/${incidentId}`]) {
      await page.goto(path);
      await expect(page.locator('#main-content')).toBeVisible();
      await noHorizontalOverflow(page);
    }
    await assistantReady(page);
    await page.getByRole('button', { name: /Ask Pip/ }).click();
    const box = await page.getByRole('dialog', { name: /Pip/ }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
