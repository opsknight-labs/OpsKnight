import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const databaseUrl =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5432/opsknight_e2e?schema=public';

const BOOTSTRAP_CONFIG_KEY = 'auth.bootstrap.authorization';
const PORT = '3100';

const APP_HOST = 'fresh.opsknight.test';
const STATUS_HOST = 'status.customer.test';
const ATTACKER_HOST = 'unknown.attacker.test';
const REPLACEMENT_HOST = 'replacement.opsknight.test';
const APEX_HOST = 'opsknight.test';
const WWW_HOST = 'www.opsknight.test';

const APP_BASE = `http://${APP_HOST}:${PORT}`;
const STATUS_BASE = `http://${STATUS_HOST}:${PORT}`;
const ATTACKER_BASE = `http://${ATTACKER_HOST}:${PORT}`;
const REPLACEMENT_BASE = `http://${REPLACEMENT_HOST}:${PORT}`;
const DIRECT_SERVER = `http://127.0.0.1:${PORT}`;

const ADMIN_EMAIL = 'fresh-admin@opsknight.test';
const ADMIN_PASSWORD = 'Secure-Bootstrap-Comet-492!';

const isTrustedProxyMode = process.env.TRUST_PROXY_HEADERS === 'true';

async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.userToken.deleteMany();
  await prisma.systemConfig.deleteMany({ where: { key: BOOTSTRAP_CONFIG_KEY } });
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
  await prisma.statusPage.deleteMany();
  await prisma.systemSettings.deleteMany();
}

async function seedStatusPage() {
  return prisma.statusPage.create({
    data: {
      name: 'Customer Status Page',
      slug: 'customer-status',
      customDomain: STATUS_HOST,
      enabled: true,
      showServices: true,
      showIncidents: true,
    },
  });
}

