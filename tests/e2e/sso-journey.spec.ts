/**
 * The whole single sign-on journey, as an administrator and as the people signing in:
 * connect a provider, a failed test that explains itself, a passing test, activation, an
 * existing account waiting for approval, an unknown person, approval, and a successful sign-in.
 *
 * Needs a disposable, migrated instance served over HTTPS, started with
 * OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS=idp.example.test and NODE_EXTRA_CA_CERTS=<mock cert>, with:
 * - an active ADMIN admin@acme-sso.test (password in SSO_JOURNEY_ADMIN_PASSWORD), no SSO configured
 * - an ACTIVE user priya@acme-sso.test without a password
 * and the mock provider running on https://localhost:3443.
 *
 *   SSO_JOURNEY_BASE_URL=https://localhost:3111 SSO_JOURNEY_ALLOW_SELF_SIGNED=1 \
 *   SSO_JOURNEY_ADMIN_PASSWORD=... npx playwright test -c playwright.sso-journey.config.ts
 */
import { expect, test, type Page } from '@playwright/test';

const base = process.env.SSO_JOURNEY_BASE_URL ?? '';
const idpControl = process.env.SSO_JOURNEY_IDP_CONTROL ?? 'https://localhost:3443';
const adminEmail = process.env.SSO_JOURNEY_ADMIN_EMAIL ?? 'admin@acme-sso.test';
const adminPassword = process.env.SSO_JOURNEY_ADMIN_PASSWORD ?? '';

test.skip(!base || !adminPassword, 'Set SSO_JOURNEY_BASE_URL and SSO_JOURNEY_ADMIN_PASSWORD.');

async function nextSignInAs(page: Page, user: { sub: string; email: string; groups: string[] }) {
  const response = await page.request.get(
    `${idpControl}/as?user=${encodeURIComponent(JSON.stringify(user))}`
  );
  expect(response.ok()).toBe(true);
}

test('administrators set up SSO and people sign in with clear guidance', async ({
  page,
  browser,
}) => {
  await page.goto(`${base}/login`);
  await page.locator('#login-email:not([disabled])').fill(adminEmail);
  await page.locator('#login-password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));

  // 1. Connect provider: nothing is preselected; choose, fill, save.
  await page.goto(`${base}/settings/system?section=sso&authTab=connection`);
  await expect(page.getByText('Choose your provider above to continue.')).toBeVisible();
  await page.getByRole('radio', { name: /Custom OIDC/ }).click();
  await page.getByLabel('Issuer', { exact: true }).fill('https://idp.example.test:3443');
  await page.getByLabel('Client ID', { exact: true }).fill('opsknight-local');
  await page.getByLabel('Client secret', { exact: true }).fill('local-secret');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText(/Saved, and your provider responded correctly/).first()
  ).toBeVisible();

  // 3. Roles & teams: administrators come from a group.
  await page.getByRole('tab', { name: '3 · Roles & teams' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Group or role value · rule 1').fill('ops-admins');
  await page.getByLabel('Gives role · rule 1').selectOption('ADMIN');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText(/Saved, and your provider responded correctly/).first()
  ).toBeVisible();

  // 4. A test with the wrong account explains exactly what is wrong.
  await nextSignInAs(page, { sub: 'sub-wrong', email: 'someone@acme-sso.test', groups: [] });
  await page.getByRole('tab', { name: '4 · Test & activate' }).click();
  await page.getByLabel(/Allow this SSO identity to link/).check();
  await page.getByRole('button', { name: /Test my sign-in|Test sign-in again/ }).click();
  await expect(
    page.getByRole('heading', { name: /does not match your OpsKnight account/ })
  ).toBeVisible();
  await expect(page.getByText('s***@acme-sso.test').first()).toBeVisible();

  // The right account passes, and setup continues where it was.
  await nextSignInAs(page, { sub: 'sub-admin', email: adminEmail, groups: ['ops-admins'] });
  await page.getByRole('link', { name: 'Back to the test' }).click();
  await page.getByLabel(/Allow this SSO identity to link/).check();
  await page.getByRole('button', { name: /Test my sign-in|Test sign-in again/ }).click();
  await expect(page.getByRole('heading', { name: 'Administrator sign-in verified' })).toBeVisible();
  await expect(page.getByText(/role would be\s*ADMIN/)).toBeVisible();
  await page.getByRole('link', { name: /Continue to review and activate/ }).click();
  await expect(page.getByText('Next: Turn on SSO')).toBeVisible();

  // Turn on SSO Optional.
  await page.getByRole('button', { name: 'Preview what will change' }).click();
  await expect(page.getByText('What happens when you turn it on')).toBeVisible();
  await page.getByLabel(/I reviewed what will change/).check();
  await page.getByRole('button', { name: 'Turn on single sign-on' }).click();
  await expect(page.getByText(/Single sign-on is on/).first()).toBeVisible();

  // People signing in.
  const visitor = await (
    await browser.newContext({
      ignoreHTTPSErrors: process.env.SSO_JOURNEY_ALLOW_SELF_SIGNED === '1',
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 1000 },
    })
  ).newPage();
  const signInWithSso = async (who: { sub: string; email: string; groups: string[] }) => {
    await nextSignInAs(visitor, who);
    await visitor.goto(`${base}/login`);
    const button = visitor.getByRole('button', { name: /Continue with/ });
    await expect(button).toBeEnabled();
    // The sign-in leaves for the provider and comes back; wait for the final page, not the click.
    await Promise.all([
      visitor.waitForURL(
        url =>
          url.origin === new URL(base).origin &&
          !url.pathname.startsWith('/api/') &&
          (url.pathname !== '/login' || url.searchParams.has('error')),
        { timeout: 120000 }
      ),
      button.click({ noWaitAfter: true }),
    ]);
  };

  await signInWithSso({ sub: 'sub-priya', email: 'priya@acme-sso.test', groups: [] });
  await expect(
    visitor.getByText('Your administrator needs to approve your first SSO sign-in')
  ).toBeVisible();
  await expect(visitor.getByText(/have been notified/)).toBeVisible();

  await signInWithSso({ sub: 'sub-carol', email: 'carol@acme-sso.test', groups: [] });
  await expect(visitor.getByText('You do not have an OpsKnight account yet')).toBeVisible();

  // The administrator approves the request from the queue; the person gets in.
  await page.goto(`${base}/settings/system?section=sso&authTab=access`);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'priya@acme-sso.test' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(page.getByText(/can now sign in with SSO/).first()).toBeVisible();
  await signInWithSso({ sub: 'sub-priya', email: 'priya@acme-sso.test', groups: [] });
  await expect(visitor).not.toHaveURL(/\/login/);
});
