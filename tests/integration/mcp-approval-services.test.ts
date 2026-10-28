import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTestEscalationPolicy,
  createTestService,
  testPrisma as db,
} from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { compileAutomation } from '@/lib/automation/compiler';
import { emptySnapshot } from '@/lib/automation/contract';
import { checksum } from '@/lib/automation/cache';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { createServiceBinding } from '@/lib/runbooks/bindings';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import {
  commitApprovedMcpOperation,
  mcpApprovalCommitKey,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

const suffix = () => randomBytes(4).toString('hex');

// Objectives are immutable versions sharing a lineage; the REST ETag is version * 2.
async function objectiveFixture() {
  const service = await createTestService('Objective approval');
  const lineageId = `so_${randomUUID()}`;
  await db.serviceObjective.create({
    data: {
      id: lineageId,
      lineageId,
      serviceId: service.id,
      name: 'Availability goal',
      metricType: 'UPTIME',
      target: 99.9,
      comparator: 'GREATER_THAN_OR_EQUAL',
      windowType: 'SEVEN_DAYS',
    },
  });
  return { serviceId: service.id, lineageId, versionId: lineageId };
}
const activeObjective = (s: Record<string, string>) =>
  db.serviceObjective.findFirst({ where: { lineageId: s.lineageId, activeTo: null } });
const objectiveVersions = async (s: Record<string, string>) =>
  (
    await db.serviceObjective.findMany({
      where: { lineageId: s.lineageId },
      orderBy: { version: 'asc' },
    })
  ).map(row => [row.version, row.name, row.activeTo === null]);
// Out-of-band edit that retires version 1 and activates version 2 of the same lineage.
async function supersedeObjective(s: Record<string, string>) {
  const current = (await activeObjective(s))!;
  await db.serviceObjective.update({ where: { id: current.id }, data: { activeTo: new Date() } });
  const { id: _id, createdAt: _c, updatedAt: _u, activeFrom: _a, ...rest } = current;
  await db.serviceObjective.create({
    data: { ...rest, id: `so_${randomUUID()}`, name: 'Moved on', version: current.version + 1 },
  });
}

async function runbookRule(f: Fixture, agentStep = false) {
  const service = await createTestService('Rule approval');
  const runbook = await createRunbook(
    {
      name: 'Rule approval runbook',
      slug: `rule-approval-${randomUUID()}`,
      description: '',
      definition: {
        steps: [
          {
            key: 'check',
            name: 'Check',
            type: agentStep ? 'LINUX_DIAGNOSTICS' : 'MANUAL',
            riskClass: 'READ_ONLY',
            config: agentStep ? { action: 'summary' } : {},
          },
        ],
      },
    },
    f.user.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, f.user.id);
  const agent = agentStep
    ? await db.runbookAgent.create({
        data: {
          name: `Policy check Agent ${suffix()}`,
          status: 'ONLINE',
          lastHeartbeatAt: new Date(),
          policyHash: 'b'.repeat(64),
          capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
        },
      })
    : null;
  const rule = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      mode: 'AUTOMATIC',
      enabled: true,
      ...(agent ? { defaultAgentId: agent.id } : {}),
    },
    { id: f.user.id, apiKeyId: 'fixture' },
    { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] },
    version.id
  );
  return { serviceId: service.id, ruleId: rule.id };
}
const rule = (s: Record<string, string>) =>
  db.serviceAutomationRule.findUniqueOrThrow({
    where: { id: s.ruleId },
    include: { triggers: { orderBy: { id: 'asc' } } },
  });
const ruleRevision = async (s: Record<string, string>) =>
  `"${(await rule(s)).configurationRevision}"`;
const bumpRule = async (s: Record<string, string>) => {
  await db.serviceAutomationRule.update({
    where: { id: s.ruleId },
    data: { configurationRevision: { increment: 1 } },
  });
};

async function enableAutomation() {
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
}
function automationVersion(f: Fixture, serviceId: string, versionNumber: number) {
  const { compiled } = compileAutomation(emptySnapshot);
  return db.automationVersion.create({
    data: {
      serviceId,
      versionNumber,
      snapshot: emptySnapshot,
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      publishedBy: f.user.id,
      lintReport: [],
    },
  });
}
// A LIVE service with an active version and a published candidate waiting for promotion.
async function candidateFixture(f: Fixture) {
  await enableAutomation();
  const service = await createTestService('Candidate approval');
  const active = await automationVersion(f, service.id, 1);
  const candidate = await automationVersion(f, service.id, 2);
  await db.serviceAutomationConfig.create({
    data: {
      serviceId: service.id,
      mode: 'LIVE',
      activeVersionId: active.id,
      candidateVersionId: candidate.id,
    },
  });
  return { serviceId: service.id, activeId: active.id, candidateId: candidate.id };
}

