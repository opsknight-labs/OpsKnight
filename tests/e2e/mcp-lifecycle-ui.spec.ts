import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

/**
 * The administrator's lifecycle pages in a real browser, at phone and desktop widths: an
 * assistant's detail page, the Usage chart with a custom range, and a person's MCP panel. Seeds
 * its own rows directly (owned local database only) and removes them afterwards.
 */

test.describe.configure({ mode: 'serial' });

const db = new PrismaClient();
const tag = randomBytes(4).toString('hex');
// A metadata-document client: its id is a URL, so the detail link must encode it into one segment.
const clientId = `https://claude.ai/oauth/e2e-${tag}.json`;
const userId = `mcp-ui-e2e-${tag}`;
let grantId = '';
let previousPolicy: { enabled: boolean; cimdEnabled: boolean; cimdAllowedHosts: string[] } | null =
  null;

const WIDTHS = [375, 1440] as const;
const shots = process.env.MCP_E2E_SCREENSHOTS;

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('mcp-admin@example.test');
  await page.getByLabel(/^password$/i).fill('Local-only MCP browser fixture passphrase 2026');
  await page.getByRole('button', { name: /sign in/i, exact: true }).click();
  await page.waitForURL(
    url => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/api/auth')
  );
}

/** Nothing scrolls sideways at this width. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function snap(page: Page, name: string, width: number, browserName: string) {
  if (shots)
    await page.screenshot({ path: `${shots}/${name}-${browserName}-${width}.png`, fullPage: true });
}

test.beforeAll(async ({ baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname);
  const existing = await db.mcpPolicy.findUnique({ where: { id: 'default' } });
  previousPolicy = existing && {
    enabled: existing.enabled,
    cimdEnabled: existing.cimdEnabled,
    cimdAllowedHosts: existing.cimdAllowedHosts,
  };
  const policy = { enabled: true, cimdEnabled: true, cimdAllowedHosts: ['claude.ai'] };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  await db.user.create({
    data: {
      id: userId,
      email: `ui-${tag}@example.test`,
      name: `[MCP-E2E] Jane ${tag}`,
      passwordHash: 'not-a-login',
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  await db.mcpClient.create({
    data: {
      id: clientId,
      name: `[MCP-E2E] Claude ${tag}`,
      metadataUrl: clientId,
      scopes: ['incidents:read'],
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      firstAuthorizedAt: new Date(),
    },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId,
      userId,
      userTokenVersion: 0,
      scopes: ['incidents:read'],
      resource: `${baseURL}/mcp`,
      expiresAt: new Date(Date.now() + 3_600_000),
      lastCallAt: new Date(),
      lastTool: 'incident_search',
    },
  });
  grantId = grant.id;
  const now = Date.now();
  await db.mcpCallLog.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      grantId,
      clientId,
      userId,
      tool: index % 3 ? 'incident_search' : 'oncall_now',
      outcome: index % 7 === 0 ? 'rate_limited' : 'served',
      errorCode: index % 7 === 0 ? 'RATE_LIMITED' : null,
      durationMs: 20 + index,
      requestId: `ui-e2e-${tag}-${index}`,
      at: new Date(now - index * 3 * 3_600_000),
    })),
  });
});

test.afterAll(async () => {
  await db.mcpCallLog.deleteMany({ where: { grantId } }).catch(() => undefined);
  await db.mcpGrant.deleteMany({ where: { userId } }).catch(() => undefined);
  await db.mcpClient.deleteMany({ where: { id: clientId } }).catch(() => undefined);
  await db.auditLog.deleteMany({ where: { entityId: userId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  if (previousPolicy) await db.mcpPolicy.update({ where: { id: 'default' }, data: previousPolicy });
  await db.$disconnect();
});

test('assistant detail page, from the assistants list, at phone and desktop widths', async ({
  page,
  browserName,
}) => {
  await login(page);
  const main = page.locator('#main-content');
  await page.goto(`/settings/integrations/mcp?tab=assistants&q=${tag}`);
  await main.getByRole('link', { name: `[MCP-E2E] Claude ${tag}`, exact: true }).click();
  await page.waitForURL(url => url.pathname.startsWith('/settings/integrations/mcp/assistants/'));
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      main.getByRole('heading', { level: 1, name: `[MCP-E2E] Claude ${tag}` })
    ).toBeVisible();
    await expect(main.getByText('Trusted', { exact: true })).toBeVisible();
    const connections = main.getByRole('table', { name: `Connections to [MCP-E2E] Claude ${tag}` });
    await expect(connections.getByText(`[MCP-E2E] Jane ${tag}`).first()).toBeVisible();
    await expect(main.getByRole('table', { name: /^Usage of/ })).toBeVisible();
    await expect(main.getByRole('list', { name: 'Recent requests' })).toContainText('RATE_LIMITED');
    await expectNoHorizontalScroll(page);
    await snap(page, 'assistant-detail', width, browserName);
  }
  // The internal personal-token client and unknown ids are not assistants.
  for (const id of ['okmcp-personal-access-tokens', 'no-such-assistant']) {
    // The route streams behind loading.tsx, so "not found" arrives as content, not a 404 status.
    await page.goto(`/settings/integrations/mcp/assistants/${id}`);
    await expect(page.getByRole('heading', { name: '404 - Page Not Found' })).toBeVisible();
  }
});

test('usage chart, error codes and a custom range', async ({ page, browserName }) => {
  await login(page);
  const main = page.locator('#main-content');
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  await page.goto('/settings/integrations/mcp?tab=usage&window=7d');
  await main.getByLabel('From (UTC)').fill(weekAgo);
  await main.getByLabel('To (UTC, included)').fill(today);
  await main.getByRole('button', { name: 'Show range' }).click();
  await page.waitForURL(url => url.searchParams.get('from') === weekAgo);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const chart = main.getByRole('figure', { name: 'Calls over time' });
    await expect(chart).toBeVisible();
    expect(await chart.locator('svg path').count()).toBeGreaterThanOrEqual(4);
    await expect(
      main.getByRole('region', { name: 'Failures by error code' }).getByText('RATE_LIMITED')
    ).toBeVisible();
    await expect(main.getByRole('link', { name: 'Clear range' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await snap(page, 'usage-range', width, browserName);
  }
  // A range the log cannot answer is refused with a reason, not silently widened.
  await page.goto(`/settings/integrations/mcp?tab=usage&from=${today}&to=${weekAgo}`);
  await expect(main.getByRole('alert')).toContainText('before the end date');
});

test("a person's MCP panel on their user page", async ({ page, browserName }) => {
  await login(page);
  await page.goto(`/users/${userId}`);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const table = page.getByRole('table', {
      name: `[MCP-E2E] Jane ${tag}'s assistant connections`,
    });
    await expect(table.getByRole('link', { name: `[MCP-E2E] Claude ${tag}` })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await snap(page, 'user-panel', width, browserName);
  }
  await page
    .getByRole('button', { name: `Disconnect all of [MCP-E2E] Jane ${tag}'s assistants` })
    .click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Disconnect all' }).click();
  await expect(page.getByText('Assistants disconnected')).toBeVisible();
  await expect.poll(() => db.mcpGrant.count({ where: { userId, revokedAt: null } })).toBe(0);
});
