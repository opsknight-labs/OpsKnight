import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateApiKey } from '@/lib/api-keys';
import { Client } from '../../sdk/typescript/client';
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());
test('REST removal and administrator UI share subscriber consent and audit behavior', async ({
  page,
  baseURL,
}) => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  const suffix = crypto.randomUUID();
  const password = 'Status-subscriber-fixture-829!';
  const actor = await db.user.create({
    data: {
      email: `status-admin-${suffix}@example.invalid`,
      name: 'Status administrator',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  const issued = generateApiKey();
  const key = await db.apiKey.create({
    data: {
      name: 'Status browser credential',
      userId: actor.id,
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
      scopes: ['status-page-subscribers:read', 'status-page-subscribers:write'],
    },
  });
  const statusPage =
    (await db.statusPage.findFirst({ select: { id: true } })) ??
    (await db.statusPage.create({
      data: { name: 'Status browser fixture', slug: `status-${suffix}` },
    }));
  const subscriber = await db.statusPageSubscription.create({
    data: {
      statusPageId: statusPage.id,
      email: `subscriber-${suffix}@example.com`,
      token: crypto.randomUUID(),
      state: 'ACTIVE',
      verified: true,
    },
  });
  const client = new Client({
    baseUrl: `${baseURL}/api/v2`,
    token: issued.token,
    allowInsecureHttp: true,
  });
  try {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(actor.email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto(`/settings/status-pages/${statusPage.id}`);
    await page.getByRole('button', { name: 'Subscribers', exact: true }).click();
    const search = page.getByPlaceholder(/search.*email/i);
    if (await search.count()) await search.fill(subscriber.email);
    const row = page.getByRole('row').filter({ hasText: subscriber.email });
    await expect(row).toContainText('Verified');
    await client.call('removeStatusPageSubscriber', {
      params: { id: statusPage.id, subscriberId: subscriber.id },
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    await page.reload();
    await page.getByRole('button', { name: 'Subscribers', exact: true }).click();
    if (await search.count()) await search.fill(subscriber.email);
    await expect(row).toContainText('Unsubscribed');
    expect(
      await db.auditLog.count({
        where: { action: 'status_page.subscribers.removed', actorId: actor.id },
      })
    ).toBe(1);
    expect(
      await client.call('getStatusPageSubscriber', {
        params: { id: statusPage.id, subscriberId: subscriber.id },
      })
    ).toMatchObject({ data: { state: 'UNSUBSCRIBED' } });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    ).toBe(true);
  } finally {
    await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  }
});

test('REST configuration changes appear in the shared settings UI and public privacy projection', async ({
  page,
  baseURL,
}) => {
  const suffix = crypto.randomUUID();
  const password = 'Status-config-fixture-783!';
  const actor = await db.user.create({
    data: {
      email: `status-config-${suffix}@example.invalid`,
      name: 'Status configuration administrator',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  const issued = generateApiKey();
  const key = await db.apiKey.create({
    data: {
      name: 'Status configuration browser credential',
      userId: actor.id,
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
      scopes: ['status-pages:read', 'status-pages:write'],
    },
  });
  const statusPage =
    (await db.statusPage.findFirst({ select: { id: true } })) ??
    (await db.statusPage.create({
      data: { name: 'Status configuration browser fixture', slug: `status-${suffix}` },
    }));
  const client = new Client({
    baseUrl: `${baseURL}/api/v2`,
    token: issued.token,
    allowInsecureHttp: true,
  });
  try {
    const before = (await client.call('getStatusPageContent', { params: { id: statusPage.id } }))
      .data;
    const footer = `Reviewed footer ${suffix}`;
    const changed = (
      await client.call('updateStatusPageContent', {
        params: { id: statusPage.id },
        body: { footerText: footer },
        headers: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${before.revision}"` },
      })
    ).data;
    await client.call('updateStatusPagePrivacy', {
      params: { id: statusPage.id },
      body: { showIncidentTitles: false },
      headers: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${changed.revision}"` },
    });
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(actor.email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto(`/settings/status-pages/${statusPage.id}`);
    await page.getByRole('button', { name: 'Content', exact: true }).click();
    await expect(page.getByLabel('Footer Text', { exact: true })).toHaveValue(footer);
    const latest = await client.call('getStatusPagePrivacy', { params: { id: statusPage.id } });
    expect(latest.data.values.showIncidentTitles).toBe(false);
    expect((await db.statusPage.findUniqueOrThrow({ where: { id: statusPage.id } })).revision).toBe(
      latest.data.revision
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    ).toBe(true);
  } finally {
    await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  }
});
