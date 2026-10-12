import { test, expect } from '@playwright/test';

// Run only against a disposable, migrated installation with an active fixture admin.
// SSO_E2E_BASE_URL=http://localhost:3005 SSO_E2E_ADMIN_EMAIL=... SSO_E2E_ADMIN_PASSWORD=...
test('enterprise console and independent hardware recovery work in a real browser', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium' || !process.env.SSO_E2E_BASE_URL,
    'Requires isolated SSO fixture and Chromium virtual hardware authenticator.'
  );
  test.setTimeout(240000);
  const origin = process.env.SSO_E2E_BASE_URL!;
  const normal = await browser.newContext();
  const recovery = await browser.newContext();
  try {
    const page = await normal.newPage();
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill(process.env.SSO_E2E_ADMIN_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill(process.env.SSO_E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/login'), {
      waitUntil: 'domcontentloaded',
    });
    await page.goto(`${origin}/settings/system?section=sso`);
    for (const title of [
      'Overview',
      'Connection',
      'Access & provisioning',
      'Authentication policy',
      'Diagnostics',
    ])
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    if (process.env.SSO_E2E_CAPTURE === '1') {
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole('heading', { name: 'Overview', exact: true })
        .evaluate(element => element.closest('section')?.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: 'docs/v2.1.0/assets/enterprise-authentication-desktop.png' });
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    if (process.env.SSO_E2E_CAPTURE === '1') {
      await page
        .getByRole('heading', { name: 'Overview', exact: true })
        .evaluate(element => element.closest('section')?.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: 'docs/v2.1.0/assets/enterprise-authentication-mobile.png' });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    const crossSite = await normal.request.post(`${origin}/api/auth/control`, {
      headers: { Origin: 'https://attacker.example.test' },
      data: {
        action: 'createEmergency',
        displayName: 'Cross-site rejected',
        independenceConfirmed: true,
      },
    });
    expect(crossSite.status()).toBe(403);
    const unauthenticated = await recovery.request.get(`${origin}/api/auth/control`);
    expect(unauthenticated.status()).toBe(403);
    await page.goto(`${origin}/settings/system/emergency`);
    const cdp = await normal.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const name = `Browser recovery drill ${Date.now()}`;
    await page.getByLabel('Emergency identity name', { exact: true }).fill(name);
    await page.getByLabel(/separately held hardware keys/).check();
    await page.getByRole('button', { name: 'Create emergency identity', exact: true }).click();
    const identity = page
      .locator('li')
      .filter({ has: page.getByText(`${name} —`, { exact: false }) })
      .first();
    await expect(identity).toBeVisible({ timeout: 30000 });
    const accountId = await identity.locator('code').innerText();
    await identity.getByRole('button', { name: 'Enroll hardware key', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Key enrolled' })).toBeVisible({
      timeout: 30000,
    });
    if (process.env.SSO_E2E_CAPTURE === '1') {
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.screenshot({
        path: 'docs/v2.1.0/assets/enterprise-emergency-access.png',
        fullPage: true,
      });
    }
    const credentials = await cdp.send('WebAuthn.getCredentials', authenticator);
    expect(credentials.credentials).toHaveLength(1);
    const recoveryPage = await recovery.newPage();
    const recoveryCdp = await recovery.newCDPSession(recoveryPage);
    await recoveryCdp.send('WebAuthn.enable');
    const independent = await recoveryCdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await recoveryCdp.send('WebAuthn.addCredential', {
      ...independent,
      credential: credentials.credentials[0],
    });
    await recoveryPage.goto(`${origin}/login/emergency`);
    await recoveryPage.getByLabel('Emergency account identifier').fill(accountId);
    await recoveryPage
      .getByRole('button', { name: 'Sign in with hardware key', exact: true })
      .click();
    await recoveryPage.waitForURL(`${origin}/recovery`, { waitUntil: 'domcontentloaded' });
    await expect(
      recoveryPage.getByRole('heading', { name: 'Authentication recovery console', exact: true })
    ).toBeVisible();
    const authSession = await recovery.request.get(`${origin}/api/auth/session`);
    expect((await authSession.json())?.user).toBeUndefined();
    await recoveryPage.goto(`${origin}/incidents`, { waitUntil: 'domcontentloaded' });
    await expect(recoveryPage).toHaveURL(/\/login/);
    await recoveryPage.goto(`${origin}/recovery`);
    await recoveryPage.getByRole('button', { name: 'Sign out of recovery', exact: true }).click();
    await recoveryPage.waitForURL(`${origin}/login/emergency`, { waitUntil: 'domcontentloaded' });
    await recoveryPage.goto(`${origin}/recovery`);
    await expect(recoveryPage).toHaveURL(`${origin}/login/emergency`);
    // Leave the disposable fixture usable for another run; normal admin stays separate.
    const disabled = await normal.request.post(`${origin}/api/auth/control`, {
      headers: { Origin: origin },
      data: { action: 'disableEmergency', accountId },
    });
    expect(disabled.ok()).toBe(true);
  } finally {
    await Promise.allSettled([normal.close(), recovery.close()]);
  }
});

test('enterprise console supports desktop/mobile layout and keyboard navigation', async ({
  browser,
}) => {
  test.skip(!process.env.SSO_E2E_BASE_URL, 'Requires isolated SSO fixture.');
  test.setTimeout(120000);
  const origin = process.env.SSO_E2E_BASE_URL!;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill(process.env.SSO_E2E_ADMIN_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill(process.env.SSO_E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/login'));
    await page.goto(`${origin}/settings/system?section=sso`);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const connection = page.getByRole('link', { name: 'Connection', exact: true });
      await connection.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#authentication-1$/);
      const client = page.getByLabel('Client ID', { exact: true });
      await client.focus();
      await page.keyboard.type('keyboard-client');
      await expect(client).toHaveValue('keyboard-client');
      await client.fill('');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page
        .getByRole('button', { name: 'Stage and validate connection', exact: true })
        .click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Invalid authentication request' })
      ).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
