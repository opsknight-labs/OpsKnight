import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IncidentStatus } from '@prisma/client';
import { createTestIncident, createTestService, testPrisma as db } from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

async function incidentWith(status: IncidentStatus, extra: Record<string, unknown> = {}) {
  const service = await createTestService('Incident approval');
  const incident = await createTestIncident('Approval incident', service.id, {
    status,
    ...(status === 'SNOOZED' ? { snoozedUntil: new Date(Date.now() + 3600000) } : {}),
    ...extra,
  });
  return { incidentId: incident.id };
}
const incidentStatus = async (_f: Fixture, s: Record<string, string>) =>
  (await db.incident.findUniqueOrThrow({ where: { id: s.incidentId } })).status;

// Lifecycle routes take no If-Match; the frozen expectedStatus is what binds the reviewed
// transition. A status that is neither expectedStatus nor the target makes it stale.
const lifecycleStaleStatus: Record<string, IncidentStatus> = {
  reopenIncident: 'ACKNOWLEDGED',
  snoozeIncident: 'ACKNOWLEDGED',
  suppressIncident: 'ACKNOWLEDGED',
  unacknowledgeIncident: 'RESOLVED',
  unsnoozeIncident: 'ACKNOWLEDGED',
  unsuppressIncident: 'ACKNOWLEDGED',
};

function lifecycle(
  operationId: string,
  from: IncidentStatus,
  extraBody: () => Record<string, unknown> = () => ({})
): Scenario {
  return {
    name: `${operationId} from ${from}`,
    operationId,
    setup: async () => incidentWith(from),
    input: async (_f, s) => ({
      args: {
        path: { id: s.incidentId },
        body: { expectedStatus: from, note: 'Reviewed transition', ...extraBody() },
      },
    }),
    effect: incidentStatus,
  };
}

const customFieldRevision = async (fieldId: string) =>
  (await db.customField.findUniqueOrThrow({ where: { id: fieldId } })).revision;
const templateRevision = async (templateId: string) =>
  (await db.incidentTemplate.findUniqueOrThrow({ where: { id: templateId } })).revision;

const scenarios: Scenario[] = [
  {
    name: 'update custom field definition',
    operationId: 'updateCustomFieldDefinition',
    setup: async () => {
      const field = await db.customField.create({
        data: { name: 'Original name', key: unique('approval'), type: 'TEXT' },
      });
      return { fieldId: field.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.fieldId },
        body: { name: 'Reviewed name', showInList: true },
        ifMatch: `"${await customFieldRevision(s.fieldId)}"`,
      },
    }),
    effect: async (_f, s) => {
      const field = await db.customField.findUniqueOrThrow({ where: { id: s.fieldId } });
      return [field.revision, field.name, field.showInList];
    },
    invalidate: async (_f, s) => {
      await db.customField.update({ where: { id: s.fieldId }, data: { order: 42 } });
    },
  },
  {
    name: 'create custom field definition',
    operationId: 'createCustomFieldDefinition',
    setup: async () => ({ key: unique('created') }),
    input: async (_f, s) => ({
      args: { body: { name: 'Reviewed field', key: s.key, type: 'SELECT', options: ['a', 'b'] } },
    }),
    effect: async (_f, s) =>
      (await db.customField.findMany({ where: { key: s.key } })).map(field => [
        field.name,
        field.type,
        field.options,
      ]),
  },
  {
    name: 'update incident template',
    operationId: 'updateIncidentTemplate',
    setup: async f => {
      const template = await db.incidentTemplate.create({
        data: { name: unique('template'), title: 'Original title', createdById: f.user.id },
      });
      return { templateId: template.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { templateId: s.templateId },
        body: { title: 'Reviewed title', defaultPriority: 'P2' },
        ifMatch: `"${await templateRevision(s.templateId)}"`,
      },
    }),
    effect: async (_f, s) => {
      const template = await db.incidentTemplate.findUniqueOrThrow({
        where: { id: s.templateId },
      });
      return [template.revision, template.title, template.defaultPriority];
    },
    invalidate: async (_f, s) => {
      await db.incidentTemplate.update({
        where: { id: s.templateId },
        data: { description: 'moved on' },
      });
    },
  },
  {
    name: 'create incident template',
    operationId: 'createIncidentTemplate',
    // Template names are globally unique, so every setup reviews a fresh one.
    setup: async () => ({ name: unique('created-template') }),
    input: async (_f, s) => ({
      args: { body: { name: s.name, title: 'Reviewed template', defaultUrgency: 'LOW' } },
    }),
    effect: async (_f, s) =>
      (await db.incidentTemplate.findMany({ where: { name: s.name } })).map(template => [
        template.title,
        template.defaultUrgency,
      ]),
  },
  // A withV2Observability route: committing at all proves it reached the shared idempotency
  // path, since otherwise the approval guard never runs (MCP_APPROVAL_GUARD_NOT_ENFORCED).
  {
    name: 'update incident',
    operationId: 'updateIncident',
    setup: async () => incidentWith('OPEN', { priority: 'P4' }),
    input: async (_f, s) => ({
      args: { path: { id: s.incidentId }, body: { title: 'Reviewed title', priority: 'P2' } },
    }),
    effect: async (_f, s) => {
      const incident = await db.incident.findUniqueOrThrow({ where: { id: s.incidentId } });
      return [incident.title, incident.priority];
    },
  },
  lifecycle('reopenIncident', 'RESOLVED'),
  lifecycle('snoozeIncident', 'OPEN', () => ({
    snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
  })),
  lifecycle('suppressIncident', 'OPEN'),
  lifecycle('unacknowledgeIncident', 'ACKNOWLEDGED'),
  lifecycle('unsnoozeIncident', 'SNOOZED'),
  lifecycle('unsuppressIncident', 'SUPPRESSED'),
  {
    name: 'set incident custom field',
    operationId: 'setIncidentCustomField',
    setup: async () => {
      const { incidentId } = await incidentWith('OPEN');
      const field = await db.customField.create({
        data: { name: 'Region', key: unique('region'), type: 'TEXT' },
      });
      return { incidentId, fieldId: field.id };
    },
    input: async (_f, s) => ({
      args: { path: { id: s.incidentId, fieldId: s.fieldId }, body: { value: 'eu-west-1' } },
    }),
    effect: async (_f, s) =>
      (
        await db.customFieldValue.findMany({
          where: { incidentId: s.incidentId, customFieldId: s.fieldId },
        })
      ).map(row => row.value),
  },
];