const evaluationJobs = async (s: Record<string, string>) =>
  (
    await db.backgroundJob.findMany({
      where: { payload: { path: ['lineageId'], equals: s.lineageId } },
    })
  ).map(job => [job.status, (job.payload as { versionId: string }).versionId]);

const scenarios: Scenario[] = [
  {
    name: 'update objective',
    operationId: 'updateServiceObjective',
    setup: async () => objectiveFixture(),
    input: async (_f, s) => ({
      args: {
        path: { id: s.lineageId },
        body: { name: 'Reviewed goal', target: 99.5 },
        ifMatch: `"${(await activeObjective(s))!.version * 2}"`,
      },
    }),
    effect: async (_f, s) => objectiveVersions(s),
    invalidate: async (_f, s) => supersedeObjective(s),
  },
  {
    name: 'create objective',
    operationId: 'createServiceObjective',
    setup: async () => ({ serviceId: (await createTestService('Objective create')).id }),
    input: async (_f, s) => ({
      args: {
        body: {
          definition: {
            serviceId: s.serviceId,
            name: 'Reviewed availability',
            metricType: 'AVAILABILITY',
            target: 99,
            comparator: 'GREATER_THAN_OR_EQUAL',
            windowType: 'THIRTY_DAYS',
          },
          expectedActiveVersionId: null,
        },
      },
    }),
    effect: async (_f, s) =>
      (
        await db.serviceObjective.findMany({
          where: { serviceId: s.serviceId, metricType: 'AVAILABILITY', activeTo: null },
        })
      ).map(row => row.name),
    // The frozen expectedActiveVersionId (an empty slot) is the precondition.
    invalidate: async (_f, s) => {
      const lineageId = `so_${randomUUID()}`;
      await db.serviceObjective.create({
        data: {
          id: lineageId,
          lineageId,
          serviceId: s.serviceId,
          name: 'Moved on',
          metricType: 'AVAILABILITY',
          target: 95,
          comparator: 'GREATER_THAN_OR_EQUAL',
          windowType: 'SEVEN_DAYS',
        },
      });
    },
  },
  {
    name: 'archive objective',
    operationId: 'archiveServiceObjective',
    setup: async () => objectiveFixture(),
    input: async (_f, s) => ({
      args: {
        path: { id: s.lineageId },
        body: {},
        ifMatch: `"${(await activeObjective(s))!.version * 2}"`,
      },
    }),
    effect: async (_f, s) => objectiveVersions(s),
    invalidate: async (_f, s) => supersedeObjective(s),
  },
  {
    name: 'evaluate objective',
    operationId: 'evaluateServiceObjective',
    setup: async () => {
      // Admission is capped at sixteen active evaluation jobs workspace-wide; earlier
      // scenarios in this file leave theirs pending because no worker runs here.
      await db.backgroundJob.updateMany({
        where: {
          status: 'PENDING',
          payload: { path: ['task'], equals: 'SERVICE_OBJECTIVE_EVALUATE' },
        },
        data: { status: 'COMPLETED' },
      });
      return objectiveFixture();
    },
    input: async (_f, s) => ({
      args: { path: { id: s.lineageId }, body: { expectedVersionId: s.versionId } },
    }),
    effect: async (_f, s) => evaluationJobs(s),
  },
  {
    name: 'notification settings',
    operationId: 'updateServiceNotificationSettings',
    setup: async () => ({ serviceId: (await createTestService('Notify approval')).id }),
    input: async (_f, s) => {
      const service = await db.service.findUniqueOrThrow({ where: { id: s.serviceId } });
      return {
        args: {
          path: { id: s.serviceId },
          body: {
            serviceNotificationChannels: ['EMAIL', 'WEBHOOK'],
            serviceNotifyOnSlaBreach: !service.serviceNotifyOnSlaBreach,
          },
          ifMatch: `"${service.revision}"`,
        },
      };
    },
    effect: async (_f, s) => {
      const service = await db.service.findUniqueOrThrow({ where: { id: s.serviceId } });
      return [
        service.revision,
        service.serviceNotificationChannels,
        service.serviceNotifyOnSlaBreach,
      ];
    },
    invalidate: async (_f, s) => {
      await db.service.update({ where: { id: s.serviceId }, data: { description: 'moved on' } });
    },
  },
  {
    name: 'create service',
    operationId: 'createService',
    setup: async f => ({
      name: `Reviewed service ${suffix()}`,
      teamId: f.team.id,
      policyId: (await createTestEscalationPolicy(`Approval policy ${suffix()}`, [])).id,
    }),
    input: async (_f, s) => ({
      args: { body: { name: s.name, teamId: s.teamId, escalationPolicyId: s.policyId } },
    }),
    effect: async (_f, s) =>
      (await db.service.findMany({ where: { name: s.name } })).map(row => [
        row.teamId,
        row.escalationPolicyId,
      ]),
  },
  {
    name: 'activate automation candidate',
    operationId: 'activateAutomationCandidate',
    setup: async f => candidateFixture(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId },
        body: {
          expectedCandidateVersionId: s.candidateId,
          expectedActiveVersionId: s.activeId,
          acknowledgeNoShadow: true,
        },
      },
    }),
    effect: async (_f, s) => {
      const config = await db.serviceAutomationConfig.findUniqueOrThrow({
        where: { serviceId: s.serviceId },
      });
      return [config.activeVersionId, config.candidateVersionId];
    },
    // The frozen expected candidate/active version ids are the precondition.
    invalidate: async (f, s) => {
      const newer = await automationVersion(f, s.serviceId, 3);
      await db.serviceAutomationConfig.update({
        where: { serviceId: s.serviceId },
        data: { candidateVersionId: newer.id },
      });
    },
  },
  {
    name: 'duplicate runbook rule',
    operationId: 'duplicateServiceRunbookRule',
    setup: async f => runbookRule(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId, ruleId: s.ruleId },
        body: {},
        ifMatch: await ruleRevision(s),
      },
    }),
    effect: async (_f, s) =>
      (
        await db.serviceAutomationRule.findMany({
          where: { serviceId: s.serviceId, detachedAt: null },
          orderBy: { createdAt: 'asc' },
        })
      ).map(row => [row.name, row.enabled]),
    invalidate: async (_f, s) => bumpRule(s),
  },
  {
    name: 'request rule policy checks',
    operationId: 'requestRunbookRulePolicyChecks',
    setup: async f => runbookRule(f, true),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId, ruleId: s.ruleId },
        body: {},
        ifMatch: await ruleRevision(s),
      },
    }),
    effect: async (_f, s) =>
      (await db.runbookPolicyCheck.findMany({ where: { ruleId: s.ruleId } })).map(
        check => check.status
      ),
    invalidate: async (_f, s) => bumpRule(s),
  },
  {
    name: 'replace rule triggers',
    operationId: 'replaceRunbookRuleTriggers',
    setup: async f => runbookRule(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId, ruleId: s.ruleId },
        body: { event: 'INCIDENT_CREATED', conditionLogic: 'OR', enabled: false, conditions: [] },
        ifMatch: await ruleRevision(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await rule(s);
      return [
        row.configurationRevision,
        row.triggers.map(trigger => [trigger.conditionLogic, trigger.enabled]),
      ];
    },
    invalidate: async (_f, s) => bumpRule(s),
  },
  {
    name: 'create team',
    operationId: 'createTeam',
    setup: async () => ({ name: `Reviewed team ${suffix()}` }),
    input: async (_f, s) => ({ args: { body: { name: s.name, description: 'Reviewed' } } }),
    effect: async (_f, s) =>
      (await db.team.findMany({ where: { name: s.name } })).map(row => row.description),
  },
];

