import { generateApiKey } from '@/lib/api-keys';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { automationLoadSnapshot } from '../load/fixtures/automation';
import { compileAutomation } from '@/lib/automation/compiler';
import { checksum } from '@/lib/automation/cache';
import { randomUUID } from 'node:crypto';
const db = new PrismaClient();
// Desktop browsers (Chromium, Firefox, WebKit) use desktop routes; device emulations use /m.
const isDesktop = (info: { project: { use: { isMobile?: boolean } } }) =>
  !info.project.use.isMobile;
let email: string;
const password = 'Automation-Local-Test-938!';
let serviceId: string;
test.beforeAll(async ({}, testInfo) => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
    throw new Error('Automation browser certification requires an isolated test database');
  email = `automation-e2e-${testInfo.project.name}-${Date.now()}@example.com`;
  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.upsert({
    where: { email },
    create: { email, name: 'Automation Admin', role: 'ADMIN', status: 'ACTIVE', passwordHash },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  const service = await db.service.create({ data: { name: `Automation UI ${Date.now()}` } });
  serviceId = service.id;
});
test.afterAll(async () => {
  await db.service.delete({ where: { id: serviceId } }).catch(() => {});
  await db.user.delete({ where: { email } }).catch(() => {});
  await db.$disconnect();
});

for (const notificationCase of ['SLACK', 'TEAMS', 'BOTH'] as const) {
  test(`supported ${notificationCase} ingestion displays pinned context and intentional paging suppression`, async ({
    page,
  }, testInfo) => {
    const csrf = await (await page.request.get('/api/auth/csrf')).json();
    await page.request.post('/api/auth/callback/credentials', {
      form: { csrfToken: csrf.csrfToken, email, password, json: 'true' },
    });
    const service = await db.service.create({ data: { name: `Context journey ${randomUUID()}` } });
    const integration = await db.integration.create({
      data: {
        serviceId: service.id,
        name: 'Context journey',
        key: randomUUID(),
        type: 'EVENTS_API_V2',
      },
    });
    const slack = await db.slackDestination.create({
      data: {
        serviceId: service.id,
        workspaceId: `browser-${randomUUID()}`,
        channelId: 'C_BROWSER_CERT',
        channelName: 'Browser certification',
        enabled: true,
      },
    });
    const teams = await db.microsoftTeamsDestination.create({
      data: {
        serviceId: service.id,
        tenantId: randomUUID(),
        teamId: randomUUID(),
        channelId: randomUUID(),
        channelName: 'Conditional Teams browser channel',
      },
    });
    const snapshot = {
      schemaVersion: 1 as const,
      fields: Array.from({ length: 7 }, (_, i) => ({
        fieldId: `context-${i}`,
        key: `context_${i}`,
        label: `Captured field ${i}`,
        type: 'STRING' as const,
        caseSensitive: false,
        aliases: {},
        mappings: [{ source: 'EVENT' as const, path: `payload.custom_details.context_${i}` }],
      })),
      rules: [
        {
          id: 'priority',
          name: 'Low impact',
          phase: 'ENRICH' as const,
          enabled: true,
          conditions: [],
          actions: [{ type: 'SET_PRIORITY' as const, value: 'P3' as const }],
        },
        {
          id: 'quiet',
          name: 'Skip personal paging',
          phase: 'ROUTE' as const,
          enabled: true,
          conditions: [{ fieldKey: 'priority', operator: 'EQ' as const, value: 'P3' }],
          actions: [
            { type: 'NO_ESCALATION' as const },
            ...(notificationCase === 'BOTH'
              ? [
                  {
                    type: 'NOTIFY_CHANNEL' as const,
                    provider: 'TEAMS' as const,
                    destinationId: teams.id,
                  },
                ]
              : []),
            {
              type: 'NOTIFY_CHANNEL' as const,
              provider: notificationCase === 'TEAMS' ? ('TEAMS' as const) : ('SLACK' as const),
              destinationId: notificationCase === 'TEAMS' ? teams.id : slack.id,
            },
          ],
        },
      ],
    };
    const { compiled, issues } = compileAutomation(snapshot);
    expect(issues.filter(issue => issue.level === 'ERROR')).toHaveLength(0);
    const version = await db.automationVersion.create({
      data: {
        serviceId: service.id,
        versionNumber: 1,
        snapshot,
        compiledSnapshot: compiled,
        checksum: checksum(compiled),
        lintReport: [],
        publishedBy: 'browser-fixture',
      },
    });
    await db.serviceAutomationConfig.create({
      data: { serviceId: service.id, activeVersionId: version.id, mode: 'LIVE' },
    });
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', automationEnabled: true },
      update: { automationEnabled: true },
    });
    const dedupKey = randomUUID();
    const ingestion = await page.request.post('/api/events', {
      headers: { Authorization: `Token token=${integration.key}` },
      data: {
        event_action: 'trigger',
        dedup_key: dedupKey,
        payload: {
          summary: 'Customer ABC123 captured context browser journey',
          source: 'browser-certification',
          severity: 'critical',
          custom_details: {
            context_0: 'PRODUCTION',
            context_1: '<script>alert(1)</script>',
            context_2: 'x'.repeat(1200),
            context_6: 'Historical evidence',
          },
        },
      },
    });
    expect(ingestion.status()).toBe(202);
    const accepted = (await ingestion.json()) as {
      data: { result: { action: string; incident: { id: string } } };
    };
    expect(accepted.data.result.action).toBe('triggered');
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: accepted.data.result.incident.id },
    });
    expect(incident.serviceId).toBe(service.id);
    expect(incident.priority).toBe('P3');
    expect(
      (
        await db.incidentAutomationDecision.findUniqueOrThrow({
          where: { incidentId: incident.id },
        })
      ).routeType
    ).toBe('NO_ESCALATION');
    expect(
      await db.backgroundJob.count({
        where: { type: 'ESCALATION', payload: { path: ['incidentId'], equals: incident.id } },
      })
    ).toBe(0);
    await page.goto(`${isDesktop(testInfo) ? '' : '/m'}/incidents/${incident.id}`);
    await expect(page.getByRole('heading', { name: /Alert Context/ })).toBeVisible();
    await expect(
      page.getByText('production', { exact: true }).filter({ visible: true }).first()
    ).toBeVisible();
    await expect(
      page
        .getByText('Personal paging intentionally skipped', { exact: false })
        .filter({ visible: true })
    ).toBeVisible();
    expect(
      await db.notification.count({
        where: {
          incidentId: incident.id,
          channel: 'SLACK',
          sourceType: 'AUTOMATION',
          status: 'PENDING',
        },
      })
    ).toBe(notificationCase === 'TEAMS' ? 0 : 1);
    if (notificationCase !== 'SLACK') {
      const operation = await db.externalOperation.findFirstOrThrow({
        where: { incidentId: incident.id, provider: 'MICROSOFT_TEAMS' },
      });
      expect(operation.requestPayload).toMatchObject({ origin: 'AUTOMATION' });
    }
    const delivery = page.getByRole('region', { name: 'Channel notification status' });
    await expect(delivery).toContainText('Queued');
    await expect(delivery).not.toContainText('Delivery confirmed');
    await page.getByText(/^Show \d+ more context fields$/).click();
    await expect(page.getByText('Captured field 6', { exact: true })).toBeVisible();
    await page.getByText('Show full value', { exact: true }).click();
    await expect(page.getByText('x'.repeat(1200), { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
      .toBe(true);
    await page.getByText('Show full value', { exact: true }).click();
    await page.screenshot({
      path: `/tmp/automation-context-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const auditorEmail = `automation-reader-${randomUUID()}@example.com`;
    await db.user.create({
      data: {
        email: auditorEmail,
        name: 'Context Auditor',
        role: 'AUDITOR',
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    const readerCsrf = await (await page.request.get('/api/auth/csrf')).json();
    await page.request.post('/api/auth/callback/credentials', {
      form: { csrfToken: readerCsrf.csrfToken, email: auditorEmail, password, json: 'true' },
    });
    expect((await (await page.request.get('/api/auth/session')).json()).user.email).toBe(
      auditorEmail
    );
    await page.goto(`${isDesktop(testInfo) ? '' : '/m'}/incidents/${incident.id}`);
    await expect(
      page.getByText('Alert context is restricted.', { exact: true }).filter({ visible: true })
    ).toBeVisible();
    await expect(
      page.getByText('Alert details are restricted.', { exact: true }).filter({ visible: true })
    ).toBeVisible();
    const readerHtml = await page.request.get(`/incidents/${incident.id}`);
    expect(readerHtml.status()).toBe(200);
    const restrictedHtml = await readerHtml.text();
    expect(restrictedHtml).not.toContain('x'.repeat(1200));
    expect(restrictedHtml).not.toContain('ABC123');
    const auditor = await db.user.findUniqueOrThrow({ where: { email: auditorEmail } });
    const apiKey = generateApiKey();
    await db.apiKey.create({
      data: {
        name: 'Auditor privacy journey',
        prefix: apiKey.prefix,
        tokenHash: apiKey.tokenHash,
        scopes: ['incidents:read'],
        userId: auditor.id,
      },
    });
    const apiDetail = await page.request.get(`/api/incidents/${incident.id}`, {
      headers: { Authorization: `Bearer ${apiKey.token}` },
    });
    expect(apiDetail.status()).toBe(200);
    expect(await apiDetail.text()).not.toContain('ABC123');
  });
}

test('P1 ingestion pins its policy through later edits and archival', async ({
  page,
}, testInfo) => {
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken: csrf.csrfToken, email, password, json: 'true' },
  });
  const actor = await db.user.findUniqueOrThrow({ where: { email } });
  const service = await db.service.create({ data: { name: `P1 journey ${randomUUID()}` } });
  const policy = await db.escalationPolicy.create({
    data: {
      name: `Critical policy ${randomUUID()}`,
      steps: {
        create: {
          stepOrder: 0,
          delayMinutes: 5,
          targetType: 'USER',
          targetUserId: actor.id,
          notificationChannels: ['EMAIL'],
        },
      },
    },
  });
  const defaultPolicy = await db.escalationPolicy.create({
    data: {
      name: `Standard service default ${randomUUID()}`,
      steps: {
        create: {
          stepOrder: 0,
          delayMinutes: 5,
          targetType: 'USER',
          targetUserId: actor.id,
          notificationChannels: ['EMAIL'],
        },
      },
    },
  });
  await db.service.update({
    where: { id: service.id },
    data: { escalationPolicyId: defaultPolicy.id },
  });
  const integration = await db.integration.create({
    data: { serviceId: service.id, name: 'P1 journey', key: randomUUID(), type: 'EVENTS_API_V2' },
  });
  const slack = await db.slackDestination.create({
    data: { serviceId: service.id, workspaceId: randomUUID(), channelId: 'C_P1_BROWSER' },
  });
  const snapshot = {
    schemaVersion: 1 as const,
    fields: [
      {
        fieldId: 'environment',
        key: 'environment',
        label: 'Environment',
        type: 'STRING' as const,
        caseSensitive: false,
        aliases: { prod: 'production' },
        mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.environment' }],
      },
    ],
    rules: [
      {
        id: 'production-priority',
        name: 'Production alerts are P1',
        phase: 'ENRICH' as const,
        enabled: true,
        conditions: [{ fieldKey: 'environment', operator: 'EQ' as const, value: 'production' }],
        actions: [{ type: 'SET_PRIORITY' as const, value: 'P1' as const }],
      },
      {
        id: 'production',
        name: 'Production critical alerts',
        phase: 'ROUTE' as const,
        enabled: true,
        conditions: [{ fieldKey: 'environment', operator: 'EQ' as const, value: 'production' }],
        actions: [
          { type: 'USE_ESCALATION_POLICY' as const, policyId: policy.id },
          { type: 'NOTIFY_CHANNEL' as const, provider: 'SLACK' as const, destinationId: slack.id },
        ],
      },
    ],
  };
  const { compiled, issues } = compileAutomation(snapshot);
  expect(issues.filter(issue => issue.level === 'ERROR')).toHaveLength(0);
  const version = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 1,
      snapshot,
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      lintReport: [],
      publishedBy: actor.id,
      policyRefs: {
        create: {
          escalationPolicyId: policy.id,
          policyNameSnapshot: policy.name,
          ruleReferences: [{ id: 'production', name: 'Production critical alerts', enabled: true }],
        },
      },
    },
  });
  await db.serviceAutomationConfig.create({
    data: { serviceId: service.id, activeVersionId: version.id, mode: 'LIVE' },
  });
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', automationEnabled: true },
    update: { automationEnabled: true },
  });
  const response = await page.request.post('/api/events', {
    headers: { Authorization: `Token token=${integration.key}` },
    data: {
      event_action: 'trigger',
      dedup_key: randomUUID(),
      payload: {
        summary: 'Production P1 browser journey',
        source: 'browser-certification',
        severity: 'critical',
        custom_details: { environment: 'PROD' },
      },
    },
  });
  expect(response.status()).toBe(202);
  const accepted = (await response.json()) as { data: { result: { incident: { id: string } } } };
  const incident = await db.incident.findUniqueOrThrow({
    where: { id: accepted.data.result.incident.id },
  });
  expect(incident.priority).toBe('P1');
  expect(
    await db.backgroundJob.count({
      where: { type: 'ESCALATION', payload: { path: ['incidentId'], equals: incident.id } },
    })
  ).toBe(1);
  expect(
    await db.notification.count({
      where: { incidentId: incident.id, channel: 'SLACK', sourceType: 'AUTOMATION' },
    })
  ).toBe(1);
  const missingResponse = await page.request.post('/api/events', {
    headers: { Authorization: `Token token=${integration.key}` },
    data: {
      event_action: 'trigger',
      dedup_key: randomUUID(),
      payload: {
        summary: 'Missing context browser journey',
        source: 'browser-certification',
        severity: 'info',
        custom_details: {},
      },
    },
  });
  expect(missingResponse.status()).toBe(202);
  const missing = (await missingResponse.json()) as {
    data: { result: { incident: { id: string } } };
  };
  const unmatched = await db.incidentAutomationDecision.findUniqueOrThrow({
    where: { incidentId: missing.data.result.incident.id },
  });
  expect(unmatched.routeType).toBe('SERVICE_DEFAULT');
  expect(unmatched.finalPriority).toBe(unmatched.basePriority);
  expect(
    await db.notification.count({
      where: { incidentId: missing.data.result.incident.id, sourceType: 'AUTOMATION' },
    })
  ).toBe(0);
  await page.goto(
    `${isDesktop(testInfo) ? '' : '/m'}/incidents/${missing.data.result.incident.id}`
  );
  await expect(
    page.getByText('Not provided', { exact: true }).filter({ visible: true }).first()
  ).toBeVisible();
  await expect(
    page
      .getByText('No routing rule matched; service-default routing was used.', { exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  await db.escalationPolicy.update({
    where: { id: policy.id },
    data: { name: `Changed after ingestion ${randomUUID()}` },
  });
  const replacementSnapshot = { schemaVersion: 1 as const, fields: [], rules: [] };
  const replacement = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 2,
      snapshot: replacementSnapshot,
      compiledSnapshot: replacementSnapshot,
      checksum: checksum(replacementSnapshot),
      lintReport: [],
      publishedBy: actor.id,
    },
  });
  await db.serviceAutomationConfig.update({
    where: { serviceId: service.id },
    data: { activeVersionId: replacement.id },
  });
  await page.goto(`/policies/${policy.id}?tab=dependencies`);
  await page.getByRole('button', { name: 'Archive policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Policy Dependencies · Archived' })).toBeVisible();
  await page.goto(`${isDesktop(testInfo) ? '' : '/m'}/incidents/${incident.id}`);
  await expect(
    page.getByText('production', { exact: true }).filter({ visible: true }).first()
  ).toBeVisible();
  await expect(
    page
      .locator('dt', { hasText: /^Responder route$/ })
      .filter({ visible: true })
      .locator('xpath=following-sibling::dd')
  ).toContainText(policy.name);
  if (!isDesktop(testInfo)) {
    await page
      .locator('summary')
      .filter({ hasText: 'Incident details & assignment' })
      .filter({ visible: true })
      .click();
    const linksDisclosure = page
      .locator('summary')
      .filter({ hasText: 'People, fields & links' })
      .filter({ visible: true });
    if (await linksDisclosure.count()) await linksDisclosure.click();
  }
  await expect(
    page.locator(`a[title="Escalation Policy: ${policy.name}"]`).filter({ visible: true })
  ).toBeVisible();
  await expect(
    page
      .getByText(`Current service default: ${defaultPolicy.name}`, { exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  expect(
    (await db.incidentAutomationDecision.findUniqueOrThrow({ where: { incidentId: incident.id } }))
      .versionId
  ).toBe(version.id);
});

test('administrator archives and restores an unreferenced policy through Dependencies', async ({
  page,
}) => {
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken: csrf.csrfToken, email, password, json: 'true' },
  });
  const policy = await db.escalationPolicy.create({
    data: { name: `Archive journey ${randomUUID()}` },
  });
  await page.goto(`/policies/${policy.id}?tab=dependencies`);
  await expect(page.getByRole('heading', { name: 'Policy Dependencies · Active' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Policy Dependencies · Archived' })).toBeVisible();
  expect(
    (await db.escalationPolicy.findUniqueOrThrow({ where: { id: policy.id } })).archivedAt
  ).not.toBeNull();
  await page.getByRole('button', { name: 'Restore policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Policy Dependencies · Active' })).toBeVisible();
  expect(
    (await db.escalationPolicy.findUniqueOrThrow({ where: { id: policy.id } })).archivedAt
  ).toBeNull();
});
test('operator authors, tests, publishes, and enables shadow on desktop and mobile', async ({
  page,
}, testInfo) => {
  const csrfResponse = await page.request.get('/api/auth/csrf');
  const { csrfToken } = await csrfResponse.json();
  const login = await page.request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      email,
      password,
      json: 'true',
      callbackUrl: 'http://127.0.0.1:3193/services',
    },
  });
  expect(login.ok()).toBe(true);
  const session = await page.request.get('/api/auth/session');
  expect((await session.json()).user.email).toBe(email);
  await page.goto('/settings/system?section=automation');
  const settings = page.getByRole('region', { name: 'Global automation settings' });
  await expect(
    settings.getByText('Manage automation across all services.', { exact: false })
  ).toBeVisible();
  await settings.getByLabel('Enable service automation globally').check();
  await settings.getByLabel('Trace and observation retention (days)').fill('120');
  await settings.getByRole('button', { name: 'Save automation settings' }).click();
  // The first Server Action compiles on demand in the local Next dev server.
  await expect(settings.getByRole('status')).toHaveText('Automation settings saved.', {
    timeout: 90000,
  });
  await page.reload();
  await expect(settings.getByLabel('Enable service automation globally')).toBeChecked();
  await expect(settings.getByLabel('Trace and observation retention (days)')).toHaveValue('120');
  await page.goto(
    isDesktop(testInfo)
      ? `/services/${serviceId}?tab=automation`
      : `/m/services/${serviceId}/automation`
  );
  const workspace = page.getByRole('region', { name: 'Service automation' });
  await expect(workspace.getByRole('heading', { name: /Automation/ })).toBeVisible();
  await workspace.getByRole('button', { name: 'Edit automation', exact: true }).click();
  await workspace.getByRole('button', { name: 'Route production alerts', exact: true }).click();
  await workspace.getByRole('button', { name: 'Configure Production alerts', exact: true }).click();
  await expect(workspace.getByLabel('Rule name')).toHaveValue('Production alerts');
  await expect(workspace.getByText(/· Saved/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(id => localStorage.getItem(`automation-draft:${id}`), serviceId))
    .toBeNull();
  await workspace.getByRole('button', { name: 'Test', exact: true }).click();
  await workspace.getByRole('button', { name: 'Test sample', exact: true }).click();
  await expect(workspace.getByText(/semantic fixtures passed/)).toBeVisible();
  await workspace.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Review automation publication');
  await page.getByRole('button', { name: 'Confirm publication', exact: true }).click();
  await expect(workspace.getByText(/Version 1 ·/)).toBeVisible();
  await workspace.getByLabel('Automation mode').selectOption('SHADOW');
  await expect(workspace.getByLabel('Automation mode')).toHaveValue('SHADOW');
  await workspace.getByLabel('Automation mode').selectOption('LIVE');
  await expect(page.getByRole('dialog')).toContainText('Shadow readiness');
  await page.getByRole('button', { name: 'Keep unchanged', exact: true }).click();
  await expect(workspace.getByLabel('Automation mode')).toHaveValue('SHADOW');
  await workspace.getByLabel('Automation mode').selectOption('LIVE');
  await page.getByRole('checkbox', { name: /I understand this version/ }).check();
  await page.getByRole('button', { name: 'Confirm LIVE', exact: true }).click();
  await expect(workspace.getByLabel('Automation mode')).toHaveValue('LIVE');
  await workspace.getByLabel('Automation mode').selectOption('SHADOW');
  await workspace.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(workspace.getByText('Recognized: production, staging, development')).toBeVisible();
  await workspace.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(workspace.getByText(/Fallback: service default/)).toBeVisible();
  await workspace.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(workspace.getByLabel('Rule name')).toHaveCount(0);
  await workspace.getByLabel('Search rules').fill('no-match');
  await expect(
    workspace.getByRole('button', { name: 'Configure Production alerts', exact: true })
  ).toHaveCount(0);
  await workspace.getByLabel('Search rules').fill('Production');
  await expect(
    workspace.getByRole('button', { name: 'Configure Production alerts', exact: true })
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
    .toBe(true);
  if (isDesktop(testInfo)) {
    const sidebar = await page.locator('#app-sidebar').boundingBox();
    const automation = await workspace.boundingBox();
    expect(automation!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  }
  await page.screenshot({ path: `/tmp/automation-${testInfo.project.name}.png`, fullPage: true });
  await workspace.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(workspace.getByText('Version 1', { exact: false }).first()).toBeVisible();
  await workspace.getByRole('button', { name: 'Restore as new version', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Review version restore');
  await page.getByRole('button', { name: 'Confirm publication', exact: true }).click();
  await expect(workspace.getByText(/Version 2 ·/)).toBeVisible();
});

test('100-rule policy remains bounded, keyboard editable, searchable and recoverable', async ({
  page,
}, testInfo) => {
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken: csrf.csrfToken, email, password, json: 'true' },
  });
  const snapshot = automationLoadSnapshot('live-worst');
  await db.automationDraft.upsert({
    where: { serviceId },
    create: { serviceId, snapshot, revision: 1, updatedBy: 'automation-ui-fixture' },
    update: { snapshot, revision: { increment: 1 } },
  });
  const timing: Record<string, number | null> = {};
  let start = Date.now();
  await page.goto(
    isDesktop(testInfo)
      ? `/services/${serviceId}?tab=automation`
      : `/m/services/${serviceId}/automation`
  );
  const workspace = page.getByRole('region', { name: 'Service automation' });
  await workspace.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(workspace.getByRole('button', { name: /^Configure Rule / })).toHaveCount(100);
  const health = workspace.getByRole('region', { name: 'Configuration health' });
  await expect(health).toBeVisible();
  const warnings = health.locator('details').first();
  await expect(warnings).not.toHaveAttribute('open', '');
  await health.getByText('Review warnings', { exact: true }).click();
  const unusedFields = health.getByText(/^Unused fields \(\d+\)$/);
  await expect(unusedFields).toBeVisible();
  await unusedFields.click();
  await expect(health.locator('li').first()).toBeVisible();
  await health.getByText('Review warnings', { exact: true }).click();
  timing.initialRulesMs = Date.now() - start;
  await workspace.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(
    workspace.getByText(/Queue health and capacity approval require deployment review/)
  ).toBeVisible();
  start = Date.now();
  await workspace.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(workspace.getByRole('button', { name: /^Configure Rule / })).toHaveCount(100);
  timing.warmRulesMs = Date.now() - start;
  expect(timing.warmRulesMs).toBeLessThan(1500);
  await expect(workspace.getByLabel('Rule name')).toHaveCount(0);
  start = Date.now();
  await workspace.getByLabel('Search rules').fill('Rule 99');
  await expect(workspace.getByRole('button', { name: /^Configure Rule / })).toHaveCount(1);
  timing.searchMs = Date.now() - start;
  expect(timing.searchMs).toBeLessThan(1500);
  start = Date.now();
  const configure = workspace.getByRole('button', { name: 'Configure Rule 99', exact: true });
  await configure.focus();
  await page.keyboard.press('Enter');
  await expect(workspace.getByLabel('Condition field')).toHaveCount(20);
  timing.expandMs = Date.now() - start;
  expect(timing.expandMs).toBeLessThan(2000);
  start = Date.now();
  await workspace.getByLabel('Rule name').fill('Rule 99 edited');
  timing.typingMs = Date.now() - start;
  expect(timing.typingMs).toBeLessThan(1500);
  const accessibility = await new AxeBuilder({ page })
    .include('[aria-label="Service automation"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  await testInfo.attach('automation-accessibility', {
    body: JSON.stringify(accessibility.violations, null, 2),
    contentType: 'application/json',
  });
  expect(accessibility.violations).toEqual([]);
  await workspace.getByRole('button', { name: 'Move rule up', exact: true }).click();
  await expect
    .poll(
      async () => {
        const saved = await db.automationDraft.findUniqueOrThrow({ where: { serviceId } });
        return (saved.snapshot as { rules: Array<{ name: string }> }).rules[98].name;
      },
      { timeout: 15000 }
    )
    .toBe('Rule 99 edited');
  await workspace.getByRole('button', { name: 'Delete rule', exact: true }).click();
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await workspace.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await workspace.getByLabel('Search rules').fill('');
  await expect(workspace.getByRole('button', { name: /^Configure Rule / })).toHaveCount(100);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
    .toBe(true);
  timing.domNodes = await workspace.locator('*').count();
  expect(timing.domNodes).toBeLessThan(6000);
  timing.heapBytes = await page.evaluate(
    () =>
      (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null
  );
  await testInfo.attach('large-policy-performance', {
    body: JSON.stringify(timing, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('large-policy-viewport', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('SDK authoring, UI activation and HTTP ingestion share the published routing decision', async ({
  page,
}, testInfo) => {
  const { Client } = await import('../../sdk/typescript/client');
  const service = await db.service.create({ data: { name: `SDK journey ${randomUUID()}` } });
  const serviceId = service.id;
  const actor = await db.user.findUniqueOrThrow({ where: { email } });
  const credential = generateApiKey();
  const key = await db.apiKey.create({
    data: {
      name: 'Automation SDK browser journey',
      userId: actor.id,
      prefix: credential.prefix,
      tokenHash: credential.tokenHash,
      scopes: [
        'automation:read',
        'automation:write',
        'automation:publish',
        'automation-settings:read',
        'automation-settings:write',
      ],
    },
  });
  const integration = await db.integration.create({
    data: {
      serviceId,
      name: 'SDK browser ingestion',
      key: randomUUID(),
      type: 'EVENTS_API_V2',
    },
  });
  const client = new Client({
    baseUrl: 'http://127.0.0.1:3193/api/v2',
    token: credential.token,
    allowInsecureHttp: true,
    maxRetries: 0,
  });
  const publisher = new Client({
    baseUrl: `http://127.0.0.1:${process.env.PLAYWRIGHT_PRODUCTION_SERVER === 'true' && process.env.PLAYWRIGHT_EXTERNAL_SERVER !== 'true' ? 3194 : 3193}/api/v2`,
    token: credential.token,
    allowInsecureHttp: true,
    maxRetries: 0,
  });
  let observationFaultInstalled = false;
  try {
    const settings = await client.call('getAutomationSettings', {});
    await client.call('updateAutomationSettings', {
      body: {
        automationEnabled: true,
        automationTraceRetentionDays: settings.data.automationTraceRetentionDays,
      },
      headers: {
        'If-Match': `"${settings.data.automationSettingsRevision}"`,
        'Idempotency-Key': randomUUID(),
      },
    });
    const draft = await client.call('getAutomationDraft', { params: { id: serviceId } });
    const snapshot = {
      schemaVersion: 1 as const,
      fields: [],
      rules: [
        {
          id: 'sdk-enrich',
          name: 'SDK priority',
          phase: 'ENRICH' as const,
          enabled: true,
          conditions: [],
          actions: [{ type: 'SET_PRIORITY' as const, value: 'P1' as const }],
        },
        {
          id: 'sdk-no-page',
          name: 'SDK intentional suppression',
          phase: 'ROUTE' as const,
          enabled: true,
          conditions: [
            { fieldKey: 'source', operator: 'EQ' as const, value: 'sdk-browser-certification' },
          ],
          actions: [{ type: 'NO_ESCALATION' as const }],
        },
      ],
    };
    const saved = await client.call('saveAutomationDraft', {
      params: { id: serviceId },
      body: { snapshot },
      headers: { 'If-Match': `"${draft.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    const published = await publisher.call('publishAutomationVersion', {
      params: { id: serviceId },
      body: { expectedActiveVersionId: null },
      headers: { 'If-Match': `"${saved.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    const csrf = await (await page.request.get('/api/auth/csrf')).json();
    await page.request.post('/api/auth/callback/credentials', {
      form: { csrfToken: csrf.csrfToken, email, password, json: 'true' },
    });
    await page.goto(
      testInfo.project.name === 'desktop'
        ? `/services/${serviceId}?tab=automation`
        : `/m/services/${serviceId}/automation`
    );
    const workspace = page.getByRole('region', { name: 'Service automation' });
    await expect(workspace.getByText(/Version 1 ·/)).toBeVisible();
    await workspace.getByLabel('Automation mode').selectOption('SHADOW');
    await expect(workspace.getByLabel('Automation mode')).toHaveValue('SHADOW');
    await workspace.getByLabel('Automation mode').selectOption('LIVE');
    await page.getByRole('checkbox', { name: /I understand this version/ }).check();
    await page.getByRole('button', { name: 'Confirm LIVE', exact: true }).click();
    await expect(workspace.getByLabel('Automation mode')).toHaveValue('LIVE');
    await expect(
      workspace.getByRole('button', { name: 'Publish candidate', exact: true })
    ).toBeEnabled();

    // Author and publish candidate Version 2 with distinct enrichment (P2 priority)
    const candidateDraft = await client.call('getAutomationDraft', { params: { id: serviceId } });
    const candidateSnapshot = {
      schemaVersion: 1 as const,
      fields: [],
      rules: [
        {
          id: 'sdk-enrich-v2',
          name: 'Candidate V2 priority',
          phase: 'ENRICH' as const,
          enabled: true,
          conditions: [],
          actions: [{ type: 'SET_PRIORITY' as const, value: 'P2' as const }],
        },
        {
          id: 'sdk-no-page',
          name: 'SDK intentional suppression',
          phase: 'ROUTE' as const,
          enabled: true,
          conditions: [
            { fieldKey: 'source', operator: 'EQ' as const, value: 'sdk-browser-certification' },
          ],
          actions: [{ type: 'NO_ESCALATION' as const }],
        },
      ],
    };
    const savedV2 = await client.call('saveAutomationDraft', {
      params: { id: serviceId },
      body: { snapshot: candidateSnapshot },
      headers: { 'If-Match': `"${candidateDraft.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    const candidatePub = await client.call('publishAutomationVersion', {
      params: { id: serviceId },
      body: { expectedActiveVersionId: published.data.id, expectedCandidateVersionId: null },
      headers: { 'If-Match': `"${savedV2.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    expect(candidatePub.data.versionNumber).toBe(2);
    expect(
      await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId } })
    ).toMatchObject({
      mode: 'LIVE',
      activeVersionId: published.data.id,
      candidateVersionId: candidatePub.data.id,
    });

    if (testInfo.project.name === 'desktop') {
      // A test-owned trigger rejects the first worker attempt only. It changes no
      // aggregate rows and leaves the durable queue's real retry policy intact.
      if (!/^[a-z0-9]+$/.test(candidatePub.data.id)) throw new Error('Invalid fixture version id');
      await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION automation_browser_fail_observation_once() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."versionId" = '${candidatePub.data.id}' AND EXISTS (
            SELECT 1 FROM "BackgroundJob" WHERE type = 'SCHEDULED_TASK'
              AND status = 'PROCESSING' AND attempts = 1
              AND payload->>'task' = 'AUTOMATION_OBSERVE'
              AND payload->'shadow'->>'versionId' = NEW."versionId"
          ) THEN RAISE EXCEPTION 'Injected transient candidate observation failure'; END IF;
          RETURN NEW;
        END $$`);
      await db.$executeRawUnsafe(
        'CREATE TRIGGER automation_browser_fail_observation_once BEFORE INSERT OR UPDATE ON "AutomationShadowAggregate" FOR EACH ROW EXECUTE FUNCTION automation_browser_fail_observation_once()'
      );
      observationFaultInstalled = true;
    }

    // Ingest pre-cutover alert 1: must use Version 1 LIVE decision while candidate shadows safely
    const dedupKey1 = randomUUID();
    const ingestion1 = await page.request.post('/api/events', {
      headers: { Authorization: `Token token=${integration.key}` },
      data: {
        event_action: 'trigger',
        dedup_key: dedupKey1,
        payload: {
          summary: 'Pre-cutover routing journey',
          source: 'sdk-browser-certification',
          severity: 'warning',
        },
      },
    });
    expect(ingestion1.ok()).toBe(true);
    const accepted1 = (await ingestion1.json()) as {
      data: { result: { action: string; incident: { id: string } } };
    };
    expect(accepted1.data.result.action).toBe('triggered');
    const incident1 = await db.incident.findUniqueOrThrow({
      where: { id: accepted1.data.result.incident.id },
    });
    expect(incident1.serviceId).toBe(serviceId);
    const decision1 = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId: incident1.id },
    });
    expect(decision1).toMatchObject({
      versionId: published.data.id,
      mode: 'LIVE',
      routeType: 'NO_ESCALATION',
      finalPriority: 'P1',
    });
    expect(incident1.priority).toBe('P1');

    if (testInfo.project.name === 'desktop') {
      await expect
        .poll(
          async () => {
            const job = await db.backgroundJob.findUnique({
              where: { id: `AUTOMATION_OBSERVE:${incident1.id}` },
            });
            return {
              status: job?.status,
              attempts: job?.attempts,
              scheduledForRetry: Boolean(job && job.scheduledAt.getTime() > Date.now()),
            };
          },
          {
            timeout: 30000,
            message: 'Real worker requeues the failed first attempt with durable backoff',
          }
        )
        .toEqual({ status: 'PENDING', attempts: 1, scheduledForRetry: true });
      const delayedEvidence = await client.call('getAutomationCandidate', {
        params: { id: serviceId },
      });
      expect(delayedEvidence.data.shadowAggregates.evaluated).toBe(0);
      expect(delayedEvidence.data.evidenceFreshness.pendingObservations).toBe(1);
      expect(delayedEvidence.data.evidenceFreshness.latestEvidenceBucketDate).toBeNull();
      await testInfo.attach('candidate-observation-delayed-evidence', {
        body: JSON.stringify(delayedEvidence.data.evidenceFreshness),
        contentType: 'application/json',
      });
    }

    // The real general worker must consume this incident's durable observation;
    // ingestion alone does not materialize shadow aggregates.
    await expect
      .poll(
        async () =>
          (
            await db.backgroundJob.findUnique({
              where: { id: `AUTOMATION_OBSERVE:${incident1.id}` },
            })
          )?.status,
        {
          timeout: 120000,
          message: 'General worker completes candidate observation through durable retry',
        }
      )
      .toBe('COMPLETED');
    const observation = await db.backgroundJob.findUniqueOrThrow({
      where: { id: `AUTOMATION_OBSERVE:${incident1.id}` },
    });
    expect(observation.attempts).toBe(testInfo.project.name === 'desktop' ? 2 : 1);
    expect(observation.completedAt).not.toBeNull();
    await testInfo.attach('candidate-observation-worker', {
      body: JSON.stringify({
        id: observation.id,
        status: observation.status,
        attempts: observation.attempts,
        createdAt: observation.createdAt,
        completedAt: observation.completedAt,
      }),
      contentType: 'application/json',
    });
    // Confirm candidate shadow evaluation accumulated evidence without applying candidate side effects
    const candidateAgg = await db.automationShadowAggregate.findFirst({
      where: { versionId: candidatePub.data.id },
    });
    expect(candidateAgg?.evaluated).toBe(1);
    expect(candidateAgg?.priorityDifferent).toBe(1);
    const candidateEvidence = await client.call('getAutomationCandidate', {
      params: { id: serviceId },
    });
    expect(candidateEvidence.data.shadowAggregates).toMatchObject({
      evaluated: 1,
      priorityDifferent: 1,
    });
    expect(candidateEvidence.data.evidenceFreshness).toMatchObject({
      pendingObservations: 0,
      pendingObservationsTruncated: false,
    });
    expect(candidateEvidence.data.evidenceFreshness.latestEvidenceBucketDate).not.toBeNull();
    await expect(
      client.call('activateAutomationCandidate', {
        params: { id: serviceId },
        body: {
          expectedCandidateVersionId: candidatePub.data.id,
          expectedActiveVersionId: published.data.id,
        },
        headers: { 'Idempotency-Key': randomUUID() },
      })
    ).rejects.toMatchObject({ status: 400 });

    // Operator browser journey: inspect candidate shadow evidence and activate candidate into LIVE
    await page.goto(
      testInfo.project.name === 'desktop'
        ? `/services/${serviceId}?tab=automation`
        : `/m/services/${serviceId}/automation`
    );
    await expect(page.getByText('Pending candidate · Version 2')).toBeVisible();
    await page.getByRole('button', { name: 'Activate candidate (LIVE cutover)' }).click();
    await expect(page.getByText('Review candidate activation · Cutover to LIVE')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm LIVE', exact: true })).toBeDisabled();
    const differenceApproval = page.getByRole('checkbox', {
      name: 'I approve the observed routing, priority and suppression differences.',
    });
    await differenceApproval.focus();
    await page.keyboard.press('Space');
    const confirmCutover = page.getByRole('button', { name: 'Confirm LIVE', exact: true });
    if (testInfo.project.name === 'desktop' || testInfo.project.name === 'mobile') {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(confirmCutover).toBeFocused();
    } else {
      // Touch WebKit does not enable desktop full-keyboard Tab navigation.
      // Verify keyboard activation from the accessible control's focus instead.
      await confirmCutover.focus();
    }
    await page.keyboard.press('Enter');
    await expect(workspace.getByText(/Version 2 ·/)).toBeVisible();
    expect(
      await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId } })
    ).toMatchObject({
      mode: 'LIVE',
      activeVersionId: candidatePub.data.id,
      candidateVersionId: null,
    });

    // Ingest post-cutover alert 2: must route with newly activated Version 2 decisions
    const dedupKey2 = randomUUID();
    const ingestion2 = await page.request.post('/api/events', {
      headers: { Authorization: `Token token=${integration.key}` },
      data: {
        event_action: 'trigger',
        dedup_key: dedupKey2,
        payload: {
          summary: 'Post-cutover routing journey',
          source: 'sdk-browser-certification',
          severity: 'warning',
        },
      },
    });
    expect(ingestion2.ok()).toBe(true);
    const accepted2 = (await ingestion2.json()) as {
      data: { result: { action: string; incident: { id: string } } };
    };
    expect(accepted2.data.result.action).toBe('triggered');
    const incident2 = await db.incident.findUniqueOrThrow({
      where: { id: accepted2.data.result.incident.id },
    });
    expect(incident2.serviceId).toBe(serviceId);
    const decision2 = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId: incident2.id },
    });
    expect(decision2).toMatchObject({
      versionId: candidatePub.data.id,
      mode: 'LIVE',
      routeType: 'NO_ESCALATION',
      finalPriority: 'P2',
    });
    expect(incident2.priority).toBe('P2');

    // Incident 1 remains permanently pinned to Version 1
    const pinnedIncident1 = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId: incident1.id },
    });
    expect(pinnedIncident1.versionId).toBe(published.data.id);
    expect(pinnedIncident1.finalPriority).toBe('P1');

    // Discard journey: Stage Version 3 candidate and discard through accessible confirmation dialog
    const draftV3 = await client.call('getAutomationDraft', { params: { id: serviceId } });
    const candidatePub3 = await client.call('publishAutomationVersion', {
      params: { id: serviceId },
      body: { expectedActiveVersionId: candidatePub.data.id, expectedCandidateVersionId: null },
      headers: { 'If-Match': `"${draftV3.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    expect(candidatePub3.data.versionNumber).toBe(3);
    await page.reload();
    await expect(page.getByText('Pending candidate · Version 3')).toBeVisible();
    await page.getByRole('button', { name: 'Discard candidate' }).click();
    await expect(page.getByText('Discard candidate automation version?')).toBeVisible();
    await page.getByRole('button', { name: 'Discard candidate', exact: true }).click();
    await expect(page.getByText('Pending candidate · Version 3')).not.toBeVisible();
    expect(
      await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId } })
    ).toMatchObject({
      mode: 'LIVE',
      activeVersionId: candidatePub.data.id,
      candidateVersionId: null,
    });

    // Cleanup: revoke credentials
    await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    await expect(
      client.call('getAutomationDraft', { params: { id: serviceId } })
    ).rejects.toMatchObject({ status: 401 });
  } finally {
    if (observationFaultInstalled) {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS automation_browser_fail_observation_once ON "AutomationShadowAggregate"'
      );
      await db.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS automation_browser_fail_observation_once()'
      );
    }
    await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  }
});