describeApprovalScenarios(scenarios);

const byId = (operationId: string) =>
  scenarios.find(scenario => scenario.operationId === operationId)!;

describe('incident approval batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: {
            id: 'cmcpgenericdispatch0000001',
            templateId: 'cmcpgenericdispatch0000002',
            fieldId: 'cmcpgenericdispatch0000003',
          },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  // These routes take no revision precondition. What binds the frozen request instead is the
  // reviewed digest of the exact arguments (a review of any other change cannot approve it) and
  // the durable per-approval commit key: once committed, a later out-of-band change is never
  // overwritten by re-running the frozen request.
  describe.each([
    {
      operationId: 'updateIncident',
      drift: async (s: Record<string, string>) => {
        await db.incident.update({ where: { id: s.incidentId }, data: { title: 'Out of band' } });
      },
    },
    {
      operationId: 'setIncidentCustomField',
      drift: async (s: Record<string, string>) => {
        await db.customFieldValue.updateMany({
          where: { incidentId: s.incidentId, customFieldId: s.fieldId },
          data: { value: 'out-of-band' },
        });
      },
    },
    {
      operationId: 'createCustomFieldDefinition',
      drift: async (s: Record<string, string>) => {
        await db.customField.deleteMany({ where: { key: s.key } });
      },
    },
    {
      operationId: 'createIncidentTemplate',
      drift: async (s: Record<string, string>) => {
        await db.incidentTemplate.deleteMany({ where: { name: s.name } });
      },
    },
  ])('$operationId without a revision precondition', ({ operationId, drift }) => {
    it('binds the reviewed arguments and never re-applies a committed request', async () => {
      const scenario = byId(operationId);
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const approval = await prepareMcpOperation(f.ctx(), {
        operationId,
        args,
        idempotencyKey: prepareKey(),
      });
      const other = await prepareMcpOperation(f.ctx(), {
        operationId,
        args: { ...args, body: { ...(args.body as object), ...differentBody(operationId) } },
        idempotencyKey: prepareKey(),
      });
      expect(other.operationDigest).not.toBe(approval.operationDigest);
      await expect(
        f.review({ approvalId: approval.approvalId, operationDigest: other.operationDigest })
      ).rejects.toThrow('MCP_APPROVAL_PLAN_CHANGED');
      await f.review(approval);
      await commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId });
      await drift(s);
      const drifted = JSON.stringify(await scenario.effect(f, s));
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).resolves.toMatchObject({ status: 'COMMITTED', replayed: true });
      expect(JSON.stringify(await scenario.effect(f, s))).toBe(drifted);
    });
  });
});

// INCIDENT_TRANSITION_CONFLICT is a 409, which the approval treats as possibly transient: the
// commit is refused without effect and the approval stays EXECUTING (retryable), not FAILED.
describe.each(Object.entries(lifecycleStaleStatus))(
  '%s binds the reviewed expectedStatus',
  (operationId, staleStatus) => {
    it('refuses the frozen transition without effect once the incident has moved on', async () => {
      const scenario = byId(operationId);
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const approval = await prepareMcpOperation(f.ctx(), {
        operationId,
        args,
        idempotencyKey: prepareKey(),
      });
      await f.review(approval);
      await db.incident.update({ where: { id: s.incidentId }, data: { status: staleStatus } });
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).rejects.toMatchObject({ code: 'MCP_DOMAIN_REJECTED', status: 409 });
      expect(await scenario.effect(f, s)).toBe(staleStatus);
      expect(
        await db.auditLog.count({ where: { entityId: s.incidentId, entityType: 'INCIDENT' } })
      ).toBe(0);
      expect(
        (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: approval.approvalId } }))
          .status
      ).not.toBe('COMMITTED');
    });
  }
);

function differentBody(operationId: string): Record<string, unknown> {
  switch (operationId) {
    case 'updateIncident':
      return { title: 'A different change' };
    case 'setIncidentCustomField':
      return { value: 'us-east-1' };
    case 'createIncidentTemplate':
      return { title: 'A different template' };
    default:
      return { name: 'A different field' };
  }
}
