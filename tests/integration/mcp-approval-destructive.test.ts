import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  testPrisma as db,
} from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { createServiceBinding } from '@/lib/runbooks/bindings';
import { emptySnapshot } from '@/lib/automation/contract';
import { publishVersion, saveDraft } from '@/lib/automation/versioning';
import { publishStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

type State = Record<string, string>;
const unique = () => randomUUID().slice(0, 8);
const etag = (revision: number) => `"${revision}"`;

async function ruleFixture(f: Fixture) {
  const service = await createTestService('Detach approval');
  const runbook = await createRunbook(
    {
      name: 'Detach approval runbook',
      slug: `detach-approval-${randomUUID()}`,
      description: '',
      definition: {
        steps: [
          { key: 'check', name: 'Check', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} },
        ],
      },
    },
    f.user.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, f.user.id);
  const rule = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      mode: 'AUTOMATIC',
      enabled: true,
    },
    { id: f.user.id, apiKeyId: 'fixture' },
    { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] },
    version.id
  );
  return { serviceId: service.id, ruleId: rule.id };
}
const ruleRevision = async (s: State) =>
  (await db.serviceAutomationRule.findUniqueOrThrow({ where: { id: s.ruleId } }))
    .configurationRevision;

const draftRevision = async (serviceId: string) =>
  (await db.automationDraft.findUnique({ where: { serviceId } }))?.revision ?? 0;
