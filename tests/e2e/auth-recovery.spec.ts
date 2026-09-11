import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const databaseUrl = process.env.DATABASE_URL!;
const BOOTSTRAP_CONFIG_KEY = 'auth.bootstrap.authorization';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function resetBootstrapFixture() {
  // Playwright retries must start from the same fresh-install contract. If a
  // prior attempt times out while the first Server Action is compiling, its
  // out-of-band capability may remain active even though no admin committed.
  // This database is dedicated to the serial browser suite, so clear only the
  // auth/bootstrap fixture before re-issuing the capability.
  await prisma.auditLog.deleteMany();
  await prisma.userToken.deleteMany();
  await prisma.systemConfig.deleteMany({ where: { key: BOOTSTRAP_CONFIG_KEY } });
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
}

async function createResetCapability(email: string, password: string, token: string) {
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Recovery Browser User',
      passwordHash: await bcrypt.hash(password, 12),
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  await prisma.userToken.create({
    data: {
      identifier: user.id,
      userId: user.id,
      type: 'PASSWORD_RESET',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  return user;
}

async function createInviteCapability(email: string, token: string) {
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Invite Browser User',
      passwordHash: null,
      role: 'USER',
      status: 'INVITED',
      invitedAt: new Date(),
      invitationGeneration: 1,
    },
  });
  await prisma.userToken.create({
    data: {
      identifier: email,
      userId: user.id,
      generation: 1,
      type: 'INVITE',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    },
  });
  return user;
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
}

test.describe.serial('authentication browser contracts', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('fresh install bootstrap is issued out-of-band and consumed by first-admin creation', async ({
    page,
  }) => {
    await resetBootstrapFixture();

    const output = execFileSync('node', ['scripts/create-bootstrap-code.mjs'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    const bootstrapCode = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => /^[A-Za-z0-9_-]{32}$/.test(line));
    expect(bootstrapCode).toBeTruthy();

    await page.goto('/setup');
    await expect(page.getByText('Operator authorization ready')).toBeVisible();
    await page.getByLabel('Full name').fill('E2E Administrator');
    await page.getByLabel('Email address').fill('e2e-admin@example.com');
    await page.getByLabel('Setup authorization code').fill(bootstrapCode!);
    await page.getByLabel('Administrator password').fill('Cobalt-orbit-library-492!');
    await page.getByLabel('Confirm password').fill('Cobalt-orbit-library-492!');
    await page.getByRole('button', { name: 'Create administrator' }).click();

    await expect(page.getByText('Administrator created')).toBeVisible({ timeout: 20_000 });
    const admin = await prisma.user.findUnique({ where: { email: 'e2e-admin@example.com' } });
    expect(admin?.status).toBe('ACTIVE');
    expect(admin?.role).toBe('ADMIN');

    const bootstrapRow = await prisma.systemConfig.findUnique({
      where: { key: BOOTSTRAP_CONFIG_KEY },
    });
    expect((bootstrapRow?.value as { usedAt?: string | null } | null)?.usedAt).toBeTruthy();
  });

  test('reset fragment is scrubbed, password changes, replay fails, and login accepts only the new password', async ({
    page,
  }) => {
    const email = 'reset-browser@example.com';
    const oldPassword = 'Old-harbor-lantern-381!';
    const newPassword = 'Violet-harbor-comet-771!';
    const token = 'reset-browser-token-12345678901234567890123456789012';
    const user = await createResetCapability(email, oldPassword, token);

    await page.goto(`/reset-password#token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByLabel('New password').fill(newPassword);
    await page.getByLabel('Confirm password').fill(newPassword);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Password updated')).toBeVisible();

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(await bcrypt.compare(oldPassword, updated!.passwordHash!)).toBe(false);
    expect(await bcrypt.compare(newPassword, updated!.passwordHash!)).toBe(true);

    await page.goto(`/reset-password#token=${encodeURIComponent(token)}`);
    await page.getByLabel('New password').fill('Second-violet-harbor-882!');
    await page.getByLabel('Confirm password').fill('Second-violet-harbor-882!');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid or expired reset link');

    await login(page, email, oldPassword);
    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await page.locator('input[type="password"]').fill(newPassword);
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('invite fragment activates account and legacy query links are scrubbed from browser history', async ({
    page,
  }) => {
    const token = 'invite-browser-token-1234567890123456789012345678901';
    const user = await createInviteCapability('invite-browser@example.com', token);
    const password = 'Marble-forest-signal-882!';

    await page.goto(`/set-password#token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/set-password$/);
    await page.getByLabel('New password').fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Set password and activate' }).click();
    await expect(page).toHaveURL(/\/login\?password=1/);

    const activated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(activated?.status).toBe('ACTIVE');
    expect(await bcrypt.compare(password, activated!.passwordHash!)).toBe(true);

    const legacyToken = 'legacy-invite-token-123456789012345678901234567890';
    await createInviteCapability('legacy-invite-browser@example.com', legacyToken);
    await page.goto(`/set-password?token=${encodeURIComponent(legacyToken)}`);
    await expect(page).toHaveURL(/\/set-password$/);
    expect(page.url()).not.toContain('token=');
    await expect(page.getByRole('button', { name: 'Set password and activate' })).toBeVisible();
  });

  test('mobile reset converges on canonical page and unsafe callback cannot escape origin', async ({
    page,
  }) => {
    const token = 'mobile-reset-token-12345678901234567890123456789012';
    await page.goto(`/m/reset-password#token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();

    const email = 'callback-browser@example.com';
    const password = 'Callback-harbor-orbit-992!';
    await prisma.user.create({
      data: {
        email,
        name: 'Callback Browser User',
        passwordHash: await bcrypt.hash(password, 12),
        role: 'USER',
        status: 'ACTIVE',
      },
    });

    await page.goto('/login?callbackUrl=https%3A%2F%2Fevil.example%2Fsteal');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL('http://127.0.0.1:3100/');
  });

  test('password controls support keyboard activation and mismatch feedback', async ({ page }) => {
    const token = 'keyboard-invite-token-12345678901234567890123456789';
    await createInviteCapability('keyboard-invite@example.com', token);
    await page.goto(`/set-password#token=${encodeURIComponent(token)}`);

    const passwordInput = page.getByLabel('New password');
    await passwordInput.fill('Keyboard-harbor-comet-482!');
    const showButton = page.getByRole('button', { name: 'Show password' });
    await showButton.focus();
    await page.keyboard.press('Space');
    await expect(passwordInput).toHaveAttribute('type', 'text');

    await page.getByLabel('Confirm password').fill('Different-harbor-comet-483!');
    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set password and activate' })).toBeDisabled();
  });
});
