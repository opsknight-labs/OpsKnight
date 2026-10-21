import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { compileAutomation } from '@/lib/automation/compiler';
import { checksum } from '@/lib/automation/cache';
import { discoverFields, formatHierarchicalLabel } from '@/lib/automation/discovery';
import { randomUUID } from 'node:crypto';

const db = new PrismaClient();

const isDesktop = (info: { project: { use: { isMobile?: boolean } } }) =>
  !info.project.use.isMobile;

let email: string;
const password = 'Release-Cert-Pass-2026!';
let serviceId: string;

test.beforeAll(async ({}, testInfo) => {
  email = `release-cert-${testInfo.project.name}-${Date.now()}@example.com`;
  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.upsert({
    where: { email },
    create: { email, name: 'Release Cert Admin', role: 'ADMIN', status: 'ACTIVE', passwordHash },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
  });
  const service = await db.service.create({
    data: { name: `Release Cert Service ${Date.now()}` },
  });
  serviceId = service.id;
});

test.afterAll(async () => {
  await db.service.delete({ where: { id: serviceId } }).catch(() => {});
  await db.user.delete({ where: { email } }).catch(() => {});
  await db.$disconnect();
});

test('BUG-04 & BUG-01: Root array discovery extracts bracket paths and formats hierarchical labels', async () => {
  const rootArrayJson = [
    { cluster_name: 'rds-aurora-cluster', replica_count: 3, active: true },
    { cluster_name: 'rds-aurora-cluster', replica_count: 5, active: false },
  ];
  const discovered = discoverFields(rootArrayJson);
  expect(discovered.length).toBeGreaterThan(0);

  const clusterField = discovered.find(f => f.path === '[0].cluster_name');
  expect(clusterField).toBeDefined();
  expect(formatHierarchicalLabel(clusterField!.path)).toBe('Cluster Name');
  expect(clusterField?.type).toBe('STRING');

  const replicaField = discovered.find(f => f.path === '[0].replica_count');
  expect(replicaField).toBeDefined();
  expect(formatHierarchicalLabel(replicaField!.path)).toBe('Replica Count');
  expect(replicaField?.type).toBe('NUMBER');

  const activeField = discovered.find(f => f.path === '[0].active');
  expect(activeField).toBeDefined();
  expect(formatHierarchicalLabel(activeField!.path)).toBe('Active');
  expect(activeField?.type).toBe('BOOLEAN');
});

test('BUG-08 & BUG-09: Fail-safe negative operators on missing/unmapped fields and case-insensitive matching', async ({
  page,
}) => {
  const service = await db.service.create({
    data: { name: `Failsafe Negation ${randomUUID()}` },
  });
  const integration = await db.integration.create({
    data: {
      serviceId: service.id,
      name: 'Failsafe Negation',
      key: randomUUID(),
      type: 'EVENTS_API_V2',
    },
  });

  const snapshot = {
    schemaVersion: 1 as const,
    fields: [
      {
        fieldId: 'env-choice',
        key: 'environment',
        label: 'Environment',
        type: 'ENUM' as const,
        caseSensitive: false,
        allowedValues: ['production', 'staging'],
        aliases: { prod: 'production' },
        mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.environment' }],
      },
    ],
    rules: [
      {
        id: 'rule-negative-ne',
        name: 'Alert if NOT production sets P1',
        phase: 'ENRICH' as const,
        enabled: true,
        conditions: [{ fieldKey: 'environment', operator: 'NE' as const, value: 'production' }],
        actions: [{ type: 'SET_PRIORITY' as const, value: 'P1' as const }],
      },
    ],
  };

  const { compiled, issues } = compileAutomation(snapshot);
  expect(issues.filter(i => i.level === 'ERROR')).toHaveLength(0);

  const version = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 1,
      snapshot,
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      lintReport: [],
      publishedBy: 'cert-runner',
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

  // Ingest alert with MISSING environment field: negative operator NE evaluates to UNKNOWN/FALSE, NOT matching!
  // Therefore priority remains base priority P3 (not elevated to P1).
  const missingResponse = await page.request.post('/api/events', {
    headers: { Authorization: `Token token=${integration.key}` },
    data: {
      event_action: 'trigger',
      dedup_key: randomUUID(),
      payload: {
        summary: 'Missing field failsafe test',
        source: 'browser-certification',
        severity: 'warning',
        custom_details: {},
      },
    },
  });
  expect(missingResponse.status()).toBe(202);
  const missingJson = (await missingResponse.json()) as {
    data: { result: { incident: { id: string } } };
  };
  const missingIncident = await db.incident.findUniqueOrThrow({
    where: { id: missingJson.data.result.incident.id },
  });
  expect(missingIncident.priority).not.toBe('P1');

  // Ingest alert with case-insensitive alias match 'PROD': matches 'production', so NE condition is FALSE!
  const prodResponse = await page.request.post('/api/events', {
    headers: { Authorization: `Token token=${integration.key}` },
    data: {
      event_action: 'trigger',
      dedup_key: randomUUID(),
      payload: {
        summary: 'Prod alias test',
        source: 'browser-certification',
        severity: 'warning',
        custom_details: { environment: 'PROD' },
      },
    },
  });
  expect(prodResponse.status()).toBe(202);
  const prodJson = (await prodResponse.json()) as {
    data: { result: { incident: { id: string } } };
  };
  const prodIncident = await db.incident.findUniqueOrThrow({
    where: { id: prodJson.data.result.incident.id },
  });
  expect(prodIncident.priority).not.toBe('P1');

  // Ingest alert with 'staging': does not equal 'production', so NE condition is TRUE, priority elevated to P1!
  const stagingResponse = await page.request.post('/api/events', {
    headers: { Authorization: `Token token=${integration.key}` },
    data: {
      event_action: 'trigger',
      dedup_key: randomUUID(),
      payload: {
        summary: 'Staging test',
        source: 'browser-certification',
        severity: 'warning',
        custom_details: { environment: 'staging' },
      },
    },
  });
  expect(stagingResponse.status()).toBe(202);
  const stagingJson = (await stagingResponse.json()) as {
    data: { result: { incident: { id: string } } };
  };
  const stagingIncident = await db.incident.findUniqueOrThrow({
    where: { id: stagingJson.data.result.incident.id },
  });
  expect(stagingIncident.priority).toBe('P1');

  await db.service.delete({ where: { id: service.id } }).catch(() => {});
});

