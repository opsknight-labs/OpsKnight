import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('SCIM administrator provisions, reviews bindings, rotates credentials and diagnoses activity', async ({
  page,
  request,
}, info) => {
  test.skip(!process.env.SCIM_E2E_BASE_URL, 'Requires an isolated SCIM fixture deployment.');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.SCIM_E2E_ADMIN_EMAIL!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.SCIM_E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));
  await page.goto('/settings/system?section=scim');
  const section = page.getByRole('region', { name: 'SCIM Provisioning', exact: true });
  await expect(section.getByRole('heading', { name: 'SCIM Provisioning' })).toBeVisible();
  await section.getByRole('button', { name: 'Connections', exact: true }).click();
  const name = `Browser SCIM ${info.project.name} ${Date.now()}`;
  await section.getByLabel('Connection name', { exact: true }).fill(name);
  await section.getByLabel('Provider', { exact: true }).selectOption('ENTRA');
  await section.getByLabel('Save as a new connection', { exact: true }).check();
  await section.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Connection saved.' })).toBeVisible();
  await section.getByRole('button', { name: 'Security', exact: true }).click();
  await section.getByLabel('Purpose', { exact: true }).fill('Browser verification');
  await section.getByRole('button', { name: 'Create replacement credential', exact: true }).click();
  const secretInput = section.getByLabel('One-time secret', { exact: true });
  await expect(secretInput).toBeVisible();
  const secret = await secretInput.inputValue();
  expect(secret.length).toBe(64);
  const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/scim+json' };
  const createdUser = await request.post('/api/scim/v2/Users', {
    headers,
    data: {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: `${Date.now()}-${info.project.name}@example.test`,
      externalId: `browser-user-${Date.now()}`,
      displayName: 'Browser directory user',
      active: true,
    },
  });
  expect(createdUser.status()).toBe(201);
  const user = await createdUser.json();
  const groupName = `Browser directory group ${Date.now()}`;
  const createdGroup = await request.post('/api/scim/v2/Groups', {
    headers,
    data: {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      displayName: groupName,
      externalId: `browser-group-${Date.now()}`,
      members: [{ value: user.id }],
    },
  });
  expect(createdGroup.status()).toBe(201);
  const group = await createdGroup.json();
  await section.getByRole('button', { name: 'Hide secret permanently', exact: true }).click();
  await expect(secretInput).toBeHidden();
  await section.getByRole('button', { name: 'Users & Groups', exact: true }).click();
  await section.getByLabel('Resource', { exact: true }).selectOption('groups');
  await section.getByLabel('Search', { exact: true }).fill(groupName);
  await expect(section.getByText(groupName, { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Review team binding', exact: true }).click();
  await section
    .getByLabel('Find an operational team', { exact: true })
    .fill('SCIM browser operational');
  const teamSelect = section.getByLabel('Operational team', { exact: true });
  await expect(teamSelect.locator('option')).toHaveCount(2);
  await teamSelect.selectOption({ label: 'SCIM browser operational' });
  await section.getByRole('button', { name: 'Preview binding', exact: true }).click();
  await expect(
    section.getByText(/1 members added; 0 existing memberships removed; 1 owners protected/)
  ).toBeVisible();
  await section.getByRole('button', { name: 'Approve this impact', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Binding approved' })).toBeVisible();
  await section.getByRole('button', { name: 'Activity', exact: true }).click();
  await section.getByLabel('Search', { exact: true }).fill('binding.approved');
  await expect(section.getByText('binding.approved', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await expect(
    section.getByRole('heading', { name: 'Troubleshooting', exact: true })
  ).toBeVisible();
  await section.getByRole('button', { name: 'Compare local memberships', exact: true }).click();
  await expect(section.getByText(/0 missing operational members/)).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const close = page.getByRole('button', { name: 'Close navigation menu', exact: true });
    if (await close.isVisible()) await close.click();
    await expect(section).toBeVisible();
    expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`scim-${width}.png`), fullPage: true });
  }
  const accessibility = await new AxeBuilder({ page })
    .include('section[aria-label="SCIM Provisioning"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  // Real HTTP DELETE retains the operational team, verified independently by the database suite.
  expect((await request.delete(`/api/scim/v2/Groups/${group.id}`, { headers })).status()).toBe(204);
  await section.getByRole('button', { name: 'Security', exact: true }).click();
  await section.getByRole('button', { name: 'Revoke credential', exact: true }).click();
  await expect(
    section.getByRole('status').filter({ hasText: 'Credential revoked immediately.' })
  ).toBeVisible();
  expect((await request.get('/api/scim/v2/Users', { headers })).status()).toBe(401);
});
