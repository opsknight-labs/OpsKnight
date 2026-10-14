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
    ]) {
      await page.getByRole('tab', { name: title, exact: true }).click();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    if (process.env.SSO_E2E_CAPTURE === '1') {
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading this section' })
      ).toBeHidden();
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole('heading', { name: 'Overview', exact: true })
        .evaluate(element => element.closest('section')?.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: 'docs/v2.1.0/assets/enterprise-authentication-desktop.png' });
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.locator('.sidebar-mobile').waitFor({ state: 'attached' });
    const closeNavigation = page.getByRole('button', {
      name: 'Close navigation menu',
      exact: true,
    });
    if (await closeNavigation.isVisible()) {
      await closeNavigation.click();
      await expect(closeNavigation).toBeHidden();
    }
    await page.waitForFunction(
      () =>
        (document.querySelector('.sidebar-mobile')?.getBoundingClientRect().right ?? Infinity) <= 1
    );
    if (process.env.SSO_E2E_CAPTURE === '1') {
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading this section' })
      ).toBeHidden();
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
    await page.getByRole('textbox', { name: 'Emergency identity name', exact: true }).fill(name);
    await page.getByRole('checkbox', { name: /separately held hardware keys/ }).check();
    await page.getByRole('button', { name: 'Create emergency identity', exact: true }).click();
    const identity = page
      .locator('li:visible')
      .filter({ has: page.getByText(`${name} —`, { exact: false }) })
      .first();
    await expect(identity).toBeVisible({ timeout: 30000 });
    const accountId = await identity.locator('code').innerText();
    await identity.getByRole('button', { name: 'Enroll hardware key', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Key enrolled' })).toBeVisible({
      timeout: 30000,
    });
    if (process.env.SSO_E2E_CAPTURE === '1') {
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading this section' })
      ).toBeHidden();
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.addStyleTag({
        content: '* { transition: none !important; animation: none !important; }',
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await expect
        .poll(
          async () =>
            (
              await page
                .getByRole('heading', { name: 'Emergency Access', exact: true })
                .first()
                .boundingBox()
            )?.x ?? 0
        )
        .toBeGreaterThan(220);
      await page
        .getByRole('heading', { name: 'Emergency Access', exact: true })
        .first()
        .evaluate(element => {
          let ancestor: Element | null = element;
          while (ancestor) {
            ancestor.scrollTop = 0;
            ancestor = ancestor.parentElement;
          }
          window.scrollTo(0, 0);
        });
      await page.screenshot({
        path: 'docs/v2.1.0/assets/enterprise-emergency-access.png',
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
    const preflight = await recovery.request.post(`${origin}/api/auth/emergency`, {
      headers: { Origin: origin },
      data: { action: 'invalid-preflight' },
    });
    expect(preflight.status()).toBe(400); // Compile the development handler before a native key prompt.
    await recoveryPage.goto(`${origin}/login/emergency`);
    await recoveryPage.getByLabel('Emergency account identifier').fill(accountId);
    await recoveryPage
      .getByRole('button', { name: 'Sign in with hardware key', exact: true })
      .click();
    await recoveryPage.waitForURL(`${origin}/recovery`, { waitUntil: 'domcontentloaded' });
    await expect(
      recoveryPage.getByRole('heading', { name: 'Authentication recovery console', exact: true })
    ).toBeVisible();
    const recoveryCookie = (await recovery.cookies()).find(cookie =>
      cookie.name.endsWith('opsknight-emergency')
    );
    expect(recoveryCookie).toBeDefined();
    expect(recoveryCookie?.httpOnly).toBe(true);
    expect(recoveryCookie?.sameSite).toBe('Strict');
    expect(recoveryCookie?.path).toBe('/');
    if (new URL(origin).protocol === 'https:') {
      expect(recoveryCookie?.secure).toBe(true);
      expect(recoveryCookie?.name).toBe('__Host-opsknight-emergency');
    }
    const authSession = await recovery.request.get(`${origin}/api/auth/session`);
    expect((await authSession.json())?.user).toBeUndefined();
    await recoveryPage.goto(`${origin}/incidents`, { waitUntil: 'domcontentloaded' });
    await expect(recoveryPage).toHaveURL(/\/login/);
    await recoveryPage.goto(`${origin}/recovery`);
    await recoveryPage.getByRole('tab', { name: 'Emergency Access', exact: true }).click();
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
    // Saved revision selection must load its own sanitized configuration, not production.
    const saved = await context.request.get(`${origin}/api/auth/control?section=connection`);
    const dashboard = (await saved.json()).data;
    await page.getByRole('tab', { name: 'Connection', exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: 'Provider revision', exact: true })
    ).toBeEnabled();
    for (const revision of dashboard.revisions.slice(0, 2)) {
      await page
        .getByRole('combobox', { name: 'Provider revision', exact: true })
        .selectOption(revision.id);
      await expect(page.getByLabel('Client ID', { exact: true })).toHaveValue(
        revision.configuration.clientId
      );
    }
    if (process.env.SSO_E2E_DELIVERY_HISTORY === '1') {
      let staleReads = 0;
      // Simulate a stale read without changing the browser's native POST behavior.
      await page.route('**/api/auth/control?*', async route => {
        if (!new URL(route.request().url()).searchParams.has('status')) return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        if (body.data?.alerts) {
          staleReads++;
          body.data.alerts = body.data.alerts.map((alert: { deliveryGeneration: number }) => ({
            ...alert,
            deliveryGeneration: alert.deliveryGeneration + 1000,
          }));
        }
        return route.fulfill({ response, json: body });
      });

      await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Security email delivery history' })
      ).toBeVisible();
      await expect(page.getByText('Fan-out jobs pending', { exact: true })).toBeVisible();
      await expect(page.getByText('Materialized emails pending', { exact: true })).toBeVisible();
      const history = page
        .getByRole('heading', { name: 'Security email delivery history' })
        .locator('..');
      await expect(history.getByRole('button', { name: 'Load more deliveries' })).toBeVisible();
      await history.getByRole('button', { name: 'Load more deliveries' }).click();
      await expect(history.locator('li')).toHaveCount(30);
      expect(staleReads).toBeGreaterThanOrEqual(2);
      await history.getByRole('button', { name: 'Retry email' }).first().click();
      const retryResponse = page.waitForResponse(
        response =>
          response.url().endsWith('/api/auth/control') && response.request().method() === 'POST'
      );
      await history.getByRole('button', { name: 'Confirm email retry' }).click();
      expect(await (await retryResponse).json()).toMatchObject({
        error: expect.stringContaining('Delivery state changed'),
      });
      await expect(
        page.getByRole('alert').filter({ hasText: 'Delivery state changed' })
      ).toBeVisible();
      await expect(history.getByRole('button', { name: 'Confirm email retry' })).toBeEnabled();
      await history.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.unroute('**/api/auth/control?*');
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const closeNavigation = page.getByRole('button', {
          name: 'Close navigation menu',
          exact: true,
        });
        if (await closeNavigation.isVisible()) await closeNavigation.click();
        if (width === 390)
          await page.waitForFunction(
            () =>
              (document.querySelector('.sidebar-mobile')?.getBoundingClientRect().right ?? 0) <= 1
          );
        await page
          .getByRole('heading', { name: 'Security email delivery history' })
          .scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
        if (process.env.SSO_E2E_DIAGNOSTICS_CAPTURE_DIR)
          await page.screenshot({
            path: `${process.env.SSO_E2E_DIAGNOSTICS_CAPTURE_DIR}/diagnostics-${page.context().browser()?.browserType().name()}-${width}.png`,
            fullPage: true,
          });
      }
      await page.getByRole('tab', { name: 'Connection', exact: true }).click();
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const closeNavigation = page.getByRole('button', {
        name: 'Close navigation menu',
        exact: true,
      });
      if (await closeNavigation.isVisible()) {
        await closeNavigation.click();
        await expect(closeNavigation).toBeHidden();
      }
      const connection = page.getByRole('tab', { name: 'Connection', exact: true });
      await connection.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Connection', exact: true })).toBeVisible();
      const client = page.getByLabel('Client ID', { exact: true });
      await expect(client).toBeEnabled();
      await client.fill('');
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
        page.getByRole('alert').filter({ hasText: 'Invalid authentication request' })
      ).toBeVisible();
    }
  } finally {
    await context.close().catch(() => {});
  }
});
