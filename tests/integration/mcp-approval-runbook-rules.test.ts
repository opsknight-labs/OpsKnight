import { describe, expect, it } from 'vitest';
import { createTestService, testPrisma as db } from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { activateServiceRule, createServiceBinding } from '@/lib/runbooks/bindings';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

async function runbookFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const service = await createTestService('Rule approval');
  const runbook = await createRunbook(
    {
      name: 'Rule approval runbook',
      slug: `rule-approval-${crypto.randomUUID()}`,
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
  const configuration = {
    runbookId: runbook.id,
    runbookVersionId: version.id,
    versionStrategy: 'PINNED' as const,
    mode: 'AUTOMATIC' as const,
    enabled: true,
  };
  const actor = { id: f.user.id, apiKeyId: 'fixture' };
  const trigger = {
    event: 'INCIDENT_CREATED' as const,
    enabled: true,
    conditionLogic: 'AND' as const,
    conditions: [],
  };
  return { service, runbook, version, configuration, actor, trigger };
}
async function existingRule(f: Awaited<ReturnType<typeof fixture>>, activate = false) {
  const r = await runbookFixture(f);
  const rule = await createServiceBinding(
    r.service.id,
    r.configuration,
    r.actor,
    r.trigger,
    r.version.id
  );
  if (activate) await activateServiceRule(r.service.id, rule.id, r.actor, true);
  return { serviceId: r.service.id, ruleId: rule.id, versionId: r.version.id, actorId: f.user.id };
}
const rule = (s: Record<string, string>) =>
  db.serviceAutomationRule.findUniqueOrThrow({ where: { id: s.ruleId } });
const revisionOf = async (s: Record<string, string>) => (await rule(s)).configurationRevision;
const bump = (s: Record<string, string>) =>
  db.serviceAutomationRule.update({
    where: { id: s.ruleId },
    data: { configurationRevision: { increment: 1 } },
  });

const scenarios: Scenario[] = [
  {
    name: 'create rule',
    operationId: 'createServiceRunbookRule',
    setup: async f => {
      const r = await runbookFixture(f);
      return {
        serviceId: r.service.id,
        runbookId: r.runbook.id,
        versionId: r.version.id,
        actorId: f.user.id,
      };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId },
        body: {
          configuration: {
            runbookId: s.runbookId,
            runbookVersionId: s.versionId,
            versionStrategy: 'PINNED',
            mode: 'AUTOMATIC',
            enabled: true,
          },
          trigger: { event: 'INCIDENT_CREATED', enabled: true, conditions: [] },
          expectedVersionId: s.versionId,
        },
      },
    }),
    effect: async (_f, s) =>
      (
        await db.serviceAutomationRule.findMany({
          where: { serviceId: s.serviceId, detachedAt: null },
        })
      ).map(row => [row.mode, row.enabled]),
  },
  {
    name: 'update rule',
    operationId: 'updateServiceRunbookRule',
    setup: async f => existingRule(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId, ruleId: s.ruleId },
        body: { configuration: { name: 'Approved rename' }, expectedVersionId: s.versionId },
        ifMatch: `"${await revisionOf(s)}"`,
      },
    }),
    effect: async (_f, s) => {
      const row = await rule(s);
      return [row.name, row.configurationRevision];
    },
    invalidate: async (_f, s) => {
      await bump(s);
    },
  },
  {
    name: 'pause rule',
    operationId: 'pauseServiceRunbookRule',
    setup: async f => existingRule(f, true),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId, ruleId: s.ruleId },
        body: {},
        ifMatch: `"${await revisionOf(s)}"`,
      },
    }),
    effect: async (_f, s) => (await rule(s)).enabled,
    invalidate: async (_f, s) => {
      await bump(s);
    },
  },
  {
    name: 'activate rule (automated remediation)',
    operationId: 'activateServiceRunbookRule',
    setup: async f => existingRule(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId, ruleId: s.ruleId },
        body: { confirmMatchAll: true },
        ifMatch: `"${await revisionOf(s)}"`,
      },
    }),
    effect: async (_f, s) => (await rule(s)).enabled,
    invalidate: async (_f, s) => {
      await bump(s);
    },
  },
];

describeApprovalScenarios(scenarios);

describe('runbook rule batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: { id: 'cmcpgenericdispatch0000001', ruleId: 'cmcpgenericdispatch0000002' },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  it('rejects a frozen create whose runbook version is no longer the reviewed one', async () => {
    const f = await fixture();
    const created = await scenarios[0].setup(f);
    const { args } = await scenarios[0].input(f, created);
    const body = args.body as { expectedVersionId: string };
    const prepared = await prepareMcpOperation(f.ctx(), {
      operationId: 'createServiceRunbookRule',
      args: { ...args, body: { ...body, expectedVersionId: 'cmcpstaleversion00000001' } },
      idempotencyKey: 'prepare-wrong-version-key',
    });
    await f.review(prepared);
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await scenarios[0].effect(f, created)).toEqual([]);
  });
});