test('BUG-10: displayOnly field flag suppresses UNUSED_FIELD lint warnings', async () => {
  // Test without displayOnly: UNUSED_FIELD warning emitted
  const snapshotWithout = {
    schemaVersion: 1 as const,
    fields: [
      {
        fieldId: 'audit-id',
        key: 'audit_id',
        label: 'Audit ID',
        type: 'STRING' as const,
        caseSensitive: false,
        aliases: {},
        mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.audit_id' }],
      },
    ],
    rules: [],
  };
  const resultWithout = compileAutomation(snapshotWithout);
  const unusedWarningWithout = resultWithout.issues.find(
    i => i.code === 'UNUSED_FIELD' && i.message.includes('Audit ID')
  );
  expect(unusedWarningWithout).toBeDefined();

  // Test with displayOnly: true: UNUSED_FIELD warning suppressed
  const snapshotWith = {
    schemaVersion: 1 as const,
    fields: [
      {
        fieldId: 'audit-id',
        key: 'audit_id',
        label: 'Audit ID',
        type: 'STRING' as const,
        caseSensitive: false,
        displayOnly: true,
        aliases: {},
        mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.audit_id' }],
      },
    ],
    rules: [],
  };
  const resultWith = compileAutomation(snapshotWith);
  const unusedWarningWith = resultWith.issues.find(
    i => i.code === 'UNUSED_FIELD' && i.message.includes('Audit ID')
  );
  expect(unusedWarningWith).toBeUndefined();
});

test('BUG-12: RemoveFieldDialog warns on referenced field and allows navigating to rules', async ({
  page,
}, testInfo) => {
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken: csrf.csrfToken, email, password, json: 'true' },
  });

  const service = await db.service.create({
    data: { name: `Remove Field Journey ${randomUUID()}` },
  });

  const snapshot = {
    schemaVersion: 1 as const,
    fields: [
      {
        fieldId: 'cluster-field',
        key: 'cluster_name',
        label: 'Cluster Name',
        type: 'STRING' as const,
        caseSensitive: false,
        aliases: {},
        mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.cluster' }],
      },
    ],
    rules: [
      {
        id: 'rule-cluster-prod',
        name: 'Route production cluster',
        phase: 'ROUTE' as const,
        enabled: true,
        conditions: [{ fieldKey: 'cluster_name', operator: 'EQ' as const, value: 'prod-cluster' }],
        actions: [{ type: 'NO_ESCALATION' as const }],
      },
    ],
  };

  await db.automationDraft.create({
    data: { serviceId: service.id, snapshot, revision: 1, updatedBy: 'cert-fixture' },
  });

  await page.goto(
    isDesktop(testInfo)
      ? `/services/${service.id}?tab=automation`
      : `/m/services/${service.id}/automation`
  );

  const workspace = page.getByRole('region', { name: 'Service automation' });
  await workspace.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(workspace.getByText('Cluster Name', { exact: true })).toBeVisible();

  // Click Remove field button on the Cluster Name field
  await workspace.getByRole('button', { name: 'Remove field', exact: true }).click();

  // Dialog should open stating the field is used by 1 rule
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('used by 1 rule');

  // Click "View affected rules"
  const viewAffectedBtn = dialog.getByRole('button', { name: 'View affected rules' });
  await expect(viewAffectedBtn).toBeVisible();
  await viewAffectedBtn.click();

  // Dialog should be dismissed and user transitioned to Rules view with the rule visible
  await expect(dialog).not.toBeVisible();
  await expect(
    workspace.getByRole('button', { name: 'Configure Route production cluster', exact: true })
  ).toBeVisible();

  await db.service.delete({ where: { id: service.id } }).catch(() => {});
});

test('Interactive Workspace Accessibility (WCAG 2.1 AA) and responsive layouts', async ({
  page,
}, testInfo) => {
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken: csrf.csrfToken, email, password, json: 'true' },
  });

  await page.goto(
    isDesktop(testInfo)
      ? `/services/${serviceId}?tab=automation`
      : `/m/services/${serviceId}/automation`
  );

  const workspace = page.getByRole('region', { name: 'Service automation' });
  await expect(workspace.getByRole('heading', { name: /Automation/ })).toBeVisible();

  // WCAG 2.1 AA accessibility audit
  const accessibility = await new AxeBuilder({ page })
    .include('[aria-label="Service automation"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  expect(accessibility.violations).toEqual([]);

  // Responsive assertion: no horizontal scrollbar overflow
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 2
  );
  expect(noOverflow).toBe(true);
});
