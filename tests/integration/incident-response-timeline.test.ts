import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestIncident,
  createTestUser,
} from '../helpers/test-db';
import { buildResponseContext } from '@/lib/automation/response-context';

vi.mock('@/lib/rbac', () => ({
  assertCanViewIncident: vi.fn(async () => ({})),
  getUserPermissions: vi.fn(async () => ({ capabilities: [] })),
}));

import { getIncidentResponseTimeline } from '@/lib/incidents/response-timeline';

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute));

async function seed() {
  const actor = await createTestUser({ role: 'ADMIN', name: 'Carol Approver' });
  const service = await createTestService('Response timeline');
  const version = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 2,
      schemaVersion: 1,
      snapshot: { schemaVersion: 1, fields: [], rules: [] },
      compiledSnapshot: { schemaVersion: 1, fields: [], rules: [] },
      checksum: 'fixture',
      publishedBy: actor.id,
      lintReport: [],
    },
  });
  const incident = await createTestIncident('Checkout latency', service.id, {
    status: 'RESOLVED',
    createdAt: at(0),
    acknowledgedAt: at(3),
    resolvedAt: at(20),
    resolutionKind: 'AUTOMATION',
  });
  const context = buildResponseContext({
    versionId: version.id,
    versionNumber: 2,
    fields: [
      { fieldId: 'f-host', key: 'host', type: 'STRING' },
      { fieldId: 'f-region', key: 'region', type: 'STRING' },
    ],
    inputContext: { host: { state: 'RECOGNIZED', value: 'web-01' } },
    enrichedContext: {
      host: { state: 'RECOGNIZED', value: 'web-01' },
      region: { state: 'RECOGNIZED', value: 'eu-secret-region' },
    },
  } as Parameters<typeof buildResponseContext>[0]);
  await db.incidentAutomationDecision.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      versionId: version.id,
      mode: 'LIVE',
      routeType: 'SERVICE_DEFAULT',
      matchedRouteRuleName: 'Checkout route',
      basePriority: 'P3',
      finalPriority: 'P2',
      evaluationAt: at(0),
      summary: {},
      responseContext: context as unknown as Prisma.InputJsonValue,
    },
  });
  await db.incidentEvent.createMany({
    data: [
      {
        incidentId: incident.id,
        type: 'ESCALATED',
        message: 'Escalated to Alice (Level 1)',
        createdAt: at(1),
      },
      {
        incidentId: incident.id,
        type: 'ACKNOWLEDGED',
        message: 'Incident acknowledged',
        createdAt: at(3),
      },
      {
        incidentId: incident.id,
        type: 'RUNBOOK_SKIPPED',
        message: 'Runbook skipped: automation context unavailable (FALLBACK) for Disk cleanup',
        createdAt: at(4),
      },
      {
        incidentId: incident.id,
        type: 'RUNBOOK_VERIFIED',
        message: 'Recovery verified',
        createdAt: at(16),
      },
      {
        incidentId: incident.id,
        type: 'MANUAL_RESOLVED',
        message: 'Resolved after verified recovery: Restart web',
        createdAt: at(20),
      },
      { incidentId: incident.id, type: 'COMMENT', message: 'unrelated note', createdAt: at(5) },
    ],
  });
  const runbook = await db.runbook.create({
    data: { name: 'Restart web', slug: `restart-web-${crypto.randomUUID()}` },
  });
  const runbookVersion = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      definition: { steps: [] },
      checksum: 'b'.repeat(64),
      publishedAt: at(0),
    },
  });
  await db.runbookExecution.create({
    data: {
      runbookId: runbook.id,
      runbookVersionId: runbookVersion.id,
      incidentId: incident.id,
      serviceId: service.id,
      status: 'SUCCEEDED',
      triggeredByType: 'TRIGGER',
      startedAt: at(6),
      completedAt: at(15),
      deadlineAt: at(60),
      definitionChecksum: 'b'.repeat(64),
      targetSelection: {
        selector: { host: '${{ context.host }}' },
        resolvedLabels: { host: 'web-01' },
        contextKeys: ['host'],
        poolId: null,
      },
      responseContext: context as unknown as Prisma.InputJsonValue,
      unattendedWritesAuthorized: false,
      recoveryOutcome: 'RESOLVED',
      recoveryCheckedAt: at(19),
      createdAt: at(6),
      steps: {
        create: [
          {
            stepKey: 'restart',
            sequence: 0,
            name: 'Restart service',
            type: 'HTTP',
            riskClass: 'IDEMPOTENT_WRITE',
            status: 'SUCCEEDED',
            requiresApproval: true,
            approvedAt: at(9),
            approvedById: actor.id,
            verificationResult: {
              verified: true,
              checkKeys: ['verify'],
              capturedAt: at(14).toISOString(),
              reason: 'Health checks passed',
              differences: [],
            },
          },
        ],
      },
    },
  });
  return { incident };
}

