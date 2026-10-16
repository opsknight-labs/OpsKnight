import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
let EMAIL = '';

const PASSWORD = 'Runbook-ui-test-harbor-472!';
let runbookId = '';
let serviceId = '';
let incidentId = '';
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => {
  EMAIL = `runbook-ui-${crypto.randomUUID()}@example.invalid`;
  await prisma.user.upsert({
    where: { email: EMAIL },
    update: { role: 'ADMIN', status: 'ACTIVE', passwordHash: await bcrypt.hash(PASSWORD, 12) },
    create: {
      email: EMAIL,
      name: 'Runbook UI Fixture',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    },
  });
  page.on('dialog', dialog => dialog.accept());
  // Incident alerts from earlier matrix fixtures can cover top-right controls.
  await page.addLocatorHandler(
    page.getByRole('button', { name: /^Dismiss (all incident alerts|incident alert)$/ }).first(),
    async button => {
      // Ambient alerts from other fixtures can sit behind a modal. Dismiss this
      // unrelated overlay without waiting for a pointer blocked by the dialog.
      await button.evaluate(element => (element as HTMLButtonElement).click());
    }
  );
});
test.beforeAll(async () => {
  if (
    !['/runbook_ui_test', '/rbe_engine_test'].includes(new URL(process.env.DATABASE_URL!).pathname)
  )
    throw new Error('Dedicated test database required');
  const service = await prisma.service.upsert({
    where: { name: 'Runbook UI Fixture Service' },
    update: {},
    create: { name: 'Runbook UI Fixture Service' },
  });
  serviceId = service.id;
  const incident = await prisma.incident.create({
    data: { title: 'Runbook UI Fixture Incident', serviceId },
  });
  incidentId = incident.id;
});
test.afterAll(async () => prisma.$disconnect());
async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/runbooks');
  await expect(page.getByRole('heading', { name: 'Runbooks', exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  ).toBe(true);
}
test('global history stays synchronized across application pages and authentication redirects', async ({
  page,
  context,
}) => {
  await login(page);
  const destinations = [
    { path: '/incidents', title: 'Incidents' },
    { path: '/services', title: 'Services' },
    { path: '/settings', title: 'Settings' },
    { path: '/reports', title: 'Reports & Dashboards' },
  ];
  const sidebar = page.locator('#app-sidebar');
  async function assertDestination(destination: (typeof destinations)[number]) {
    await expect(page).toHaveURL(new URL(destination.path, page.url()).href);
    await expect(
      page.getByRole('heading', { level: 1, name: destination.title, exact: true })
    ).toBeVisible();
    await expect(page.getByRole('alertdialog')).not.toBeVisible();
  }
  // Real Next links exercise the global tracker without a dirty runbook guard.
  for (const destination of destinations) {
    await sidebar.locator(`a[href="${destination.path}"]`).click();
    await assertDestination(destination);
  }
  for (const destination of destinations.slice(0, -1).reverse()) {
    await page.goBack();
    await assertDestination(destination);
  }
  for (const destination of destinations.slice(1)) {
    await page.goForward();
    await assertDestination(destination);
  }
  // Expired authentication must redirect a historical protected page as well
  // as a fresh request, rather than leave stale authenticated UI on screen.
  await context.clearCookies();
  await page.goBack();
  await page.reload();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(sidebar).not.toBeVisible();
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
  await sidebar.locator('a[href="/incidents"]').click();
  await assertDestination(destinations[0]);
  await sidebar.locator('a[href="/services"]').click();
  await assertDestination(destinations[1]);
  await page.goBack();
  await assertDestination(destinations[0]);
  await page.goForward();
  await assertDestination(destinations[1]);
});
test('library, ordered builder, typed inputs and publish confirmation', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'New Runbook', exact: true }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('UI Service Recovery');
  await page.getByLabel('Slug', { exact: true }).fill(`ui-service-recovery-${Date.now()}`);
  await page.getByRole('combobox', { name: 'Runbook template' }).click();
  await page
    .getByRole('option', { name: 'Service recovery · approval before restart', exact: true })
    .click();
  await page.getByRole('button', { name: 'Create Runbook', exact: true }).click();
  await expect(page).toHaveURL(/\/runbooks\/[a-z0-9]+/);
  runbookId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('list', { name: 'Runbook steps' })).toBeVisible();
  await expect(page.getByLabel('Definition JSON')).not.toBeVisible();
  await page.getByLabel('Step name', { exact: true }).fill('Capture baseline diagnostics');
  await expect(
    page
      .getByRole('list', { name: 'Runbook steps' })
      .getByRole('heading', { name: 'Capture baseline diagnostics' })
  ).toBeVisible();
  await page.getByLabel('Step key', { exact: true }).fill('baseline_check');
  const before = page.locator('section[data-testid="action-precheck-checks"]');
  await before.getByRole('button', { name: 'Add precheck', exact: true }).click();
  await before.locator('summary').first().click();
  await before.getByLabel('Step name', { exact: true }).fill('Check service exists');
  await before.getByLabel('Service unit or input reference').fill('payments.service');
  const after = page.locator('section[data-testid="action-verification-checks"]');
  await after.getByRole('button', { name: 'Add verification', exact: true }).click();
  await after.locator('summary').first().click();
  await after.getByLabel('Step name', { exact: true }).fill('Verify service recovered');
  await page
    .getByRole('button', { name: 'Move Capture baseline diagnostics down', exact: true })
    .click();
  await expect(
    page.getByRole('list', { name: 'Runbook steps' }).getByRole('heading').nth(1)
  ).toHaveText('Capture baseline diagnostics');
  await page
    .getByRole('button', { name: 'Move Capture baseline diagnostics up', exact: true })
    .click();
  await page.getByRole('tab', { name: /^Advanced/ }).click();
  await page.getByRole('button', { name: 'Refresh JSON from builder' }).click();
  const json = page.getByLabel('Definition JSON', { exact: true });
  const nested = JSON.parse(await json.inputValue());
  expect(nested.steps[0].precheck.steps[0].name).toBe('Check service exists');
  expect(nested.steps[0].verification.steps[0].name).toBe('Verify service recovered');
  await json.fill(`${await json.inputValue()}\n`);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Advanced JSON has unapplied changes' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Builder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /^Advanced/ }).click();
  await page.getByRole('button', { name: 'Apply JSON to builder' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Replace the visual draft');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await page
    .locator('[role="tabpanel"]:visible')
    .getByLabel('Input 1 key', { exact: true })
    .fill('service');
  await page
    .locator('[role="tabpanel"]:visible')
    .getByLabel('Input 1 label', { exact: true })
    .fill('Service unit');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Draft saved' })
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  await expect(
    page.locator('[role="tabpanel"]:visible').getByLabel('Input 1 key', { exact: true })
  ).toHaveValue('service');
  await page.getByRole('button', { name: 'Publish draft', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Only the saved draft is published');
  await page.getByRole('button', { name: 'Keep unchanged', exact: true }).click();
  await page.getByRole('tab', { name: 'Builder', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Runbook steps' })).toBeVisible();
  await expect(page.locator('input[aria-label="Step name"]:visible').first()).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/runbooks-builder-desktop.png', fullPage: true });
});

test('Agent enrollment, pool membership, scoped secret grants and rotation', async ({ page }) => {
  await login(page);
  await page.goto('/runbooks/agents');
  const suffix = Date.now();
  const agentName = `UI Agent ${suffix}`;
  const poolName = `UI Pool ${suffix}`;
  const secretName = `ui-secret-${suffix}`;
  await page.getByRole('button', { name: 'Enroll agent', exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(agentName);
  await page.getByLabel('Hostname hint (optional)').fill('ui-fixture.invalid');
  await page.getByRole('button', { name: 'Create enrollment', exact: true }).click();
  await expect(page.getByText('Copy this one-time token now', { exact: true })).toBeVisible();
  const agent = await prisma.runbookAgent.findFirstOrThrow({ where: { name: agentName } });
  expect(agent.enrollmentTokenHash).toBeTruthy();
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Infrastructure sections' })
    .getByRole('link', { name: /^pools/i })
    .click();
  await page.getByRole('button', { name: 'Create pool', exact: true }).click();
  await page.getByLabel('Pool name', { exact: true }).fill(poolName);
  await page.getByRole('dialog').getByRole('button', { name: 'Create pool', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookAgentPool.count({ where: { name: poolName } }))
    .toBe(1);
  await page.keyboard.press('Escape');
  const poolCard = page.locator('.bg-card').filter({ visible: true }).filter({ hasText: poolName });
  await poolCard.getByRole('link', { name: 'Manage pool' }).click();
  await page.waitForURL(/\/runbooks\/agents\/pools\?.*pool=/);
  await page.getByRole('combobox', { name: 'Agent to add' }).click();
  await page.getByPlaceholder('Search agent to add…').fill(agentName);
  await page.getByRole('option', { name: agentName, exact: true }).click();
  await page.getByRole('button', { name: 'Add Agent', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookAgentPoolMember.count({ where: { agentId: agent.id } }))
    .toBe(1);
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Infrastructure sections' })
    .getByRole('link', { name: /^secrets/i })
    .click();
  await page.getByRole('button', { name: 'Create secret', exact: true }).click();
  await page.getByLabel('Secret name', { exact: true }).fill(secretName);
  await page.getByLabel('Secret value', { exact: true }).fill('ui-credential-initial');
  await page.getByRole('combobox', { name: 'Initial secret grant' }).click();
  await page.getByPlaceholder('Search initial secret grant…').fill(agentName);
  await page.getByRole('option', { name: `Agent · ${agentName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Create encrypted secret', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookSecret.count({ where: { name: secretName } }))
    .toBe(1);
  const secret = await prisma.runbookSecret.findUniqueOrThrow({ where: { name: secretName } });
  expect(secret.valueEncrypted).not.toContain('ui-credential-initial');
  await page.keyboard.press('Escape');
  const secretRow = page.getByRole('row').filter({ hasText: secretName });
  await expect(secretRow.getByLabel('Secret value hidden')).toBeVisible();
  await secretRow.getByRole('link', { name: 'Manage grants / Rotate' }).click();
  await page.waitForURL(/\/runbooks\/agents\/secrets\?.*secret=/);
  await page.getByRole('combobox', { name: 'Grant to target' }).click();
  await page.getByPlaceholder('Search grant to target…').fill(poolName);
  await page.getByRole('option', { name: `Pool · ${poolName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Grant access', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookSecretGrant.count({ where: { secretId: secret.id } }))
    .toBe(2);
  await page.getByLabel('New secret value', { exact: true }).fill('ui-credential-rotated');
  await page.getByRole('checkbox', { name: /previous value cannot be restored/ }).check();
  await page.getByRole('button', { name: 'Rotate secret', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await prisma.runbookSecret.findUniqueOrThrow({ where: { id: secret.id } })).valueEncrypted
    )
    .not.toBe(secret.valueEncrypted);
  await page.keyboard.press('Escape');
  await expect(page.getByText('ui-credential-rotated', { exact: true })).not.toBeVisible();
  await expect(secretRow.getByLabel('Secret value hidden')).toBeVisible();
  // Stay in the client router: a hard navigation can abort the rotation action's pending RSC refresh in Firefox.
  await page
    .getByRole('navigation', { name: 'Infrastructure sections' })
    .getByRole('link', { name: /^agents/i })
    .click();
  await page.getByRole('button', { name: 'Enroll agent', exact: true }).click();
  const cancelledName = `UI cancelled enrollment ${Date.now()}`;
  await page.getByLabel('Agent name', { exact: true }).fill(cancelledName);
  await page.getByRole('button', { name: 'Create enrollment', exact: true }).click();
  await expect(page.getByText('Copy this one-time token now', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel this enrollment', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel this enrollment', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Enrollment revoked.' })).toBeVisible();
  await expect(page.getByText('Copy this one-time token now', { exact: true })).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await prisma.runbookAgent.findFirstOrThrow({ where: { name: cancelledName } })).status
    )
    .toBe('REVOKED');
});

test('publish, attach, target, trigger, incident suggestion, exact approval and cancellation', async ({
  page,
}) => {
  await login(page);
  const agent = await prisma.runbookAgent.create({
    data: {
      name: `UI Response Agent ${Date.now()}`,
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      capabilities: ['SYSTEMD'],
    },
  });
  const journeyService = await prisma.service.create({
    data: { name: `UI Journey Service ${Date.now()}` },
  });
  const serviceId = journeyService.id;
  await page.getByRole('button', { name: 'New Runbook', exact: true }).first().click();
  const name = `UI Operational Journey ${Date.now()}`;
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create Runbook', exact: true }).click();
  await expect(page).toHaveURL(/\/runbooks\/[a-z0-9]+/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('tab', { name: /^Advanced/ }).click();
  await page.getByLabel('Definition JSON', { exact: true }).fill(
    JSON.stringify({
      steps: [
        {
          key: 'restart',
          name: 'Restart UI service',
          type: 'SYSTEMD',
          riskClass: 'NON_IDEMPOTENT',
          requiresApproval: true,
          config: { action: 'restart', unit: 'ui-fixture.service' },
        },
      ],
    })
  );
  await page.getByRole('button', { name: 'Apply JSON to builder' }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Draft saved' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish draft', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Publish draft', exact: true })
    .click();
  await expect
    .poll(
      async () => (await prisma.runbook.findUniqueOrThrow({ where: { id } })).publishedVersionId
    )
    .not.toBeNull();
  await expect(page.getByText('Published v1', { exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create next editable draft', exact: true })
  ).toBeVisible();
  await page.goto(`/services/${serviceId}`);
  await page.getByRole('tab', { name: /^Runbooks/ }).click();
  await page.getByRole('textbox', { name: 'Workflow search', exact: true }).fill(name);
  await page.getByLabel('Agent / pool search', { exact: true }).fill(agent.name);
  await Promise.all([
    page.waitForURL(url => url.searchParams.get('ruleCatalog') === name),
    page.getByRole('button', { name: 'Search options', exact: true }).click(),
  ]);
  await page.getByRole('button', { name: 'Create rule', exact: true }).click();
  await page.getByRole('combobox', { name: 'Choose workflow' }).click();
  await page.getByRole('option', { name: `${name} (v1)` }).click();
  await page.getByRole('combobox', { name: 'Execution mode' }).click();
  await page.getByRole('option', { name: /^Suggested/ }).click();
  await page.getByRole('combobox', { name: 'Initial rule status' }).click();
  await page
    .getByRole('option', { name: 'Enable Manual/Suggested · Automatic saves paused', exact: true })
    .click();
  await page.getByRole('button', { name: 'Continue to target and inputs', exact: true }).click();
  await page.getByRole('combobox', { name: 'Execution target' }).click();
  await page.getByRole('option', { name: agent.name }).click();
  await page.getByRole('button', { name: 'Continue to trigger', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to review and save', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: `Attach ${name}`, exact: true })
    .click();
  await expect
    .poll(async () => prisma.serviceAutomationRule.count({ where: { serviceId, runbookId: id } }))
    .toBe(1);
  await page.keyboard.press('Escape');
  await page
    .locator('.bg-card')
    .filter({ visible: true })
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .getByText('Manage rule', { exact: true })
    .click();
  await page
    .locator('.bg-card')
    .filter({ visible: true })
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .getByRole('button', { name: 'Configure', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Trigger condition field' }).click();
  await page.getByRole('option', { name: 'Incident urgency', exact: true }).click();
  await page.locator('input[name="conditionValue"]').fill('HIGH');
  const triggerForm = page
    .getByRole('dialog')
    .locator('form')
    .filter({
      has: page.getByRole('button', { name: 'Save trigger', exact: true }),
    });
  const triggerRevision = Number(
    await triggerForm.locator('[name="expectedConfigurationRevision"]').inputValue()
  );
  await page.getByRole('button', { name: 'Save trigger', exact: true }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Changes saved' })
  ).toBeVisible();
  const binding = await prisma.serviceAutomationRule.findFirstOrThrow({
    where: { serviceId, runbookId: id },
  });
  await expect
    .poll(async () => prisma.runbookTrigger.count({ where: { bindingId: binding.id } }))
    .toBe(1);
  // A refreshed revision proves the server tree was applied; feedback must survive it.
  await expect(triggerForm.locator('[name="expectedConfigurationRevision"]')).toHaveValue(
    String(triggerRevision + 1)
  );
  expect(
    (
      await prisma.runbookTrigger.findFirstOrThrow({
        where: { bindingId: binding.id },
        include: { conditions: true },
      })
    ).conditions
  ).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'HIGH' })]));
  const configurationForm = page
    .getByRole('dialog')
    .locator('form')
    .filter({
      has: page.getByRole('button', { name: 'Save binding', exact: true }),
    });
  await configurationForm.locator('[name="ruleName"]').fill('Browser verified rule');
  const configurationRevision = Number(
    await configurationForm.locator('[name="expectedConfigurationRevision"]').inputValue()
  );
  await configurationForm.getByRole('button', { name: 'Save binding', exact: true }).click();
  await expect(configurationForm.locator('[name="expectedConfigurationRevision"]')).toHaveValue(
    String(configurationRevision + 1)
  );
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Changes saved' }).first()
  ).toBeVisible();
  expect(
    (await prisma.serviceAutomationRule.findUniqueOrThrow({ where: { id: binding.id } })).name
  ).toBe('Browser verified rule');
  await page.keyboard.press('Escape');
  const trigger = await prisma.runbookTrigger.findFirstOrThrow({
    where: { bindingId: binding.id },
  });
  const conditions = await prisma.runbookTriggerCondition.findMany({
    where: { triggerId: trigger.id },
  });
  expect(conditions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' }),
    ])
  );
  expect(binding.defaultAgentId).toBe(agent.id);
  const version = await prisma.runbookVersion.findUniqueOrThrow({
    where: { id: (await prisma.runbook.findUniqueOrThrow({ where: { id } })).publishedVersionId! },
  });
  // Seed the asynchronous event-worker boundary, not an executable host action.
  const incident = await prisma.incident.create({
    data: { title: 'UI Suggested Recovery', serviceId, urgency: 'HIGH' },
  });
  await prisma.runbookSuggestion.create({
    data: {
      incidentId: incident.id,
      bindingId: binding.id,
      runbookVersionId: version.id,
      triggerId: trigger.id,
      sourceEventId: `ui-event-${incident.id}`,
      fingerprint: `ui-suggestion-${incident.id}`,
      planSnapshot: {
        inputValues: {},
        agentId: agent.id,
        agentPoolId: null,
        definitionChecksum: version.checksum,
      },
    },
  });
  await page.goto(`/incidents/${incident.id}`);
  await page.getByRole('tab', { name: /^Runbooks/ }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await prisma.runbookAgent.update({
    where: { id: agent.id },
    data: { lastHeartbeatAt: new Date() },
  });
  await page.getByRole('button', { name: 'Preview execution', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Execution preview' })).toContainText(
    'Human approval required'
  );
  await page
    .getByLabel(
      'I reviewed the target and authorize the planned writes. Step approvals and Agent policy still apply.'
    )
    .check();
  await page.getByRole('button', { name: 'Execute this plan', exact: true }).click();
  await expect
    .poll(async () =>
      prisma.runbookExecution.count({ where: { incidentId: incident.id, runbookId: id } })
    )
    .toBe(1);
  const execution = await prisma.runbookExecution.findFirstOrThrow({
    where: { incidentId: incident.id, runbookId: id },
  });
  const step = await prisma.runbookExecutionStep.findFirstOrThrow({
    where: { executionId: execution.id },
  });
  // Stand in for the planner while keeping real approval/cancellation actions and fences.
  await prisma.runbookExecutionStep.update({
    where: { id: step.id },
    data: { status: 'WAITING_APPROVAL' },
  });
  await prisma.runbookExecution.update({
    where: { id: execution.id },
    data: { status: 'WAITING_APPROVAL' },
  });
  await page.reload();
  await page.getByRole('tab', { name: /^Runbooks/ }).click();
  await expect(page.getByText('ui-fixture.service', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve exact plan', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(agent.name);
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Approve exact plan', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await prisma.runbookExecutionStep.findUniqueOrThrow({ where: { id: step.id } }))
          .approvedPlanDigest
    )
    .not.toBeNull();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve exact plan', exact: true })
  ).not.toBeVisible();
  await expect(
    page.getByText('WAITING APPROVAL', { exact: true }).filter({ visible: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel execution', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel execution', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await prisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } }))
          .cancelRequestedAt
    )
    .not.toBeNull();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect(
    page
      .getByText(/^(CANCEL REQUESTED|CANCELLED)$/i)
      .filter({ visible: true })
      .first()
  ).toBeVisible();
});
test('independent rule wizard, paused duplicate and rule evidence stay truthful on desktop and mobile', async ({
  page,
}, testInfo) => {
  await login(page);
  const created = await prisma.runbook.create({
    data: {
      name: `UI Version Contract ${testInfo.project.name} ${Date.now()}`,
      slug: `ui-version-${crypto.randomUUID()}`,
    },
  });
  const oldVersion = await prisma.runbookVersion.create({
    data: {
      runbookId: created.id,
      version: 1,
      state: 'DRAFT',
      checksum: 'a'.repeat(64),
      definition: {
        steps: [
          {
            key: 'diagnose',
            name: 'Diagnose',
            type: 'LINUX_DIAGNOSTICS',
            riskClass: 'READ_ONLY',
            config: { action: 'summary' },
          },
        ],
      },
      inputs: {
        create: {
          key: 'legacy',
          label: 'Legacy input',
          type: 'STRING',
          required: true,
          description: '',
          sequence: 0,
        },
      },
    },
  });
  await prisma.runbookVersion.update({
    where: { id: oldVersion.id },
    data: { state: 'PUBLISHED' },
  });
  const currentVersion = await prisma.runbookVersion.create({
    data: {
      runbookId: created.id,
      version: 2,
      state: 'DRAFT',
      checksum: 'b'.repeat(64),
      definition: {
        steps: [
          {
            key: 'restart',
            name: 'Restart',
            type: 'SYSTEMD',
            riskClass: 'NON_IDEMPOTENT',
            requiresApproval: true,
            config: { action: 'restart', unit: 'test.service' },
          },
        ],
      },
      inputs: {
        create: {
          key: 'unit',
          label: 'Service unit',
          type: 'STRING',
          required: true,
          description: '',
          sequence: 0,
        },
      },
    },
  });
  await prisma.runbookVersion.update({
    where: { id: currentVersion.id },
    data: { state: 'PUBLISHED' },
  });
  const workflow = await prisma.runbook.update({
    where: { id: created.id },
    data: { publishedVersionId: currentVersion.id },
    include: { publishedVersion: true },
  });
  const ruleName = `UI independent rule ${testInfo.project.name} ${Date.now()}`;
  const countBefore = await prisma.serviceAutomationRule.count({
    where: { serviceId, runbookId: workflow.id },
  });
  await page.goto(`/services/${serviceId}?tab=runbooks`);
  await page.getByRole('tab', { name: /^Runbooks/ }).click();
  await page.getByRole('textbox', { name: 'Workflow search', exact: true }).fill(workflow.name);
  await Promise.all([
    page.waitForURL(url => url.searchParams.get('ruleCatalog') === workflow.name),
    page.getByRole('button', { name: 'Search options', exact: true }).click(),
  ]);
  await page.getByRole('button', { name: 'Create rule', exact: true }).click();
  await page.getByRole('combobox', { name: 'Choose workflow' }).click();
  await page
    .getByRole('option', {
      name: `${workflow.name} (v${workflow.publishedVersion!.version})`,
      exact: true,
    })
    .click();
  await page.getByRole('combobox', { name: 'Version strategy', exact: true }).click();
  await page.getByRole('option', { name: 'Pinned', exact: true }).click();
  await page.getByRole('combobox', { name: 'Pinned version', exact: true }).click();
  await page.getByRole('option', { name: 'v1 · PUBLISHED', exact: true }).click();
  await page.getByLabel('Rule name', { exact: true }).fill(ruleName);
  await page.getByRole('button', { name: 'Continue to target and inputs', exact: true }).click();
  await page.getByLabel('Legacy input', { exact: false }).fill('selected-old-schema');
  await expect(page.getByLabel('Service unit', { exact: false })).not.toBeVisible();
  await page.getByRole('button', { name: 'Continue to trigger', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to review and save', exact: true }).click();
  await page.getByRole('button', { name: `Attach ${workflow.name}`, exact: true }).click();
  await expect
    .poll(async () => prisma.serviceAutomationRule.count({ where: { serviceId, name: ruleName } }))
    .toBe(1);
  const rule = await prisma.serviceAutomationRule.findFirstOrThrow({
    where: { serviceId, name: ruleName },
  });
  expect(rule.enabled).toBe(false);
  expect(rule.runbookVersionId).toBe(oldVersion.id);
  expect(rule.inputValues).toEqual({ legacy: 'selected-old-schema' });
  await page.keyboard.press('Escape');
  // The action refreshes this service route. Wait for its visible result instead
  // of racing that pending refresh with a hard navigation (especially WebKit).
  const card = page
    .locator('.bg-card')
    .filter({ visible: true })
    .filter({ has: page.getByRole('link', { name: ruleName, exact: true }) });
  await expect(
    card.getByText('Rule paused · Target checks not run.', { exact: true })
  ).toBeVisible();
  await card.getByText('Manage rule', { exact: true }).click();
  await card.getByRole('button', { name: 'Duplicate paused rule', exact: true }).click();
  await expect
    .poll(async () =>
      prisma.serviceAutomationRule.count({ where: { serviceId, runbookId: workflow.id } })
    )
    .toBe(countBefore + 2);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const closeNavigation = page.getByRole('button', {
      name: 'Close navigation menu',
      exact: true,
    });
    if (width < 1024 && (await closeNavigation.isVisible())) await closeNavigation.click();
    await page
      .getByRole('heading', { name: /^Service [Aa]utomations$/i })
      .evaluate(element => element.scrollIntoView({ block: 'start' }));
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/service-rules-${testInfo.project.name}-${width}.png`,
      fullPage: true,
    });
    if (width === 375) {
      await card.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({
        path: `test-results/service-rule-card-${testInfo.project.name}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page.goto(`/services/${serviceId}/automations/${rule.id}`);
  await expect(page.getByRole('region', { name: 'What the evidence establishes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: ruleName, exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Validate configuration · No execution', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('This check does not activate the rule');
  await expect(page.getByRole('button', { name: 'Run now · Preview plan' })).not.toBeVisible();
  expect(
    (await prisma.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled
  ).toBe(false);
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/rule-evidence-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await prisma.runbookVersion.createMany({
    data: Array.from({ length: 105 }, (_, index) => ({
      runbookId: workflow.id,
      version: index + 3,
      state: 'RETIRED' as const,
      checksum: 'c'.repeat(64),
      definition: oldVersion.definition!,
    })),
  });
  const comparison = await page.goto(
    `/runbooks/${workflow.id}/compare?base=${oldVersion.id}&next=${currentVersion.id}`
  );
  expect(comparison?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: `${workflow.name} · Version comparison`, exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'v1 · PUBLISHED', exact: true }).first()
  ).toBeAttached();
  await page.getByRole('link', { name: 'Older versions', exact: true }).click();
  await expect(page.getByText('Version page 2', { exact: true })).toBeVisible();
});
test('390px infrastructure, health and builder have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await noOverflow(page);
  await page.getByRole('textbox', { name: 'Search runbooks' }).fill('UI Service');
  await expect(page.getByRole('heading', { name: 'UI Service Recovery' }).first()).toBeVisible();
  for (const route of [
    '/runbooks/agents',
    '/runbooks/health',
    '/runbooks/executions',
    `/runbooks/${runbookId}`,
    `/services/${serviceId}`,
    `/incidents/${incidentId}`,
  ]) {
    await page.goto(route);
    await noOverflow(page);
    if (route === `/runbooks/${runbookId}`) {
      await expect(page.getByRole('list', { name: 'Runbook steps' })).toBeVisible();
      await page
        .getByRole('list', { name: 'Runbook steps' })
        .getByRole('button', { name: /^Step 1:/ })
        .click();
      await expect(page.locator('input[aria-label="Step name"]:visible').first()).toBeVisible();
      await page.getByRole('button', { name: 'Back to steps' }).click();
      await page.screenshot({ path: 'test-results/runbooks-builder-mobile.png', fullPage: true });
      for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await noOverflow(page);
        await page.screenshot({
          path: `test-results/runbooks-builder-${width}.png`,
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
    if (route === '/runbooks/agents') {
      await page
        .getByRole('navigation', { name: 'Infrastructure sections' })
        .getByRole('link', { name: /^pools/i })
        .click();
      await page.waitForURL('**/runbooks/agents/pools');
      await noOverflow(page);
      await page
        .getByRole('navigation', { name: 'Infrastructure sections' })
        .getByRole('link', { name: /^secrets/i })
        .click();
      await page.waitForURL('**/runbooks/agents/secrets');
      await noOverflow(page);
      await page
        .getByRole('navigation', { name: 'Infrastructure sections' })
        .getByRole('link', { name: /^security/i })
        .click();
      await page.waitForURL('**/runbooks/agents/security');
      await noOverflow(page);
      await page.goto('/runbooks/agents?tab=pools');
      await page.waitForURL('**/runbooks/agents/pools');
    }
  }
  await page.screenshot({ path: 'test-results/runbooks-incident-mobile.png', fullPage: true });
});

test('large workflows retain keyboard navigation, theme layout and zoom-equivalent viewport', async ({
  page,
  browserName,
}) => {
  await login(page);
  await page.locator(`a[href="/runbooks/${runbookId}"]`).first().click();
  await expect(page.getByRole('list', { name: 'Runbook steps' })).toBeVisible();
  // Preserve a real forward entry before making the draft dirty.
  await page.evaluate(() => history.pushState(null, '', `${location.pathname}?history=forward`));
  await page.goBack();
  await expect(page).not.toHaveURL(/history=forward/);
  for (const count of [1, 10, 25, 50]) {
    await page.getByRole('tab', { name: /^Advanced/ }).click();
    await page.getByLabel('Definition JSON', { exact: true }).fill(
      JSON.stringify({
        steps: Array.from({ length: count }, (_, index) => ({
          key: `check_${index}`,
          name: `Inspect ${index + 1}: a long operational description that must remain readable`,
          type: 'WAIT',
          riskClass: 'READ_ONLY',
          config: { durationSeconds: 0 },
        })),
      })
    );
    await page.getByRole('button', { name: 'Apply JSON to builder' }).click();
    if (count > 1) {
      await expect(page.getByRole('alertdialog')).toContainText('Replace the visual draft');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
    }
    await page.getByRole('tab', { name: 'Builder', exact: true }).click();
    const steps = page.getByRole('list', { name: 'Runbook steps' });
    await expect(steps.getByRole('button', { name: /^Step \d+:/ })).toHaveCount(count);
    const last = steps.getByRole('button', { name: /^Step \d+:/ }).nth(count - 1);
    await last.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Step name', { exact: true })).toHaveValue(
      `Inspect ${count}: a long operational description that must remain readable`
    );
    await noOverflow(page);
  }
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(value => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/runbooks-50-steps-${theme}.png`, fullPage: true });
  }
  // A 1440px desktop at 200% browser zoom has a 720px CSS viewport.
  await page.setViewportSize({ width: 720, height: 450 });
  await noOverflow(page);
  await expect(page.getByRole('button', { name: 'Back to steps' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to steps' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Runbook steps' })).toBeVisible();
  const draftUrl = page.url();
  await page.evaluate(() => history.back());
  await expect(page.getByRole('alertdialog')).toContainText('Leave this draft');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(draftUrl);
  await expect(
    page.getByRole('list', { name: 'Runbook steps' }).getByRole('button', { name: /^Step \d+:/ })
  ).toHaveCount(50);
  await page.evaluate(() => history.forward());
  await expect(page.getByRole('alertdialog')).toContainText('Leave this draft');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(draftUrl);
  if (browserName === 'chromium') {
    // Native document exits are separate from App Router history transitions.
    page.removeAllListeners('dialog');
    const refreshPrompt = page.waitForEvent('dialog');
    const reload = page.evaluate(() => location.reload());
    const refreshDialog = await refreshPrompt;
    expect(refreshDialog.type()).toBe('beforeunload');
    await refreshDialog.dismiss();
    await reload;
    await expect(
      page.getByRole('list', { name: 'Runbook steps' }).getByRole('button', { name: /^Step \d+:/ })
    ).toHaveCount(50);
    const closePrompt = page.waitForEvent('dialog');
    const close = page.close({ runBeforeUnload: true });
    const closeDialog = await closePrompt;
    expect(closeDialog.type()).toBe('beforeunload');
    await closeDialog.dismiss();
    await close;
    expect(page.isClosed()).toBe(false);
    page.on('dialog', dialog => dialog.accept());
  }
  const library = page
    .getByRole('navigation', { name: 'Runbook navigation' })
    .getByRole('link', { name: 'Library', exact: true });
  await library.click();
  await expect(page.getByRole('alertdialog')).toContainText('Leave this draft');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep editing' }).click();
  await expect(
    page.getByRole('list', { name: 'Runbook steps' }).getByRole('button', { name: /^Step \d+:/ })
  ).toHaveCount(50);
  await library.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Runbooks', exact: true })).toBeVisible();
  // Confirm Forward and Back independently after returning to the saved builder.
  await page.goBack();
  await page.getByRole('button', { name: /^Step 1:/ }).click();
  await page
    .locator('input[aria-label="Step name"]:visible')
    .first()
    .fill('Unsaved forward change');
  await page.evaluate(() => history.forward());
  await expect(page.getByRole('alertdialog')).toContainText('Leave this draft');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Runbooks', exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: /^Step 1:/ }).click();
  await page.locator('input[aria-label="Step name"]:visible').first().fill('Unsaved back change');
  await page.evaluate(() => history.back());
  await expect(page.getByRole('alertdialog')).toContainText('Leave this draft');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Runbooks', exact: true })).toBeVisible();
});

test('server pagination, administrator labels, effective capabilities and budget settings', async ({
  page,
}) => {
  await login(page);
  const prefix = `Pagination fixture ${Date.now()}`;
  await prisma.runbook.createMany({
    data: Array.from({ length: 21 }, (_, index) => ({
      name: `${prefix} ${String(index).padStart(2, '0')}`,
      slug: `pagination-${Date.now()}-${index}`,
    })),
  });
  await page.getByRole('textbox', { name: 'Search runbooks' }).fill(prefix);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/q=Pagination/);
  await expect(page.getByRole('navigation', { name: 'Runbook pagination' })).toContainText(
    'Page 1 of 2 · 21 results'
  );
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Runbook pagination' })).toContainText(
    'Page 2 of 2 · 21 results'
  );
  await page.goto('/runbooks/executions?to=not-a-date');
  await expect(page.getByRole('heading', { name: 'Executions', exact: true })).toBeVisible();

  const agent = await prisma.runbookAgent.create({
    data: {
      name: `Capability fixture ${Date.now()}`,
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
      capabilityReport: [
        {
          name: 'Podman',
          type: 'DOCKER',
          configured: true,
          available: false,
          reason: 'Runtime access unavailable.',
        },
      ],
    },
  });
  await page.goto(`/runbooks/agents?q=${encodeURIComponent(agent.name)}`);
  await expect(
    page.getByText('Runtime access unavailable.', { exact: false }).filter({ visible: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Inspect Agent' }).first().click();
  await page.getByText('Scheduling labels', { exact: true }).filter({ visible: true }).click();
  await page
    .getByRole('textbox', { name: `Labels for ${agent.name}` })
    .fill('{"env":"prod","host":"node-a"}');
  await page.getByRole('button', { name: 'Save scheduling labels' }).click();
  await expect
    .poll(
      async () => (await prisma.runbookAgent.findUniqueOrThrow({ where: { id: agent.id } })).labels
    )
    .toEqual({ env: 'prod', host: 'node-a' });
  await page.keyboard.press('Escape');
  // Initialize signing through the real setup page; this case must also run in isolation.
  await page.goto(`/runbooks/agents/${agent.id}/setup`);
  await expect
    .poll(() => prisma.runbookExecutionSigningKey.count({ where: { state: 'ACTIVE' } }))
    .toBe(1);
  await page.goto(`/runbooks/agents?q=${encodeURIComponent(agent.name)}`);
  await page
    .getByRole('navigation', { name: 'Infrastructure sections' })
    .getByRole('link', { name: /^security/i })
    .click();
  await page.waitForURL('**/runbooks/agents/security');
  await expect(
    page.getByText('Automatic remediation budgets', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await page
    .getByRole('spinbutton', { name: 'Automatic executions per incident', exact: true })
    .fill('2');
  await page
    .getByRole('spinbutton', { name: 'Automatic writes per incident', exact: true })
    .fill('1');
  await page
    .getByRole('spinbutton', { name: 'Automatic non-idempotent actions per incident', exact: true })
    .fill('0');
  await page.getByRole('button', { name: 'Save remediation budgets' }).click();
  // Later browsers may already have these DB values; wait for the action's UI response too.
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Changes saved' })
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await prisma.systemSettings.findUniqueOrThrow({ where: { id: 'default' } }))
          .runbookAutoExecutionsPerIncident
    )
    .toBe(2);
  await expect(
    page.getByText('Pinned execution public key', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  const stageIdentity = page.getByRole('button', { name: 'Stage next signing identity' });
  if ((await prisma.runbookExecutionSigningKey.count({ where: { state: 'NEXT' } })) === 0) {
    await stageIdentity.click();
  } else {
    // The matrix shares global signing settings; an existing staged key is authoritative.
    await expect(stageIdentity).toBeDisabled();
  }
  await expect
    .poll(async () => prisma.runbookExecutionSigningKey.count({ where: { state: 'NEXT' } }))
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Activate acknowledged identity' })).toBeVisible();
  await page.getByRole('button', { name: 'Activate acknowledged identity' }).click();
  await expect(
    page
      .getByRole('main')
      .getByText(
        'Every enrolled Agent, including offline Agents, must acknowledge the NEXT trusted key.'
      )
      .filter({ visible: true })
  ).toBeVisible();
  expect(await prisma.runbookExecutionSigningKey.count({ where: { state: 'NEXT' } })).toBe(1);
});

test('service rule rendering stays bounded at 100, 1000 and 10000 rules', async ({
  page,
}, testInfo) => {
  test.setTimeout(240000);
  await login(page);
  const service = await prisma.service.create({
    data: { name: `UI Render Scale ${testInfo.project.name} ${Date.now()}` },
  });
  const workflow = await prisma.runbook.create({
    data: { name: `UI Render Workflow ${Date.now()}`, slug: crypto.randomUUID() },
  });
  const version = await prisma.runbookVersion.create({
    data: {
      runbookId: workflow.id,
      version: 1,
      state: 'PUBLISHED',
      checksum: 'd'.repeat(64),
      definition: {
        steps: [
          {
            key: 'diagnose',
            name: 'Diagnose',
            type: 'LINUX_DIAGNOSTICS',
            riskClass: 'READ_ONLY',
            config: { action: 'summary' },
          },
        ],
      },
    },
  });
  await prisma.runbook.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });
  const agent = await prisma.runbookAgent.create({
    data: {
      name: `UI Render Agent ${Date.now()}`,
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
    },
  });
  await prisma.runbookAgent.createMany({
    data: Array.from({ length: 999 }, (_, i) => ({
      name: `Render fleet ${testInfo.project.name} ${i}`,
      status: 'ONLINE' as const,
      lastHeartbeatAt: new Date(),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
    })),
  });
  const samples = [];
  let previous = 0;
  for (const size of [100, 1000, 10000]) {
    await prisma.serviceAutomationRule.createMany({
      data: Array.from({ length: size - previous }, (_, i) => ({
        name: `Render rule ${previous + i}`,
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: version.id,
        versionStrategy: 'PINNED' as const,
        defaultAgentId: agent.id,
      })),
    });
    previous = size;
    const latencies = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await page.goto(`/services/${service.id}?tab=runbooks`);
      await expect(page.getByRole('tab', { name: /^Runbooks/ })).toContainText(String(size));
      await expect(
        page.getByText('20 rules on this page', { exact: true }).filter({ visible: true })
      ).toBeVisible();
      expect(
        await page
          .getByRole('link', { name: /^Render rule / })
          .filter({ visible: true })
          .count()
      ).toBe(20);
      latencies.push(performance.now() - started);
    }
    samples.push({
      rules: size,
      fleetAgents: 1000,
      visibleRules: 20,
      navigationToVisibleMs: latencies,
      p95Ms: Math.max(...latencies),
    });
  }
  const names = await page
    .getByRole('link', { name: /^Render rule / })
    .filter({ visible: true })
    .allTextContents();
  await page.getByRole('link', { name: 'Next rules', exact: true }).click();
  await expect(page).toHaveURL(/rulesAfter=/);
  await expect(
    page.getByRole('link', { name: 'First rules', exact: true }).filter({ visible: true })
  ).toBeVisible();
  expect(
    (
      await page
        .getByRole('link', { name: /^Render rule / })
        .filter({ visible: true })
        .allTextContents()
    ).some(name => names.includes(name))
  ).toBe(false);
  await noOverflow(page);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir('test-results/runbook-engine', { recursive: true });
  await writeFile(
    `test-results/runbook-engine/rule-render-${testInfo.project.name}.json`,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        topology:
          'Local production server + PostgreSQL + browser; fixture Agents, no physical execution',
        browser: testInfo.project.name,
        samples,
      },
      null,
      2
    )
  );
});

test('service-scoped USER access never serializes the global Runbook library', async ({
  page,
  context,
}) => {
  const scoped = await prisma.user.create({
    data: {
      email: `runbook-scoped-${crypto.randomUUID()}@example.invalid`,
      name: 'Service scoped reader',
      role: 'USER',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    },
  });
  const team = await prisma.team.create({
    data: {
      name: `Scoped team ${crypto.randomUUID()}`,
      members: { create: { userId: scoped.id } },
    },
  });
  const service = await prisma.service.create({
    data: { name: `Scoped service ${crypto.randomUUID()}`, teamId: team.id },
  });
  const marker = `PRIVATE-RUNBOOK-COMMAND-${crypto.randomUUID()}`;
  const workflow = await prisma.runbook.create({
    data: { name: 'Private audit fixture', slug: crypto.randomUUID() },
  });
  const version = await prisma.runbookVersion.create({
    data: {
      runbookId: workflow.id,
      version: 1,
      state: 'PUBLISHED',
      checksum: 'a'.repeat(64),
      definition: {
        steps: [
          {
            key: 'private',
            name: marker,
            type: 'BASH',
            riskClass: 'READ_ONLY',
            config: { command: `echo ${marker}` },
          },
        ],
      },
    },
  });
  await prisma.runbook.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });
  await prisma.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: workflow.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      enabled: false,
    },
  });
  await context.clearCookies();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(scoped.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
  for (const tab of ['incidents', 'runbooks']) {
    const response = await context.request.get(`/services/${service.id}?tab=${tab}`);
    expect(response.status()).toBe(200);
    const payload = await response.text();
    expect(payload).not.toContain(marker);
    expect(payload).not.toContain(workflow.id);
    expect(payload).not.toContain(version.id);
  }
  const configuration = await context.request.get(
    `/api/runbooks/versions/${version.id}/configuration?runbookId=${workflow.id}`
  );
  expect(configuration.status()).toBe(403);
  expect(await configuration.text()).not.toContain(marker);
  await page.goto(`/services/${service.id}?tab=runbooks`);
  await expect(
    page
      .getByRole('tabpanel', { name: /^Runbooks/ })
      .getByText('Runbook access requires additional permission.', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create rule', exact: true })).not.toBeVisible();
});

test('editing an active Automatic rule warns, pauses it and leads to reactivation evidence', async ({
  page,
}) => {
  const service = await prisma.service.create({
    data: { name: `Automatic UX ${crypto.randomUUID()}` },
  });
  const workflow = await prisma.runbook.create({
    data: { name: 'Automatic UX workflow', slug: crypto.randomUUID() },
  });
  const version = await prisma.runbookVersion.create({
    data: {
      runbookId: workflow.id,
      version: 1,
      state: 'PUBLISHED',
      checksum: 'd'.repeat(64),
      definition: {
        steps: [
          {
            key: 'diagnose',
            name: 'Diagnose',
            type: 'LINUX_DIAGNOSTICS',
            riskClass: 'READ_ONLY',
            config: { diagnostic: 'summary' },
          },
        ],
      },
    },
  });
  await prisma.runbook.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });
  const agent = await prisma.runbookAgent.create({
    data: {
      name: `Automatic UX Agent ${crypto.randomUUID()}`,
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
    },
  });
  const rule = await prisma.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: workflow.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      mode: 'AUTOMATIC',
      defaultAgentId: agent.id,
      enabled: true,
      triggers: { create: { event: 'INCIDENT_CREATED', enabled: true } },
    },
  });
  await login(page);
  await page.goto(`/services/${service.id}`);
  await page.getByRole('tab', { name: /^Runbooks/ }).click();
  await page.getByText('Manage rule', { exact: true }).click();
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  await expect(
    page.getByText(
      'Saving configuration or trigger conditions pauses this Automatic rule immediately.',
      { exact: false }
    )
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add selector label', exact: true }).click();
  await page.getByLabel('Label 1 key', { exact: true }).fill('region');
  await page.getByLabel('Label 1 value', { exact: true }).fill('{{incident.labels.region}}');
  await expect(
    page.getByText('This target is unsupported in Automatic mode.', { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save and pause Automatic rule', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Remove label 1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save and pause Automatic rule', exact: true })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Save and pause Automatic rule', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await prisma.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled
    )
    .toBe(false);
  await page
    .getByRole('link', { name: 'Recheck policy and reactivate from Rule evidence' })
    .click();
  await expect(page).toHaveURL(
    `${new URL(page.url()).origin}/services/${service.id}/automations/${rule.id}`
  );
  await expect(page.getByRole('heading', { name: 'Activate Automatic rule' })).toBeVisible();
});

test('detached-rule suggestions stay visible with disabled execution and can be dismissed', async ({
  page,
}) => {
  const service = await prisma.service.create({
    data: { name: `Detached suggestion ${crypto.randomUUID()}` },
  });
  const workflow = await prisma.runbook.create({
    data: { name: 'Detached response evidence', slug: crypto.randomUUID() },
  });
  const version = await prisma.runbookVersion.create({
    data: {
      runbookId: workflow.id,
      version: 1,
      state: 'PUBLISHED',
      checksum: 'e'.repeat(64),
      definition: {
        steps: [
          {
            key: 'wait',
            name: 'Wait',
            type: 'WAIT',
            riskClass: 'READ_ONLY',
            config: { durationSeconds: 1 },
          },
        ],
      },
    },
  });
  const rule = await prisma.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: workflow.id,
      runbookVersionId: version.id,
      mode: 'SUGGESTED',
      versionStrategy: 'PINNED',
      enabled: false,
      detachedAt: new Date(),
      triggers: { create: { event: 'INCIDENT_CREATED', revision: 2 } },
    },
    include: { triggers: true },
  });
  const incident = await prisma.incident.create({
    data: { title: 'Detached suggestion evidence', serviceId: service.id },
  });
  const suggestion = await prisma.runbookSuggestion.create({
    data: {
      incidentId: incident.id,
      bindingId: rule.id,
      runbookVersionId: version.id,
      triggerId: rule.triggers[0].id,
      triggerRevision: 2,
      fingerprint: crypto.randomUUID(),
      sourceEventId: crypto.randomUUID(),
      planSnapshot: {
        inputValues: {},
        agentId: null,
        agentPoolId: null,
        definitionChecksum: version.checksum,
      },
    },
  });
  await login(page);
  await page.goto(`/incidents/${incident.id}`);
  await page.getByRole('tab', { name: /^Runbooks/ }).click();
  await expect(page.getByText('Detached response evidence', { exact: true })).toBeVisible();
  await expect(page.getByText('Rule detached', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview execution', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Execute this plan', exact: true })
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await prisma.runbookSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).state
    )
    .toBe('DISMISSED');
  expect(await prisma.runbookExecution.count({ where: { bindingId: rule.id } })).toBe(0);
  // Dismissal updates the database before its server-action refresh commits.
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).not.toBeVisible();
  // Inspect history in a second tab so the completed action's redirect cannot
  // interrupt an unrelated top-level navigation (notably in WebKit).
  const history = await page.context().newPage();
  await history.goto(`/services/${service.id}?tab=runbooks`);
  await expect(
    history.getByRole('link', { name: 'View archived rule evidence', exact: true })
  ).not.toBeVisible();
  await history
    .getByLabel('Rule history', { exact: true })
    .filter({ visible: true })
    .selectOption('archived');
  await history
    .getByLabel('Search rules', { exact: true })
    .filter({ visible: true })
    .fill('Detached response');
  await history.getByRole('button', { name: 'Search rule history', exact: true }).click();
  await expect(
    history.getByText('Rule detached · Archived history', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await expect(
    history.getByRole('button', { name: 'Duplicate paused rule', exact: true })
  ).not.toBeVisible();
  await history.getByRole('link', { name: 'View archived rule evidence', exact: true }).click();
  await expect(history.getByRole('list', { name: 'Rule lifecycle' })).toBeVisible();
  await expect(
    history.getByText('Detached; activation unavailable', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await history.close();
});