test('API-only automation authoring, diagnostics and historical restoration use the deployed SDK', async ({
  page,
}, testInfo) => {
  const { Client } = await import('../../sdk/typescript/client');
  const actor = await db.user.findUniqueOrThrow({ where: { email } });
  const service = await db.service.create({ data: { name: `API lifecycle ${randomUUID()}` } });
  const integration = await db.integration.create({
    data: {
      name: 'API lifecycle ingestion',
      serviceId: service.id,
      key: randomUUID(),
      type: 'EVENTS_API_V2',
    },
  });
  const issued = generateApiKey();
  const key = await db.apiKey.create({
    data: {
      name: 'API lifecycle certification',
      userId: actor.id,
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
      scopes: [
        'automation:read',
        'automation:write',
        'automation:publish',
        'automation-settings:read',
        'automation-settings:write',
        'incidents:read',
      ],
    },
  });
  const client = new Client({
    baseUrl: 'http://127.0.0.1:3193/api/v2',
    token: issued.token,
    allowInsecureHttp: true,
    maxRetries: 0,
  });
  const params = { id: service.id };
  const snapshot = {
    schemaVersion: 1 as const,
    fields: [
      {
        fieldId: 'environment',
        key: 'environment',
        label: 'Environment',
        type: 'STRING' as const,
        caseSensitive: false,
        aliases: {},
        mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.environment' }],
      },
    ],
    rules: [
      {
        id: 'suppress',
        name: 'Certification suppression',
        phase: 'ROUTE' as const,
        enabled: true,
        conditions: [
          {
            fieldKey: 'environment',
            operator: 'EQ' as const,
            value: 'private-certification-value',
          },
        ],
        actions: [{ type: 'NO_ESCALATION' as const }],
      },
    ],
  };
  const event = {
    event_action: 'trigger' as const,
    dedup_key: randomUUID(),
    payload: {
      summary: 'API lifecycle certification',
      source: 'private-certification-source',
      severity: 'info' as const,
      custom_details: { environment: 'private-certification-value' },
    },
  };
  try {
    const settings = await client.call('getAutomationSettings', {});
    await client.call('updateAutomationSettings', {
      body: {
        automationEnabled: true,
        automationTraceRetentionDays: settings.data.automationTraceRetentionDays,
      },
      headers: {
        'If-Match': `"${settings.data.automationSettingsRevision}"`,
        'Idempotency-Key': randomUUID(),
      },
    });
    const initial = await client.call('getAutomationDraft', { params });
    const saved = await client.call('saveAutomationDraft', {
      params,
      body: { snapshot },
      headers: { 'If-Match': `"${initial.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    expect(
      (await client.call('validateAutomation', { params, body: { snapshot } })).data.valid
    ).toBe(true);
    const simulation = await client.call('simulateAutomation', {
      params,
      body: { snapshot, event, integrationType: integration.type, integrationId: integration.id },
    });
    expect(simulation.data.result?.outcome.type).toBe('NO_ESCALATION');
    expect(JSON.stringify(simulation)).not.toContain('private-certification-value');
    expect(await db.incident.count({ where: { serviceId: service.id } })).toBe(0);
    const published = await client.call('publishAutomationVersion', {
      params,
      body: { expectedActiveVersionId: null },
      headers: { 'If-Match': `"${saved.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    const configuration = await client.call('getServiceAutomation', { params });
    expect(configuration.data.mode).toBe('DISABLED');
    const live = await client.call('updateServiceAutomationMode', {
      params,
      body: { mode: 'LIVE', expectedActiveVersionId: published.data.id, acknowledgeNoShadow: true },
      headers: { 'If-Match': `"${configuration.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    expect(live.data.effectiveMode).toBe('LIVE');
    const history = await client.call('listAutomationVersions', { params, query: { limit: 1 } });
    expect(history.data[0].id).toBe(published.data.id);
    const inspected = await client.call('getAutomationVersion', {
      params: { ...params, versionId: published.data.id },
    });
    expect(inspected.data.snapshot).toEqual(snapshot);
    const ingested = await page.request.post('/api/events', {
      headers: { Authorization: `Token token=${integration.key}` },
      data: event,
    });
    expect(ingested.ok()).toBe(true);
    const incident = await db.incident.findFirstOrThrow({ where: { serviceId: service.id } });
    await expect
      .poll(
        async () =>
          (
            await db.backgroundJob.findUnique({
              where: { id: `AUTOMATION_OBSERVE:${incident.id}` },
            })
          )?.status,
        { timeout: 120000 }
      )
      .toBe('COMPLETED');
    const decisions = await client.call('listAutomationDecisions', { params });
    expect(decisions.data[0]).toMatchObject({
      incidentId: incident.id,
      versionId: published.data.id,
      routeType: 'NO_ESCALATION',
    });
    const observations = await client.call('listAutomationObservations', {
      params,
      query: { limit: 10 },
    });
    expect(observations.data.some(observation => observation.fieldKey === 'environment')).toBe(
      true
    );
    expect(JSON.stringify(observations)).not.toContain('private-certification-value');
    const restored = await client.call('restoreAutomationDraft', {
      params,
      body: { sourceVersionId: published.data.id },
      headers: { 'If-Match': `"${saved.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    expect(restored.data.restoredFromVersionId).toBe(published.data.id);
    const afterRestore = await client.call('getServiceAutomation', { params });
    expect(afterRestore.data).toMatchObject({
      mode: 'LIVE',
      activeVersionId: published.data.id,
      candidateVersionId: null,
    });
    const disabled = await client.call('updateServiceAutomationMode', {
      params,
      body: { mode: 'DISABLED', expectedActiveVersionId: published.data.id },
      headers: { 'If-Match': `"${afterRestore.data.revision}"`, 'Idempotency-Key': randomUUID() },
    });
    expect(disabled.data.effectiveMode).toBe('DISABLED');
    await testInfo.attach('api-only-automation-lifecycle', {
      body: JSON.stringify({
        versionId: published.data.id,
        restoredRevision: restored.data.revision,
        decisions: decisions.data.length,
        observations: observations.data.length,
        finalMode: disabled.data.effectiveMode,
      }),
      contentType: 'application/json',
    });
  } finally {
    await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  }
});
