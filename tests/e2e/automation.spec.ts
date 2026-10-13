import { hashTokenV2 } from '@/lib/api-keys';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { automationLoadSnapshot } from '../load/fixtures/automation';
import { compileAutomation } from '@/lib/automation/compiler';
import { checksum } from '@/lib/automation/cache';
import { randomUUID } from 'node:crypto';
const db = new PrismaClient();
let email: string;
const password = 'Automation-Local-Test-938!';
let serviceId: string;
test.beforeAll(async ({}, testInfo) => {
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
    await page.goto(`${testInfo.project.name === 'desktop' ? '' : '/m'}/incidents/${incident.id}`);
    await expect(page.getByRole('heading', { name: /Alert Context/ })).toBeVisible();
    await expect(
      page.getByText('production', { exact: true }).filter({ visible: true })
    ).toBeVisible();
    await expect(
      page.getByText('Personal paging intentionally skipped', { exact: false })
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
    await page.goto(`${testInfo.project.name === 'desktop' ? '' : '/m'}/incidents/${incident.id}`);
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
    const apiToken = randomUUID();
    await db.apiKey.create({
      data: {
        name: 'Auditor privacy journey',
        prefix: apiToken.slice(0, 8),
        tokenHash: hashTokenV2(apiToken),
        scopes: ['incidents:read'],
        userId: auditor.id,
      },
    });
    const apiDetail = await page.request.get(`/api/incidents/${incident.id}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
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
    `${testInfo.project.name === 'desktop' ? '' : '/m'}/incidents/${missing.data.result.incident.id}`
  );
  await expect(
    page.getByText('Not provided', { exact: true }).filter({ visible: true })
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
  await page.goto(`${testInfo.project.name === 'desktop' ? '' : '/m'}/incidents/${incident.id}`);
  await expect(
    page.getByText('production', { exact: true }).filter({ visible: true })
  ).toBeVisible();
  await expect(
    page.getByText('Responder route:', { exact: false }).filter({ visible: true })
  ).toContainText(policy.name);
  if (testInfo.project.name !== 'desktop') {
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
    testInfo.project.name === 'desktop'
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
  if (testInfo.project.name === 'desktop') {
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
    testInfo.project.name === 'desktop'
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
