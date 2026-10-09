import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const EMAIL = `runbook-ui-${Date.now()}@example.invalid`;
const PASSWORD = 'Runbook-ui-test-harbor-472!';
let runbookId = '';
let serviceId = '';
let incidentId = '';
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== '/runbook_ui_test')
    throw new Error('Dedicated test database required');
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
    page.getByRole('list', { name: 'Runbook steps' }).getByRole('heading', { name: 'Capture baseline diagnostics' })
  ).toBeVisible();
  await page.getByLabel('Step key', { exact: true }).fill('baseline_check');
  const before = page.locator('section[aria-label="Before action checks"]');
  await before.getByRole('button', { name: 'Add precheck', exact: true }).click();
  await before.locator('summary').first().click();
  await before.getByLabel('Step name', { exact: true }).fill('Check service exists');
  await before.getByLabel('Service unit or input reference').fill('payments.service');
  const after = page.locator('section[aria-label="After action checks"]');
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
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  await expect(
    page.locator('[role="tabpanel"]:visible').getByLabel('Input 1 key', { exact: true })
  ).toHaveValue('service');
  await page.getByRole('button', { name: 'Publish draft', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Only the saved draft is published');
  await page.getByRole('button', { name: 'Keep unchanged', exact: true }).click();
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
  await page.getByRole('button', { name: 'Add Agent', exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill(agentName);
  await page.getByLabel('Expected hostname').fill('ui-fixture.invalid');
  await page.getByRole('button', { name: 'Create enrollment', exact: true }).click();
  await expect(page.getByText('Copy this one-time token now', { exact: true })).toBeVisible();
  const agent = await prisma.runbookAgent.findFirstOrThrow({ where: { name: agentName } });
  expect(agent.enrollmentTokenHash).toBeTruthy();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Infrastructure sections' }).getByRole('link', { name: /^pools/i }).click();
  await page.getByRole('button', { name: 'Create pool', exact: true }).click();
  await page.getByLabel('Pool name', { exact: true }).fill(poolName);
  await page.getByRole('dialog').getByRole('button', { name: 'Create pool', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookAgentPool.count({ where: { name: poolName } }))
    .toBe(1);
  await page.keyboard.press('Escape');
  const poolCard = page.locator('.bg-card').filter({ hasText: poolName });
  await poolCard.getByRole('button', { name: 'Manage pool' }).click();
  await page.getByRole('combobox', { name: 'Agent to add' }).click();
  await page.getByRole('option', { name: agentName, exact: true }).click();
  await page.getByRole('button', { name: 'Add Agent', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookAgentPoolMember.count({ where: { agentId: agent.id } }))
    .toBe(1);
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Infrastructure sections' }).getByRole('link', { name: /^secrets/i }).click();
  await page.getByRole('button', { name: 'Create secret', exact: true }).click();
  await page.getByLabel('Secret name', { exact: true }).fill(secretName);
  await page.getByLabel('Secret value', { exact: true }).fill('ui-credential-initial');
  await page.getByRole('combobox', { name: 'Initial secret grant' }).click();
  await page.getByRole('option', { name: `Agent · ${agentName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Create encrypted secret', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookSecret.count({ where: { name: secretName } }))
    .toBe(1);
  const secret = await prisma.runbookSecret.findUniqueOrThrow({ where: { name: secretName } });
  expect(secret.valueEncrypted).not.toContain('ui-credential-initial');
  await page.keyboard.press('Escape');
  const secretCard = page.locator('.bg-card').filter({ hasText: secretName });
  await expect(secretCard.getByLabel('Secret value hidden')).toBeVisible();
  await secretCard.getByRole('button', { name: 'Manage grants / Rotate' }).click();
  await page.getByRole('combobox', { name: 'Grant to target' }).click();
  await page.getByRole('option', { name: `Pool · ${poolName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Grant access', exact: true }).click();
  await expect
    .poll(async () => prisma.runbookSecretGrant.count({ where: { secretId: secret.id } }))
    .toBe(2);
  await page.getByLabel('New secret value', { exact: true }).fill('ui-credential-rotated');
  await page.getByRole('button', { name: 'Rotate secret', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await prisma.runbookSecret.findUniqueOrThrow({ where: { id: secret.id } })).valueEncrypted
    )
    .not.toBe(secret.valueEncrypted);
  await page.keyboard.press('Escape');
  await expect(page.getByText('ui-credential-rotated', { exact: true })).not.toBeVisible();
  await expect(secretCard.getByLabel('Secret value hidden')).toBeVisible();
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
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();
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
  await page.goto(`/services/${serviceId}`);
  await page.getByRole('tab', { name: /^Runbooks/ }).click();
  await page.getByRole('button', { name: `Attach ${name}`, exact: true }).click();
  await page.getByRole('combobox', { name: 'Execution mode' }).click();
  await page.getByRole('option', { name: 'Suggested', exact: true }).click();
  await page.getByRole('combobox', { name: 'Execution target' }).click();
  await page.getByRole('option', { name: agent.name, exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: `Attach ${name}`, exact: true })
    .click();
  await expect
    .poll(async () => prisma.serviceRunbookBinding.count({ where: { serviceId, runbookId: id } }))
    .toBe(1);
  await page.keyboard.press('Escape');
  await page
    .locator('.bg-card')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .getByRole('button', { name: 'Configure', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Trigger condition field' }).click();
  await page.getByRole('option', { name: 'Incident urgency', exact: true }).click();
  await page.locator('input[name="conditionValue"]').fill('HIGH');
  await page.getByRole('button', { name: 'Save trigger', exact: true }).click();
  const binding = await prisma.serviceRunbookBinding.findFirstOrThrow({
    where: { serviceId, runbookId: id },
  });
  await expect
    .poll(async () => prisma.runbookTrigger.count({ where: { bindingId: binding.id } }))
    .toBe(1);
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
  await page.getByRole('button', { name: 'Start suggestion', exact: true }).click();
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
      await page.screenshot({ path: 'test-results/runbooks-builder-mobile.png', fullPage: true });
    }
    if (route === '/runbooks/agents') {
      await page.getByRole('navigation', { name: 'Infrastructure sections' }).getByRole('link', { name: /^pools/i }).click();
      await noOverflow(page);
      await page.getByRole('navigation', { name: 'Infrastructure sections' }).getByRole('link', { name: /^secrets/i }).click();
      await noOverflow(page);
    }
  }
  await page.screenshot({ path: 'test-results/runbooks-incident-mobile.png', fullPage: true });
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
  await page
    .getByRole('navigation', { name: 'Infrastructure sections' })
    .getByRole('link', { name: /^security/i })
    .click();
  await page
    .getByText('Automatic remediation budgets', { exact: true })
    .filter({ visible: true })
    .click();
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
  await expect
    .poll(
      async () =>
        (await prisma.systemSettings.findUniqueOrThrow({ where: { id: 'default' } }))
          .runbookAutoExecutionsPerIncident
    )
    .toBe(2);
  await page
    .getByText('Pinned execution public key', { exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: 'Stage next signing identity' }).click();
  await expect
    .poll(async () => prisma.runbookExecutionSigningKey.count({ where: { state: 'NEXT' } }))
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Activate acknowledged identity' })).toBeVisible();
  await page.getByRole('button', { name: 'Activate acknowledged identity' }).click();
  await expect(
    page
      .getByText(
        'Every enrolled Agent, including offline Agents, must acknowledge the NEXT trusted key.'
      )
      .filter({ visible: true })
  ).toBeVisible();
  expect(await prisma.runbookExecutionSigningKey.count({ where: { state: 'NEXT' } })).toBe(1);
});
