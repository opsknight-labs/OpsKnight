import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateApiKey } from '@/lib/api-keys';
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());
test('UI and REST invitations share real onboarding and never redisclose a stored manual capability', async ({
  page,
  browser,
}) => {
  if (
    !['/runbook_ui_test', '/rbe_engine_test'].includes(
      new URL(process.env.DATABASE_URL ?? '').pathname
    )
  )
    throw new Error('Dedicated invitation browser database required.');
  if (await db.notificationProvider.count({ where: { enabled: true } }))
    throw new Error(
      'Manual invitation browser fixture requires an unconfigured test email provider.'
    );
  const suffix = crypto.randomUUID(),
    password = 'Invitation-browser-river-harbor-472!';
  const admin = await db.user.create({
    data: {
      name: `Invitation admin ${suffix}`,
      email: `invitation-admin-${suffix}@example.invalid`,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  const uiEmail = `ui-invitation-${suffix}@example.invalid`,
    apiEmail = `api-invitation-${suffix}@example.invalid`;
  const issued = generateApiKey();
  const credential = await db.apiKey.create({
    data: {
      name: 'Invitation browser',
      userId: admin.id,
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
      scopes: ['users:read', 'users:write'],
    },
  });
  const headers = { Authorization: `Bearer ${issued.token}` };
  const onboarding = await browser.newContext({
    baseURL: 'http://127.0.0.1:' + (process.env.RUNBOOK_UI_PORT ?? '3205'),
    serviceWorkers: 'block',
  });
  try {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto(`/users?q=${encodeURIComponent(suffix)}`);
    await page.getByRole('button', { name: 'Invite User', exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Full Name', { exact: true }).fill(`UI invited ${suffix}`);
    await modal.getByLabel('Email Address', { exact: true }).fill(uiEmail);
    await modal.getByRole('button', { name: 'Send Invite', exact: true }).click();
    await expect(modal.getByText('User Invited', { exact: true })).toBeVisible();
    await expect(modal.locator('code')).toContainText('#token=');
    const uiUser = await db.user.findUniqueOrThrow({ where: { email: uiEmail } });
    expect(uiUser).toMatchObject({ status: 'INVITED', role: 'RESPONDER', invitationGeneration: 1 });
    await modal.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const policyResponse = await page.request.get('/api/v2/users/invitation-policy', { headers });
    expect(policyResponse.status()).toBe(200);
    const policy = (await policyResponse.json()).data;
    const review = {
      authenticationMode: 'PASSWORD',
      delivery: 'MANUAL',
      expectedPolicyVersion: policy.policyVersion,
      expectedOidcConfigVersion: policy.oidcConfigVersion,
    };
    const createHeaders = { ...headers, 'Idempotency-Key': 'browser-create-' + suffix };
    const body = { name: `API invited ${suffix}`, email: apiEmail, role: 'RESPONDER', ...review };
    const create = await page.request.post('/api/v2/users/invitations', {
      headers: createHeaders,
      data: body,
    });
    expect(create.status()).toBe(201);
    const created = (await create.json()).data;
    expect(created.inviteUrl).toContain('#token=');
    const replay = await page.request.post('/api/v2/users/invitations', {
      headers: createHeaders,
      data: body,
    });
    expect(replay.status()).toBe(201);
    expect((await replay.json()).data).toMatchObject({
      userId: created.userId,
      inviteUrl: null,
      disclosure: 'ALREADY_DISCLOSED',
    });
    const receipts = JSON.stringify(
      await db.backgroundJob.findMany({
        where: { payload: { path: ['principalId'], equals: credential.id } },
      })
    );
    expect(receipts).not.toContain('#token=');
    const read = await page.request.get(`/api/v2/users/${created.userId}/invitation`, { headers });
    expect(read.status()).toBe(200);
    const state = (await read.json()).data;
    const renew = await page.request.post(`/api/v2/users/${created.userId}/invitation`, {
      headers: {
        ...headers,
        'If-Match': read.headers().etag,
        'Idempotency-Key': 'browser-renew-' + suffix,
      },
      data: { ...review, expectedLinkingApprovalRevision: state.linkingApprovalRevision },
    });
    expect(renew.status()).toBe(200);
    const renewed = (await renew.json()).data;
    const token = new URLSearchParams(new URL(renewed.inviteUrl).hash.slice(1)).get('token')!;
    expect(
      await db.userToken.count({ where: { userId: created.userId, revokedAt: null, usedAt: null } })
    ).toBe(1);
    const client = await onboarding.newPage();
    await client.goto('/set-password#token=' + encodeURIComponent(token));
    await expect(client.locator('input[name="token"]')).toHaveValue(token);
    await client.getByLabel('New password', { exact: true }).fill(password);
    await client.getByLabel('Confirm password', { exact: true }).fill(password);
    await client.locator('form button[type="submit"]').click();
    await expect(client).toHaveURL(/\/login/);
    await expect
      .poll(async () => (await db.user.findUniqueOrThrow({ where: { id: created.userId } })).status)
      .toBe('ACTIVE');
    await client.locator('input[type="email"]').fill(apiEmail);
    await client.locator('input[type="password"]').fill(password);
    await client.locator('form button[type="submit"]').click();
    await expect(client).not.toHaveURL(/\/login/);
    await page.goto(`/users?q=${encodeURIComponent(apiEmail)}`);
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible();
    expect(
      await db.auditLog.count({
        where: { action: 'user.invited', entityId: { in: [uiUser.id, created.userId] } },
      })
    ).toBe(2);
    expect(
      await db.auditLog.count({ where: { action: 'user.invite.resent', entityId: created.userId } })
    ).toBe(1);
  } finally {
    await onboarding.close();
    const users = await db.user.findMany({
      where: { email: { in: [admin.email, uiEmail, apiEmail] } },
      select: { id: true },
    });
    const ids = users.map(u => u.id);
    await db.backgroundJob.deleteMany({
      where: { payload: { path: ['principalId'], equals: credential.id } },
    });
    await db.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] },
    });
    await db.userToken.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
});