it('projects the persisted response lanes for a responder', async () => {
  const { incident } = await seed();
  const timeline = await getIncidentResponseTimeline(incident.id, {
    capabilities: ['automation.read', 'incident.sensitive.read', 'runbook.read.all'],
  });
  expect(timeline).not.toBeNull();
  const titles = timeline!.entries.map(entry => `${entry.lane}:${entry.title}`);
  expect(titles).toEqual(
    expect.arrayContaining([
      'ROUTING:Incident triggered',
      'ROUTING:Matched rule: Checkout route',
      'REMEDIATION:Runbook skipped',
      'REMEDIATION:Runbook started: Restart web',
      'REMEDIATION:Step approved: Restart service',
      'REMEDIATION:Runbook succeeded: Restart web',
      'VERIFICATION:Verified: Restart service',
      'VERIFICATION:Recovery verified',
      'RECOVERY:Acknowledged',
      'RECOVERY:Resolved after verified recovery: Restart web',
      'RECOVERY:Resolved',
    ])
  );
  expect(titles.some(title => title.includes('unrelated note'))).toBe(false);
  const started = timeline!.entries.find(entry => entry.title === 'Runbook started: Restart web');
  expect(started?.facts).toEqual(
    expect.arrayContaining([
      { label: 'Target labels', value: 'host=web-01' },
      { label: 'Context keys', value: 'host' },
      { label: 'Write actions', value: 'Approval required' },
    ])
  );
  expect(timeline!.entries.find(entry => entry.title === 'Resolved')).toMatchObject({
    resolutionKind: 'AUTOMATION',
  });
  expect(timeline!.context).toMatchObject({
    visibility: 'VISIBLE',
    status: 'AVAILABLE',
    versionNumber: 2,
  });
  expect(JSON.stringify(timeline!.context)).toContain('eu-secret-region');
});

it('links entries to persisted records and flags human intervention on open NO_ESCALATION incidents', async () => {
  const { incident } = await seed();
  const responder = ['automation.read', 'incident.sensitive.read', 'runbook.read.all'];
  const resolved = await getIncidentResponseTimeline(incident.id, { capabilities: responder });
  const execution = await db.runbookExecution.findFirstOrThrow({
    where: { incidentId: incident.id },
  });
  expect(resolved!.entries.find(entry => entry.kind === 'ROUTING_DECISION')?.record).toEqual({
    type: 'DECISION',
    id: incident.id,
  });
  expect(
    resolved!.entries.find(entry => entry.title === 'Runbook started: Restart web')?.record
  ).toEqual({ type: 'EXECUTION', id: execution.id });
  expect(resolved!.humanInterventionRequired).toBe(false);

  await db.incident.update({
    where: { id: incident.id },
    data: { status: 'OPEN', resolvedAt: null, resolutionKind: null },
  });
  await db.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: 'RUNBOOK_UNVERIFIED',
      message: 'Human intervention required: no responder is paged for this incident.',
      createdAt: at(30),
    },
  });
  const open = await getIncidentResponseTimeline(incident.id, { capabilities: responder });
  expect(open!.humanInterventionRequired).toBe(true);
  expect(open!.entries.at(-1)).toMatchObject({
    lane: 'RECOVERY',
    title: 'Human intervention required',
    tone: 'critical',
  });
  const scoped = await getIncidentResponseTimeline(incident.id, {
    capabilities: ['incident.read.scoped'],
  });
  expect(scoped!.humanInterventionRequired).toBe(false);
});

it('redacts context values for auditors and hides runbooks from scoped users', async () => {
  const { incident } = await seed();
  const auditor = await getIncidentResponseTimeline(incident.id, {
    capabilities: ['automation.read', 'incident.read.all', 'runbook.read.all'],
  });
  expect(JSON.stringify(auditor)).not.toContain('eu-secret-region');
  expect(JSON.stringify(auditor)).not.toContain('host=web-01');
  expect(auditor!.context).toMatchObject({ visibility: 'REDACTED', status: 'AVAILABLE' });

  const user = await getIncidentResponseTimeline(incident.id, {
    capabilities: ['incident.read.scoped'],
  });
  expect(user!.context).toEqual({ visibility: 'HIDDEN' });
  expect(user!.entries.some(entry => entry.lane === 'REMEDIATION')).toBe(false);
  expect(user!.entries.some(entry => entry.lane === 'VERIFICATION')).toBe(false);
  expect(user!.entries.some(entry => entry.kind === 'ROUTING_DECISION')).toBe(false);
});