/** A LIVE service with an active version and a staged candidate (the thing discard removes). */
async function candidateFixture(actorId: string) {
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const service = await createTestService('Candidate approval');
  const draft = await saveDraft({
    serviceId: service.id,
    actorId,
    snapshot: emptySnapshot,
    expectedRevision: 0,
  });
  const active = await publishVersion({
    serviceId: service.id,
    actorId,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await db.serviceAutomationConfig.update({
    where: { serviceId: service.id },
    data: { mode: 'LIVE' },
  });
  const candidate = await publishVersion({
    serviceId: service.id,
    actorId,
    expectedRevision: draft.revision,
    expectedActiveVersionId: active.id,
    expectedCandidateVersionId: null,
  });
  return { serviceId: service.id, activeId: active.id, candidateId: candidate.id, actorId };
}

const scenarios: Scenario[] = [
  {
    name: 'custom field definition',
    operationId: 'deleteCustomFieldDefinition',
    setup: async () => {
      const field = await db.customField.create({
        data: { name: 'Approval field', key: `approval_${unique()}`, type: 'TEXT' },
      });
      return { id: field.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        ifMatch: etag((await db.customField.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => db.customField.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.customField.update({
        where: { id: s.id },
        data: { name: 'Renamed out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'report dashboard',
    operationId: 'deleteReportDashboard',
    setup: async f => {
      const dashboard = await db.dashboard.create({
        data: { name: 'Approval dashboard', layout: {}, userId: f.user.id },
      });
      return { id: dashboard.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        ifMatch: etag((await db.dashboard.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => db.dashboard.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.dashboard.update({
        where: { id: s.id },
        data: { name: 'Renamed out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'incident template',
    operationId: 'deleteIncidentTemplate',
    setup: async f => {
      const template = await db.incidentTemplate.create({
        data: { name: `Approval template ${unique()}`, title: 'Template', createdById: f.user.id },
      });
      return { id: template.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { templateId: s.id },
        ifMatch: etag(
          (await db.incidentTemplate.findUniqueOrThrow({ where: { id: s.id } })).revision
        ),
      },
    }),
    effect: async (_f, s) => db.incidentTemplate.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.incidentTemplate.update({
        where: { id: s.id },
        data: { title: 'Retitled out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'saved report',
    operationId: 'deleteSavedReport',
    setup: async f => {
      const report = await db.savedReport.create({
        data: { name: 'Approval report', metricKeys: ['mtta'], userId: f.user.id },
      });
      return { id: report.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        ifMatch: etag((await db.savedReport.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => db.savedReport.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.savedReport.update({
        where: { id: s.id },
        data: { name: 'Renamed out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'schedule layer',
    operationId: 'deleteScheduleLayer',
    setup: async () => {
      const schedule = await createTestOnCallSchedule('Layer approval', [{ name: 'Primary' }]);
      return { scheduleId: schedule.id, layerId: schedule.layers[0].id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.scheduleId, layerId: s.layerId },
        ifMatch: etag(
          (await db.onCallLayer.findUniqueOrThrow({ where: { id: s.layerId } })).revision
        ),
      },
    }),
    effect: async (_f, s) => db.onCallLayer.count({ where: { id: s.layerId } }),
    invalidate: async (_f, s) => {
      await db.onCallLayer.update({
        where: { id: s.layerId },
        data: { name: 'Renamed out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'service runbook rule',
    operationId: 'detachServiceRunbookRule',
    setup: async f => ruleFixture(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId, ruleId: s.ruleId },
        body: {},
        ifMatch: etag(await ruleRevision(s)),
      },
    }),
    // Detach is a soft delete: the rule row stays as evidence.
    effect: async (_f, s) =>
      db.serviceAutomationRule.count({ where: { id: s.ruleId, detachedAt: null } }),
    invalidate: async (_f, s) => {
      await db.serviceAutomationRule.update({
        where: { id: s.ruleId },
        data: { configurationRevision: { increment: 1 } },
      });
    },
  },
  {
    name: 'automation candidate',
    operationId: 'discardAutomationCandidate',
    setup: async f => candidateFixture(f.user.id),
    // No If-Match: the expected candidate id in the body is the route's fence.
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId },
        body: { expectedCandidateVersionId: s.candidateId },
      },
    }),
    effect: async (_f, s) => {
      const config = await db.serviceAutomationConfig.findUniqueOrThrow({
        where: { serviceId: s.serviceId },
      });
      return [config.activeVersionId === s.activeId, config.candidateVersionId];
    },
    invalidate: async (_f, s) => {
      // Staging a newer candidate replaces the reviewed one.
      await publishVersion({
        serviceId: s.serviceId,
        actorId: s.actorId,
        expectedRevision: await draftRevision(s.serviceId),
        expectedActiveVersionId: s.activeId,
        expectedCandidateVersionId: s.candidateId,
      });
    },
  },
  {
    name: 'integration',
    operationId: 'deleteIntegration',
    setup: async () => {
      const service = await createTestService('Integration approval');
      const integration = await db.integration.create({
        data: { name: 'Approval integration', key: randomUUID(), serviceId: service.id },
      });
      return { id: integration.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        ifMatch: etag((await db.integration.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => db.integration.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.integration.update({
        where: { id: s.id },
        data: { name: 'Renamed out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'status page privacy',
    operationId: 'updateStatusPagePrivacy',
    setup: async () => {
      const id = randomUUID();
      const page = await db.statusPage.create({
        data: { name: `Privacy approval ${id}`, slug: `privacy-${id}`, enabled: true },
      });
      await publishStatusPageSnapshot(page.id);
      return { pageId: page.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.pageId },
        body: { showIncidentTitles: false },
        ifMatch: etag(
          (await db.statusPage.findUniqueOrThrow({ where: { id: s.pageId } })).revision
        ),
      },
    }),
    effect: async (_f, s) => {
      const page = await db.statusPage.findUniqueOrThrow({ where: { id: s.pageId } });
      return [page.showIncidentTitles, page.revision];
    },
    // The revision trigger bumps on any StatusPage update.
    invalidate: async (_f, s) => {
      await db.statusPage.update({ where: { id: s.pageId }, data: { updatedAt: new Date() } });
    },
  },
  {
    name: 'escalation policy',
    operationId: 'deleteEscalationPolicy',
    setup: async () => {
      const policy = await createTestEscalationPolicy(`Approval policy ${unique()}`, []);
      return { id: policy.id };
    },
    // Natural delete with no If-Match: the reviewed preview (updatedAt/revision) binds it.
    input: async (_f, s) => ({ args: { path: { id: s.id } } }),
    effect: async (_f, s) => db.escalationPolicy.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.escalationPolicy.update({
        where: { id: s.id },
        data: { description: 'Edited out of band' },
      });
    },
  },
  {
    name: 'postmortem',
    operationId: 'deletePostmortem',
    setup: async f => {
      const service = await createTestService('Postmortem approval');
      const incident = await createTestIncident('Postmortem approval incident', service.id, {
        status: 'RESOLVED',
      });
      const postmortem = await db.postmortem.create({
        data: { incidentId: incident.id, title: 'Approval postmortem', createdById: f.user.id },
      });
      return { id: postmortem.id };
    },
    // If-Match is optional on this route; the approval always freezes it.
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        ifMatch: etag((await db.postmortem.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => db.postmortem.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.postmortem.update({
        where: { id: s.id },
        data: { summary: 'Edited out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'schedule',
    operationId: 'deleteSchedule',
    setup: async () => ({ id: (await createTestOnCallSchedule('Schedule approval')).id }),
    input: async (_f, s) => ({ args: { path: { id: s.id } } }),
    effect: async (_f, s) => db.onCallSchedule.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.onCallSchedule.update({
        where: { id: s.id },
        data: { name: `Renamed out of band ${unique()}` },
      });
    },
  },
  {
    name: 'service',
    operationId: 'deleteService',
    setup: async () => ({ id: (await createTestService('Service approval')).id }),
    input: async (_f, s) => ({ args: { path: { id: s.id } } }),
    effect: async (_f, s) => db.service.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.service.update({ where: { id: s.id }, data: { description: 'Edited out of band' } });
    },
  },
  {
    name: 'team',
    operationId: 'deleteTeam',
    // A fresh team with no services or members, unlike the fixture's team.
    setup: async () => ({ id: (await createTestTeam('Team approval')).id }),
    input: async (_f, s) => ({ args: { path: { id: s.id } } }),
    effect: async (_f, s) => db.team.count({ where: { id: s.id } }),
    invalidate: async (_f, s) => {
      await db.team.update({ where: { id: s.id }, data: { description: 'Edited out of band' } });
    },
  },
];

describeApprovalScenarios(scenarios);

describe('destructive batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: {
            id: 'cmcpgenericdispatch0000001',
            layerId: 'cmcpgenericdispatch0000002',
            ruleId: 'cmcpgenericdispatch0000003',
            templateId: 'cmcpgenericdispatch0000004',
          },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        }),
        scenario.operationId
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  it.each(scenarios)(
    'records a verified postcondition after committing $operationId',
    async scenario => {
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const approval = await prepareMcpOperation(f.ctx(), {
        operationId: scenario.operationId,
        args,
        idempotencyKey: prepareKey(),
      });
      await f.review(approval);
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).resolves.toMatchObject({ status: 'COMMITTED' });
      const stored = await db.mcpOperationApproval.findUniqueOrThrow({
        where: { id: approval.approvalId },
      });
      expect(stored.outcome).toMatchObject({ ok: true, postcondition: 'VERIFIED' });
    }
  );
});
