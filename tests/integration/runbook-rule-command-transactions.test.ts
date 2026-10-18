import { beforeEach, expect, it } from 'vitest';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import {
  createServiceBinding,
  updateServiceBinding,
  replaceBindingTrigger,
  duplicateServiceRule,
  pauseServiceRule,
  detachServiceBinding,
} from '@/lib/runbooks/bindings';
import { requestRulePolicyChecks } from '@/lib/runbooks/policy-checks';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});
async function fixture(agentStep = false) {
  const user = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Rule transaction fixture');
  const runbook = await createRunbook(
    {
      name: 'Rule transaction fixture',
      slug: `rule-tx-${crypto.randomUUID()}`,
      description: '',
      definition: {
        steps: [
          {
            key: 'check',
            name: 'Check',
            type: agentStep ? 'LINUX_DIAGNOSTICS' : 'MANUAL',
            config: agentStep ? { action: 'summary' } : {},
            riskClass: 'READ_ONLY',
          },
        ],
      },
    },
    user.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, user.id);
  const actor = { id: user.id, apiKeyId: 'transaction-fixture-credential' };
  return { service, runbook, version, actor };
}
it('joins the outer transaction for every rule configuration command and rolls back canonical audits', async () => {
  const { service, runbook, version, actor } = await fixture();
  const auditsBefore = await db.auditLog.count();
  await expect(
    db.$transaction(async tx => {
      const rule = await createServiceBinding(
        service.id,
        {
          runbookId: runbook.id,
          runbookVersionId: version.id,
          versionStrategy: 'PINNED',
          mode: 'MANUAL',
          enabled: false,
        },
        actor,
        undefined,
        version.id,
        tx
      );
      await updateServiceBinding(
        service.id,
        rule.id,
        { name: 'Reviewed rule' },
        actor,
        version.id,
        rule.configurationRevision,
        tx
      );
      const current = await tx.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } });
      await replaceBindingTrigger(
        service.id,
        rule.id,
        { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] },
        actor,
        current.configurationRevision,
        tx
      );
      await duplicateServiceRule(service.id, rule.id, actor, tx);
      await pauseServiceRule(service.id, rule.id, actor, tx);
      await detachServiceBinding(service.id, rule.id, actor, tx);
      throw new Error('Outer transaction fixture rollback');
    })
  ).rejects.toThrow('Outer transaction fixture rollback');
  expect(await db.serviceAutomationRule.count()).toBe(0);
  expect(await db.runbookTrigger.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(auditsBefore);
});
it('preserves the exact API credential attribution on canonical rule audits', async () => {
  const { service, runbook, version, actor } = await fixture();
  const rule = await db.$transaction(tx =>
    createServiceBinding(
      service.id,
      {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        versionStrategy: 'PINNED',
        mode: 'MANUAL',
        enabled: false,
      },
      actor,
      undefined,
      version.id,
      tx
    )
  );
  expect(rule.enabled).toBe(false);
  const audits = await db.auditLog.findMany({
    where: { action: 'runbook.service.attached', entityId: runbook.id },
  });
  expect(audits).toHaveLength(1);
  expect(audits[0].details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: actor.apiKeyId, bindingId: rule.id },
  });
});
it('rolls back durable policy checks and canonical audit with the caller transaction', async () => {
  const { service, runbook, version, actor } = await fixture(true);
  const agent = await db.runbookAgent.create({
    data: {
      name: 'Policy transaction Agent',
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      policyHash: 'b'.repeat(64),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
    },
  });
  const rule = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      mode: 'MANUAL',
      enabled: false,
      defaultAgentId: agent.id,
    },
    actor
  );
  const auditsBefore = await db.auditLog.count();
  await expect(
    db.$transaction(async tx => {
      const result = await requestRulePolicyChecks(service.id, rule.id, actor, tx);
      expect(result.checkedTargets).toBe(1);
      expect(await tx.runbookPolicyCheck.count()).toBe(1);
      throw new Error('Policy transaction fixture rollback');
    })
  ).rejects.toThrow('Policy transaction fixture rollback');
  expect(await db.runbookPolicyCheck.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(auditsBefore);
});