function issueBootstrapCode(): string {
  const output = execFileSync('node', ['scripts/create-bootstrap-code.mjs'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  const code = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => /^[A-Za-z0-9_-]{32}$/.test(line));
  expect(code).toBeTruthy();
  return code!;
}

// ---------------------------------------------------------------------------
// SUITE 1: Standard Host Bootstrap Routing Lifecycle (untrusted proxy default)
// ---------------------------------------------------------------------------
test.describe.serial('host bootstrap routing lifecycle', () => {
  test.skip(isTrustedProxyMode, 'Runs only in standard (untrusted proxy) mode');

  test.beforeAll(async () => {
    await resetDatabase();
    await seedStatusPage();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('1. fresh installation asserts 0 users and null appUrl', async () => {
    const userCount = await prisma.user.count();
    const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });

    expect(userCount).toBe(0);
    expect(systemSettings?.appUrl).toBeFalsy();
  });

  test('2. bootstrap exception allows /setup on unknown host but rejects all other app routes with 421', async ({
    page,
  }) => {
    // /setup is permitted on an unknown host during initial bootstrap
    const setupRes = await page.goto(`${APP_BASE}/setup`);
    expect(setupRes?.status()).toBe(200);
    await expect(page.getByText('System initialization')).toBeVisible();

    // /login is rejected with 421 Misdirected Request
    const loginRes = await page.goto(`${APP_BASE}/login`);
    expect(loginRes?.status()).toBe(421);

    // /users is rejected with 421
    const usersRes = await page.goto(`${APP_BASE}/users`);
    expect(usersRes?.status()).toBe(421);

    // /settings is rejected with 421
    const settingsRes = await page.goto(`${APP_BASE}/settings`);
    expect(settingsRes?.status()).toBe(421);

    // Unknown attacker domain is rejected with 421 on /login and /users
    const attackerLoginRes = await page.goto(`${ATTACKER_BASE}/login`);
    expect(attackerLoginRes?.status()).toBe(421);

    const attackerUsersRes = await page.goto(`${ATTACKER_BASE}/users`);
    expect(attackerUsersRes?.status()).toBe(421);
  });

  test('3. status domains remain strictly isolated during first installation', async ({ page }) => {
    // Status page itself renders
    const rootRes = await page.goto(`${STATUS_BASE}/`);
    expect(rootRes?.status()).toBe(200);

    // Status history renders
    const historyRes = await page.goto(`${STATUS_BASE}/history`);
    expect(historyRes?.status()).toBe(200);

    // /setup on status domain is rejected by status firewall with 404 (statusRoute takes precedence)
    const setupRes = await page.goto(`${STATUS_BASE}/setup`);
    expect(setupRes?.status()).toBe(404);

    // /login on status domain is rejected by status firewall with 404
    const loginRes = await page.goto(`${STATUS_BASE}/login`);
    expect(loginRes?.status()).toBe(404);

    // /users on status domain is rejected with 404
    const usersRes = await page.goto(`${STATUS_BASE}/users`);
    expect(usersRes?.status()).toBe(404);

    // /settings on status domain is rejected with 404
    const settingsRes = await page.goto(`${STATUS_BASE}/settings`);
    expect(settingsRes?.status()).toBe(404);

    // /api/auth/session on status domain is rejected with 404
    const authRes = await page.goto(`${STATUS_BASE}/api/auth/session`);
    expect(authRes?.status()).toBe(404);
  });

  test('4. operator generates bootstrap code, fills setup form, and creates first administrator', async ({
    page,
  }) => {
    const bootstrapCode = issueBootstrapCode();

    await page.goto(`${APP_BASE}/setup`);
    await expect(page.getByText('Operator authorization ready')).toBeVisible();

    await page.getByLabel('Full name').fill('E2E Bootstrap Admin');
    await page.getByLabel('Email address').fill(ADMIN_EMAIL);
    await page.getByLabel('Setup authorization code').fill(bootstrapCode);
    await page.getByLabel('Administrator password').fill(ADMIN_PASSWORD);
    await page.getByLabel('Confirm password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Create administrator' }).click();

    await expect(page.getByText('Administrator created')).toBeVisible({ timeout: 20_000 });
  });

  test('5. bootstrap automatically seeds SystemSettings.appUrl and marks capability used', async () => {
    // SystemSettings.appUrl is seeded with the request URL used during setup
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    expect(settings?.appUrl).toBe(APP_BASE);

    // Administrator record is created and active
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    expect(admin?.role).toBe('ADMIN');
    expect(admin?.status).toBe('ACTIVE');

    // Bootstrap authorization state is marked as used
    const bootstrapRow = await prisma.systemConfig.findUnique({
      where: { key: BOOTSTRAP_CONFIG_KEY },
    });
    const state = bootstrapRow?.value as { usedAt?: string | null } | null;
    expect(state?.usedAt).toBeTruthy();

    // Audit log records the bootstrap app URL seeding
    const auditEntries = await prisma.auditLog.findMany({
      where: { action: 'settings.app_url.bootstrap_seeded' },
    });
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
  });

  test('6. post-bootstrap, the established host becomes a recognized application host and allows login', async ({
    page,
  }) => {
    // /login is now accessible (200, no longer 421)
    const loginRes = await page.goto(`${APP_BASE}/login`);
    expect(loginRes?.status()).toBe(200);

    // Perform login with the newly created administrator credentials
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('form button[type="submit"]').click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

    // Verify core app routes now return 200
    const settingsRes = await page.goto(`${APP_BASE}/settings`);
    expect(settingsRes?.status()).toBe(200);

    const usersRes = await page.goto(`${APP_BASE}/users`);
    expect(usersRes?.status()).toBe(200);

    const incidentsRes = await page.goto(`${APP_BASE}/incidents`);
    expect(incidentsRes?.status()).toBe(200);
  });

  test('7. /setup cannot re-initialize the system and refuses a second bootstrap admin', async ({
    page,
  }) => {
    // Navigating to /setup now redirects to /login because a user exists
    await page.goto(`${APP_BASE}/setup`);
    await expect(page).toHaveURL(/\/login/);

    // Attempting to generate another bootstrap code fails
    let failed = false;
    try {
      execFileSync('node', ['scripts/create-bootstrap-code.mjs'], {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });
    } catch (err: unknown) {
      failed = true;
      const error = err as { stderr?: string; stdout?: string };
      const output = `${error.stderr || ''} ${error.stdout || ''}`;
      expect(output).toContain('already initialized');
    }
    expect(failed).toBe(true);
  });

  test('8. other unknown hosts remain strictly rejected after bootstrap', async ({ page }) => {
    const rootRes = await page.goto(`${ATTACKER_BASE}/`);
    expect(rootRes?.status()).toBe(421);

    const loginRes = await page.goto(`${ATTACKER_BASE}/login`);
    expect(loginRes?.status()).toBe(421);

    const settingsRes = await page.goto(`${ATTACKER_BASE}/settings`);
    expect(settingsRes?.status()).toBe(421);
  });

  test('9. authenticated admin session cannot escape status firewall to application routes', async ({
    page,
    context,
  }) => {
    // Copy authenticated session cookies to the status domain so cookies are present
    const appCookies = await context.cookies(`${APP_BASE}`);
    if (appCookies.length > 0) {
      await context.addCookies(
        appCookies.map(cookie => ({
          ...cookie,
          domain: STATUS_HOST,
        }))
      );
    }

    // Status domain firewall continues to return 404 on app paths, even with valid auth cookies
    const usersRes = await page.goto(`${STATUS_BASE}/users`);
    expect(usersRes?.status()).toBe(404);

    const settingsRes = await page.goto(`${STATUS_BASE}/settings`);
    expect(settingsRes?.status()).toBe(404);

    const loginRes = await page.goto(`${STATUS_BASE}/login`);
    expect(loginRes?.status()).toBe(404);
  });

  test('10. spoofed X-Forwarded-Host cannot bypass status firewall by default (untrusted proxy)', async () => {
    // Attack: connect to status domain but send X-Forwarded-Host claiming to be app domain
    const attack1 = await fetch(`${DIRECT_SERVER}/users`, {
      headers: {
        host: `${STATUS_HOST}:${PORT}`,
        'x-forwarded-host': APP_HOST,
        cookie: 'next-auth.session-token=valid-admin-session',
      },
    });
    expect(attack1.status).toBe(404);

    // Attack: connect to unknown attacker host but spoof X-Forwarded-Host claiming app domain
    const attack2 = await fetch(`${DIRECT_SERVER}/login`, {
      headers: {
        host: `${ATTACKER_HOST}:${PORT}`,
        'x-forwarded-host': APP_HOST,
      },
    });
    expect(attack2.status).toBe(421);
  });

  test('11. settings domain change dynamically updates recognized application host', async ({
    page,
  }) => {
    // Update SystemSettings.appUrl to replacement domain
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { appUrl: REPLACEMENT_BASE },
    });

    // Wait for the 1-second domain config cache to expire
    await page.waitForTimeout(1500);

    // Replacement domain is now the recognized app host => 200
    const replacementLogin = await page.goto(`${REPLACEMENT_BASE}/login`);
    expect(replacementLogin?.status()).toBe(200);

    // Former app domain is no longer recognized => 421
    const oldLogin = await page.goto(`${APP_BASE}/login`);
    expect(oldLogin?.status()).toBe(421);
  });

  test('12. canonical www <-> apex 308 redirect behavior', async ({ page }) => {
    // Configure apex domain as canonical in SystemSettings
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: { appUrl: `http://${APEX_HOST}:${PORT}` },
    });

    await page.waitForTimeout(1500);

    // Secondary www host should receive 308 Permanent Redirect to apex
    const wwwRes = await fetch(`${DIRECT_SERVER}/login?source=nav`, {
      headers: { host: `${WWW_HOST}:${PORT}` },
      redirect: 'manual',
    });
    expect(wwwRes.status).toBe(308);
    const location = wwwRes.headers.get('location');
    expect(location).toContain(`${APEX_HOST}:${PORT}/login?source=nav`);

    // Canonical apex host serves directly => 200
    const apexRes = await fetch(`${DIRECT_SERVER}/login`, {
      headers: { host: `${APEX_HOST}:${PORT}` },
      redirect: 'manual',
    });
    expect(apexRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// SUITE 2: Trusted Proxy Mode (TRUST_PROXY_HEADERS=true)
// ---------------------------------------------------------------------------
test.describe.serial('trusted proxy topology lifecycle', () => {
  test.skip(!isTrustedProxyMode, 'Runs only in trusted-proxy mode');

  test.beforeAll(async () => {
    await resetDatabase();
    await seedStatusPage();

    // Seed canonical app URL in SystemSettings
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', appUrl: APP_BASE },
      update: { appUrl: APP_BASE },
    });

    // Create an active admin user
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await prisma.user.create({
      data: {
        name: 'Proxy Admin',
        email: ADMIN_EMAIL,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
      },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('trusted reverse proxy routes internal Host to app based on X-Forwarded-Host', async () => {
    // Behind reverse proxy: Host is internal container hostname, X-Forwarded-Host is public app host
    const res = await fetch(`${DIRECT_SERVER}/login`, {
      headers: {
        host: `internal-app:${PORT}`,
        'x-forwarded-host': APP_HOST,
        'x-forwarded-proto': 'https',
      },
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
  });

  test('trusted reverse proxy enforces login redirect on protected route with X-Forwarded-Host', async () => {
    const res = await fetch(`${DIRECT_SERVER}/settings`, {
      headers: {
        host: `internal-app:${PORT}`,
        'x-forwarded-host': APP_HOST,
        'x-forwarded-proto': 'https',
      },
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?callbackUrl=%2Fsettings');
  });

  test('trusted reverse proxy routes internal Host to status firewall when X-Forwarded-Host is status domain', async () => {
    const res = await fetch(`${DIRECT_SERVER}/users`, {
      headers: {
        host: `internal-app:${PORT}`,
        'x-forwarded-host': STATUS_HOST,
      },
      redirect: 'manual',
    });
    // Enforces status firewall (404 for application route /users)
    expect(res.status).toBe(404);
  });
});