describeApprovalScenarios(scenarios);

const scenario = (operationId: string) =>
  scenarios.find(candidate => candidate.operationId === operationId)!;
async function approve(f: Fixture, operationId: string, s: Record<string, string>) {
  const { args } = await scenario(operationId).input(f, s);
  const prepared = await prepareMcpOperation(f.ctx(), {
    operationId,
    args,
    idempotencyKey: prepareKey(),
  });
  await f.review(prepared);
  return prepared;
}

describe('service batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const candidate of scenarios.map(s => s.operationId))
      await expect(
        callMcpOperation(f.ctx(), candidate, {
          path: { id: 'cmcpgenericdispatch0000001', ruleId: 'cmcpgenericdispatch0000002' },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  it.each(['createService', 'createTeam'])(
    'commits observability-wrapped %s through the shared idempotency receipt',
    async operationId => {
      const f = await fixture();
      const s = await scenario(operationId).setup(f);
      const prepared = await approve(f, operationId, s);
      await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
      expect(
        await db.backgroundJob.count({
          where: {
            id: {
              startsWith: 'idem:',
              endsWith: `:mcp:${f.grant.id}:${mcpApprovalCommitKey(prepared.approvalId)}`,
            },
          },
        })
      ).toBe(1);
      expect(await scenario(operationId).effect(f, s)).toHaveLength(1);
    }
  );

  // Evaluation has no If-Match: the frozen expectedVersionId names an immutable definition
  // version, so a later edit cannot change what the reviewed evaluation measures.
  it('evaluates exactly the reviewed immutable objective version after a later edit', async () => {
    const f = await fixture();
    const s = await scenario('evaluateServiceObjective').setup(f);
    const prepared = await approve(f, 'evaluateServiceObjective', s);
    await supersedeObjective(s);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(await evaluationJobs(s)).toEqual([['PENDING', s.versionId]]);
  });

  it('refuses a frozen service create once its escalation policy is gone', async () => {
    const f = await fixture();
    const s = await scenario('createService').setup(f);
    const prepared = await approve(f, 'createService', s);
    await db.escalationPolicy.delete({ where: { id: s.policyId } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
    expect(await scenario('createService').effect(f, s)).toEqual([]);
  });
});
