import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
      'Identity Provider',
      'Access & provisioning',
      'Sessions & Policies',
      'Diagnostics',
    ]) {
      await page.getByRole('tab', { name: title, exact: true }).click();
      await expect(
        page.getByRole('heading', {
          name:
            title === 'Overview'
              ? /Configure Enterprise SSO|Authentication overview/
              : title === 'Diagnostics'
                ? 'Authentication diagnostics'
                : title,
          exact: title !== 'Overview',
        })
      ).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    if (process.env.SSO_E2E_CAPTURE === '1') {
      await expect(
        page.getByRole('status').filter({ hasText: 'Loading this section' })
      ).toBeHidden();
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole('heading', { name: /Configure Enterprise SSO|Authentication overview/ })
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
        .getByRole('heading', { name: /Configure Enterprise SSO|Authentication overview/ })
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
    // The empty state shows the action twice (header and call-to-action); either opens the dialog.
    await page
      .getByRole('button', { name: 'Create emergency identity', exact: true })
      .first()
      .click();
    await page.getByRole('textbox', { name: 'Emergency identity name', exact: true }).fill(name);
    await page
      .getByRole('checkbox', { name: /custody independent of the other emergency identity/ })
      .check();
    await page
      .getByRole('combobox', { name: 'Recovery method', exact: true })
      .selectOption('WEBAUTHN');
    await page.getByRole('button', { name: 'Create identity', exact: true }).click();
    const identity = page
      .locator('li:visible')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first();
    await expect(identity).toBeVisible({ timeout: 30000 });
    await identity.getByRole('button', { name: /Manage/ }).click();
    const accountId = await page.getByRole('dialog').locator('dd.font-mono').innerText();
    await page.getByRole('button', { name: 'Enroll hardware key', exact: true }).click();
    await page.getByRole('checkbox', { name: /I understand the session revocation/ }).check();
    await page.getByRole('button', { name: 'Confirm recovery change' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Recovery credential updated' })
    ).toBeVisible({
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
    await recoveryPage.getByRole('tab', { name: 'Emergency Recovery', exact: true }).click();
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
    await expect(
      page.getByRole('heading', { name: /Configure Enterprise SSO|Authentication overview/ })
    ).toBeVisible();
    // Saved revision selection must load its own sanitized configuration, not production.
    const saved = await context.request.get(`${origin}/api/auth/control?section=connection`);
    const dashboard = (await saved.json()).data;
    await page.getByRole('tab', { name: 'Identity Provider', exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: 'Saved provider configuration', exact: true })
    ).toBeEnabled();
    for (const revision of dashboard.revisions.slice(0, 2)) {
      await page
        .getByRole('combobox', { name: 'Saved provider configuration', exact: true })
        .selectOption(revision.id);
      await expect(page.getByLabel('Client ID', { exact: true })).toHaveValue(
        revision.configuration.clientId
      );
    }

    if (process.env.SSO_E2E_READINESS_PREVIEW === '1') {
      await page
        .getByRole('combobox', { name: 'Saved provider configuration', exact: true })
        .selectOption('browser-overage-preview');
      await page.getByRole('tab', { name: 'Access & provisioning', exact: true }).click();
      const sample = page.getByLabel(
        'Sample claims for identity and role preview (never paste tokens)'
      );
      const claims = {
        iss: 'https://accounts.google.com',
        sub: 'browser-ready-subject',
        email_verified: true,
        hasgroups: true,
      };
      await sample.fill(JSON.stringify(claims));
      await page.getByRole('button', { name: 'Preview identity and roles' }).click();
      await expect(page.getByText('Identity recognized', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Administrator verification blocked by incomplete group claims.', {
          exact: true,
        })
      ).toBeVisible();
      await sample.fill(
        JSON.stringify({ ...claims, hasgroups: false, groups: ['administrators'] })
      );
      await expect(page.getByText('Identity recognized', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Preview identity and roles' }).click();
      await expect(
        page.getByText(
          'Sample claims permit an administrator test; real signed-token verification is still required.',
          { exact: true }
        )
      ).toBeVisible();
    }
    if (process.env.SSO_E2E_DELIVERY_HISTORY === '1') {
      await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
      await page.getByRole('tab', { name: 'Security notifications', exact: true }).click();
      const top = page.getByRole('navigation', { name: 'Top diagnostic pagination' });
      await expect(top.getByRole('button', { name: 'Next page' })).toBeEnabled();
      await top.getByRole('button', { name: 'Next page' }).click();
      await expect(page.locator('tbody tr')).toHaveCount(5);
      await top.getByRole('button', { name: 'Previous page' }).click();
      await expect(page.locator('tbody tr')).toHaveCount(25);
      for (const status of ['ACCEPTED', 'DELIVERED', 'FAILED']) {
        await page.getByLabel('Record status', { exact: true }).selectOption(status);
        await page.getByRole('button', { name: 'Apply filters' }).click();
        await expect(page.getByText('Loading security notifications…')).toBeHidden();
      }
      await page.getByRole('tab', { name: 'Identity Provider', exact: true }).click();
    }
    // Local presentation walkthrough: no live tenant or discovery request is required.
    await page
      .getByRole('combobox', { name: 'Identity provider', exact: true })
      .selectOption('azure');
    await page.getByRole('button', { name: /Change provider/ }).click();
    await page
      .getByRole('textbox', { name: /^Directory \(tenant\) ID/ })
      .fill('11111111-2222-3333-4444-555555555555');
    await expect(page.getByRole('textbox', { name: /^Directory \(tenant\) ID/ })).toHaveValue(
      '11111111-2222-3333-4444-555555555555'
    );
    await page.getByText('Advanced provider settings', { exact: true }).click();
    await page.getByRole('checkbox', { name: /Edit the exact issuer/ }).check();
    for (const host of [
      'login.microsoftonline.us',
      'login.partner.microsoftonline.cn',
      'authority.example.test',
    ]) {
      const issuer = `https://${host}/11111111-2222-3333-4444-555555555555/v2.0`;
      await page.getByRole('textbox', { name: /^Exact issuer/ }).fill(issuer);
      await expect(page.getByRole('textbox', { name: /^Exact issuer/ })).toHaveValue(issuer);
      await expect(page.getByRole('textbox', { name: /^Directory \(tenant\) ID/ })).toHaveCount(0);
    }
    await page
      .getByRole('combobox', { name: 'Identity provider', exact: true })
      .selectOption('google');
    await page.getByRole('button', { name: /Change provider/ }).click();
    await expect(
      page.getByRole('combobox', { name: 'Identity provider', exact: true })
    ).toHaveValue('google');
    // Reset all walkthrough edits before checking the untouched provider layout.
    if (await page.getByRole('button', { name: 'Discard changes', exact: true }).isEnabled()) {
      await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
      await page.getByRole('button', { name: 'Discard draft changes', exact: true }).click();
    }
    await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
    for (const name of [
      'Sign-in & sessions',
      'Security notifications',
      'Recovery & audit',
      'Deployment health',
    ]) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(
        page.getByRole('navigation', { name: 'Top diagnostic pagination' })
      ).toBeVisible();
      await expect(page.getByText(/Unable to load|Request timed out/)).toHaveCount(0);
    }
    await page.getByRole('tab', { name: 'Identity Provider', exact: true }).click();
    for (const width of [320, 390, 768, 1366, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const closeNavigation = page.getByRole('button', {
        name: 'Close navigation menu',
        exact: true,
      });
      if (await closeNavigation.isVisible()) {
        await closeNavigation.click();
        await expect(closeNavigation).toBeHidden();
      }
      const connection = page.getByRole('tab', { name: 'Identity Provider', exact: true });
      await connection.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('heading', { name: 'Identity Provider', exact: true })
      ).toBeVisible();
      await page.getByLabel('Client ID', { exact: true }).fill('preview-client');
      await page.getByLabel('Client ID', { exact: true }).fill('');
      const axePath = resolve('node_modules/axe-core/axe.min.js');
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => {
        const engine = (
          window as unknown as {
            axe: {
              run: (
                node: Element,
                options: unknown
              ) => Promise<{ violations: Array<{ id: string; impact: string; nodes: unknown[] }> }>;
            };
          }
        ).axe;
        return (
          await engine.run(document.querySelector('[aria-labelledby="auth-connection-title"]')!, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          })
        ).violations;
      });
      expect(violations).toEqual([]);
      if (process.env.SSO_E2E_DIAGNOSTICS_CAPTURE_DIR)
        await page.screenshot({
          path: `${process.env.SSO_E2E_DIAGNOSTICS_CAPTURE_DIR}/provider-${page.context().browser()?.browserType().name()}-${width}.png`,
          fullPage: true,
        });
      expect(new URL(page.url()).searchParams.get('section')).toBe('sso');
      expect(new URL(page.url()).searchParams.get('authTab')).toBe('connection');
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
      await page.getByRole('button', { name: 'Stage configuration', exact: true }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Check the highlighted draft fields' })
      ).toBeVisible();
    }
  } finally {
    await context.close().catch(() => {});
  }
});

