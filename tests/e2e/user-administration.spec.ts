import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateApiKey } from '@/lib/api-keys';
const db = new PrismaClient();
test.afterAll(async () => db.$disconnect());
test('administrator UI and REST share role, deactivation and reactivation outcomes', async ({
  page,
}) => {
  if (
    !['/runbook_ui_test', '/rbe_engine_test'].includes(
      new URL(process.env.DATABASE_URL ?? '').pathname
    )
  )
    throw new Error('Dedicated administration browser database required.');
  const suffix = crypto.randomUUID(),
    password = 'User-browser-harbor-parity-472!';
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await db.user.create({
    data: {
      name: `Identity admin ${suffix}`,
      email: `identity-admin-${suffix}@example.invalid`,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
    },
  });
  const target = await db.user.create({
    data: {
      name: `Identity target ${suffix}`,
      email: `identity-target-${suffix}@example.invalid`,
      status: 'ACTIVE',
      passwordHash,
    },
  });
  const issued = generateApiKey();
  await db.apiKey.create({
    data: {
      name: 'Identity browser parity',
      userId: admin.id,
      scopes: ['users:read', 'users:write'],
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
    },
  });
  const apiHeaders = { Authorization: `Bearer ${issued.token}` };
  const userPath = `/api/v2/users/${target.id}/administration`;
  const security = () => db.user.findUniqueOrThrow({ where: { id: target.id } });
  try {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto(`/users?q=${encodeURIComponent(target.email)}`);
    await page.getByRole('button', { name: 'Open user actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Change Role', exact: true }).hover();
    await page.getByRole('menuitem', { name: 'Responder', exact: true }).click();
    await expect.poll(async () => (await security()).role).toBe('RESPONDER');
    await page.getByRole('button', { name: 'Open user actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Deactivate User', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Deactivate', exact: true })
      .click();
    await expect.poll(async () => (await security()).status).toBe('DISABLED');
    const read = await page.request.get(userPath, { headers: apiHeaders });
    expect(read.status()).toBe(200);
    expect((await read.json()).data).toMatchObject({ status: 'DISABLED', role: 'RESPONDER' });
    const writeHeaders = {
      ...apiHeaders,
      'If-Match': read.headers().etag,
      'Idempotency-Key': `reactivate-${suffix}`,
    };
    const activate = () =>
      page.request.patch(userPath, { headers: writeHeaders, data: { operation: 'reactivate' } });
    expect((await activate()).status()).toBe(200);
    const replay = await activate();
    expect(replay.status()).toBe(200);
    expect(replay.headers()['idempotency-replayed']).toBe('true');
    await expect.poll(async () => (await security()).status).toBe('ACTIVE');
    await page.reload();
    await page.getByRole('button', { name: 'Open user actions', exact: true }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Deactivate User', exact: true })
    ).toBeVisible();
    await db.userDevice.create({
      data: {
        userId: target.id,
        deviceId: 'session:browser-' + suffix,
        platform: 'session:STANDARD',
        token: 'browser-session-digest-' + suffix,
      },
    });
    const sessionRead = await page.request.get(userPath, { headers: apiHeaders });
    const revoked = await page.request.patch(userPath, {
      headers: {
        ...apiHeaders,
        'If-Match': sessionRead.headers().etag,
        'Idempotency-Key': 'revoke-' + suffix,
      },
      data: { operation: 'revoke-sessions' },
    });
    expect(revoked.status()).toBe(200);
    expect(await db.userDevice.findFirstOrThrow({ where: { userId: target.id } })).toMatchObject({
      platform: 'session:REVOKED:STANDARD',
    });
    expect((await security()).tokenVersion).toBe(target.tokenVersion + 4);
    const audits = await db.auditLog.findMany({ where: { entityId: target.id } });
    expect(audits.map(a => a.action).sort()).toEqual([
      'user.deactivated',
      'user.reactivated',
      'user.role.updated',
      'user.sessions.revoked',
    ]);
  } finally {
    await db.auditLog.deleteMany({
      where: { OR: [{ entityId: target.id }, { actorId: admin.id }] },
    });
    await db.user.deleteMany({ where: { id: { in: [target.id, admin.id] } } });
  }
});