test('independent password recovery, one-time secret and rotation work across browsers', async ({
  browser,
  browserName,
}) => {
  test.skip(
    !process.env.SSO_E2E_BASE_URL || process.env.SSO_E2E_PASSWORD_RECOVERY !== '1',
    'Requires disposable password-recovery fixture.'
  );
  test.setTimeout(90000);
  const origin = process.env.SSO_E2E_BASE_URL!;
  const normal = await browser.newContext({ ignoreHTTPSErrors: true });
  const recovery = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await normal.newPage();
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill(process.env.SSO_E2E_ADMIN_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill(process.env.SSO_E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/login'), {
      waitUntil: 'domcontentloaded',
    });
    await page.goto(`${origin}/settings/system/emergency`);
    const name = `Password browser ${browserName} ${Date.now()}`;
    // The empty state shows the action twice (header and call-to-action); either opens the dialog.
    await page
      .getByRole('button', { name: 'Create emergency identity', exact: true })
      .first()
      .click();
    await page.getByRole('textbox', { name: 'Emergency identity name', exact: true }).fill(name);
    await page
      .getByRole('combobox', { name: 'Recovery method', exact: true })
      .selectOption('PASSWORD');
    await page
      .getByRole('checkbox', { name: /custody independent of the other emergency identity/ })
      .check();
    const createdResponse = page.waitForResponse(
      response =>
        response.url().endsWith('/api/auth/control') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Create identity', exact: true }).click();
    const created = (await (await createdResponse).json()).data as { id: string; password: string };
    expect(created.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(page.getByText(created.password, { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: /I stored this password/ }).check();
    await page.getByRole('button', { name: 'Acknowledge and close' }).click();
    await expect(page.getByText(created.password, { exact: true })).toHaveCount(0);
    const identity = page
      .locator('li:visible')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first();
    await expect(identity).toContainText('Needs a drill');
    const rp = await recovery.newPage();
    await rp.goto(`${origin}/login/emergency`);
    await rp
      .getByRole('combobox', { name: 'Recovery method', exact: true })
      .selectOption('PASSWORD');
    await rp.getByLabel('Emergency account identifier').fill(created.id);
    await rp.getByLabel('Recovery password', { exact: true }).fill(created.password);
    const signedIn = rp.waitForResponse(
      response =>
        response.url().endsWith('/api/auth/emergency') && response.request().method() === 'POST'
    );
    await rp.getByRole('button', { name: 'Sign in to recovery', exact: true }).click();
    const loginExpiresAt = (await (await signedIn).headerValue('set-cookie'))?.match(
      /expires=([^;]+)/i
    )?.[1];
    expect(loginExpiresAt).toBeTruthy();
    await rp.waitForURL(`${origin}/recovery`, { waitUntil: 'domcontentloaded' });
    const cookie = (await recovery.cookies()).find(value =>
      value.name.endsWith('opsknight-emergency')
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    const fixtureContainer = process.env.SSO_E2E_POSTGRES_CONTAINER;
    if (fixtureContainer && browserName === 'chromium') {
      if (!/^opsknight-sso-browser-cert-[a-f0-9]{8}$/.test(fixtureContainer))
        throw new Error('Only the owned disposable browser database can be restarted');
      await promisify(execFile)('docker', ['restart', fixtureContainer]);
    }
    const nativeData = process.env.SSO_E2E_PG_DATA;
    if (nativeData && browserName === 'chromium') {
      if (
        !/opsknight-auth-browser-[^/]+\/data$/.test(nativeData) ||
        !process.env.SSO_E2E_PG_CTL?.endsWith('/pg_ctl')
      )
        throw new Error('Only the owned native browser fixture can be restarted');
      await promisify(execFile)(process.env.SSO_E2E_PG_CTL, [
        '-D',
        nativeData,
        '-l',
        resolve(nativeData, '../postgres.log'),
        '-w',
        'restart',
      ]);
    }
    await expect
      .poll(async () => (await recovery.request.get(`${origin}/api/auth/control`)).status(), {
        timeout: 30000,
      })
      .toBe(200);
    await rp.getByRole('tab', { name: 'Emergency Recovery', exact: true }).click();
    await rp.getByLabel('Recovery password for fresh verification').fill(created.password);
    const reauthenticated = rp.waitForResponse(
      response =>
        response.url().endsWith('/api/auth/emergency') && response.request().method() === 'POST'
    );
    await rp.getByRole('button', { name: 'Verify recovery password again' }).click();
    expect((await reauthenticated).status()).toBe(200);
    expect(
      (await (await reauthenticated).headerValue('set-cookie'))?.match(/expires=([^;]+)/i)?.[1]
    ).toBe(loginExpiresAt);
    const freshCookie = (await recovery.cookies()).find(value =>
      value.name.endsWith('opsknight-emergency')
    );
    expect(freshCookie?.value).not.toBe(cookie?.value);
    // Browsers adjust whole-second Expires using each response's Date header.
    expect(Math.abs(freshCookie!.expires - cookie!.expires)).toBeLessThanOrEqual(1);
    expect((await recovery.request.get(`${origin}/api/auth/control`)).status()).toBe(200);
    expect([401, 403]).toContain((await recovery.request.get(`${origin}/api/incidents`)).status());
    await page.reload();
    await expect(identity).toContainText('Verified');
    await identity.getByRole('button', { name: /Manage/ }).click();
    await page.getByRole('button', { name: 'Rotate password', exact: true }).click();
    await page.getByRole('checkbox', { name: /I understand the session revocation/ }).check();
    const rotatedResponse = page.waitForResponse(
      response =>
        response.url().endsWith('/api/auth/control') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Confirm recovery change' }).click();
    const rotated = (await (await rotatedResponse).json()).data as { id: string; password: string };
    expect(rotated.password).not.toBe(created.password);
    expect((await recovery.request.get(`${origin}/api/auth/control`)).status()).toBe(403);
    await page.getByRole('checkbox', { name: /I stored this password/ }).check();
    await page.getByRole('button', { name: 'Acknowledge and close' }).click();
    await expect(identity).toContainText('Needs a drill');
    await page.setViewportSize({ width: 390, height: 1000 });
    const closeNavigation = page.getByRole('button', {
      name: 'Close navigation menu',
      exact: true,
    });
    if (await closeNavigation.isVisible()) await closeNavigation.click();
    await page.waitForFunction(
      () =>
        (document.querySelector('.sidebar-mobile')?.getBoundingClientRect().right ?? Infinity) <= 1
    );
    await identity.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    if (process.env.SSO_E2E_DIAGNOSTICS_CAPTURE_DIR)
      await page.screenshot({
        path: `${process.env.SSO_E2E_DIAGNOSTICS_CAPTURE_DIR}/password-recovery-${browserName}-390.png`,
        fullPage: false,
      });
    await normal.request.post(`${origin}/api/auth/control`, {
      headers: { Origin: origin },
      data: { action: 'disableEmergency', accountId: created.id },
    });
  } finally {
    await recovery.close();
    await normal.close();
  }
});

test('revokes another user session and then signs out cleanly after self revocation', async ({
  browser,
}) => {
  test.skip(!process.env.SSO_E2E_BASE_URL, 'Requires disposable authentication fixture.');
  test.setTimeout(120000);
  const origin = process.env.SSO_E2E_BASE_URL!;
  const admin = await browser.newContext();
  const other = await browser.newContext();
  try {
    const page = await admin.newPage();
    const otherPage = await other.newPage();
    for (const [target, email] of [
      [otherPage, 'browser-secondary@example.test'],
      [page, process.env.SSO_E2E_ADMIN_EMAIL!],
    ] as const) {
      await target.goto(`${origin}/login`);
      await target.getByLabel('Email', { exact: true }).fill(email);
      await target
        .getByLabel('Password', { exact: true })
        .fill(process.env.SSO_E2E_ADMIN_PASSWORD!);
      await target.getByRole('button', { name: 'Sign in', exact: true }).click();
      await target.waitForURL(url => !url.pathname.startsWith('/login'));
    }
    await page.goto(`${origin}/settings/system?section=sso&authTab=diagnostics&authView=sessions`);
    const search = page.getByRole('searchbox', {
      name: /Search name, email or session record prefix/,
    });
    await search.fill('browser-secondary@example.test');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.getByRole('button', { name: 'View Browser Secondary', exact: true }).first().click();
    await page
      .getByRole('checkbox', { name: /registered session will lose access immediately/ })
      .check();
    await page.getByRole('button', { name: 'Confirm session revocation', exact: true }).click();
    await expect(page.getByText('Session revoked successfully.', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
    const invalidated = await other.request.get(`${origin}/api/auth/session`);
    expect((await invalidated.json())?.user?.id).toBeFalsy();
    await search.fill(process.env.SSO_E2E_ADMIN_EMAIL!);
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.getByRole('button', { name: 'View Browser Certifier', exact: true }).first().click();
    await page
      .getByRole('checkbox', { name: /registered session will lose access immediately/ })
      .check();
    const protectedReads: string[] = [];
    page.on('request', request => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname.startsWith('/api/auth/control')
      )
        protectedReads.push(request.url());
    });
    await page.getByRole('button', { name: 'Confirm session revocation', exact: true }).click();
    await page.waitForURL(
      url => url.pathname === '/login' && url.searchParams.get('sessionRevoked') === '1'
    );
    await expect(
      page.getByText('Your session was revoked successfully. Sign in again to continue.', {
        exact: true,
      })
    ).toBeVisible();
    expect(protectedReads).toHaveLength(0);
  } finally {
    await Promise.allSettled([admin.close(), other.close()]);
  }
});
