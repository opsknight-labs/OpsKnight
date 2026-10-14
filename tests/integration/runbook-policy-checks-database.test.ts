import { beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, createTestUser, createTestService, resetDatabase } from '../helpers/test-db';
import {
  requestRulePolicyChecks,
  pendingAgentPolicyChecks,
  submitPolicyCheck,
} from '@/lib/runbooks/policy-checks';
import { getBindingReadiness } from '@/lib/runbooks/binding-readiness';
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
suite('Agent local policy-check authority', () => {
  beforeEach(resetDatabase);
  it('freezes target/configuration, rejects forged result scope, and consumes exact complete results once', async () => {
    const actor = await createTestUser();
    const service = await createTestService('Policy check');
    const runbook = await testPrisma.runbook.create({
      data: { name: 'Policy check', slug: `policy-${crypto.randomUUID()}` },
    });
    const version = await testPrisma.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'PUBLISHED',
        checksum: 'a'.repeat(64),
        definition: {
          steps: [
            {
              key: 'diagnose',
              name: 'Diagnostics',
              type: 'LINUX_DIAGNOSTICS',
              riskClass: 'READ_ONLY',
              config: { action: 'summary' },
            },
          ],
        },
      },
    });
    await testPrisma.runbook.update({
      where: { id: runbook.id },
      data: { publishedVersionId: version.id },
    });
    const agent = await testPrisma.runbookAgent.create({
      data: {
        name: 'Policy Agent',
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        policyHash: 'b'.repeat(64),
      },
    });
    const other = await testPrisma.runbookAgent.create({
      data: { name: 'Other Agent', status: 'ONLINE', lastHeartbeatAt: new Date() },
    });
    const rule = await testPrisma.serviceAutomationRule.create({
      data: { runbookId: runbook.id, serviceId: service.id, defaultAgentId: agent.id },
    });
    const executionsBefore = await testPrisma.runbookExecution.count();
    await requestRulePolicyChecks(service.id, rule.id, actor.id);
    await expect(requestRulePolicyChecks(service.id, rule.id, actor.id)).rejects.toThrow(
      'already pending'
    );
    expect(await pendingAgentPolicyChecks(other.id)).toEqual([]);
    const [check] = await pendingAgentPolicyChecks(agent.id);
    expect(check.kind).toBe('POLICY_CHECK');
    expect(check.signingAgentId).toBe(agent.id);
    expect(check.signature).toBeTruthy();
    const result = {
      id: check.id,
      policyHash: 'b'.repeat(64),
      results: [{ key: 'diagnose', allowed: true }],
    };
    await expect(submitPolicyCheck(other.id, result)).rejects.toThrow('belongs to another');
    await expect(submitPolicyCheck(agent.id, { ...result, results: [] })).rejects.toThrow(
      'every frozen step'
    );
    await submitPolicyCheck(agent.id, result);
    expect(
      (await testPrisma.runbookPolicyCheck.findUniqueOrThrow({ where: { id: check.id } })).status
    ).toBe('PASSED');
    await expect(submitPolicyCheck(agent.id, result)).rejects.toThrow('already completed');
    expect(await testPrisma.runbookExecution.count()).toBe(executionsBefore);
    expect(await pendingAgentPolicyChecks(agent.id)).toEqual([]);
    const load = () =>
      testPrisma.serviceAutomationRule.findUniqueOrThrow({
        where: { id: rule.id },
        include: {
          runbook: { include: { publishedVersion: { include: { inputs: true } } } },
          runbookVersion: { include: { inputs: true } },
          triggers: { include: { conditions: true } },
        },
      });
    expect(
      (await getBindingReadiness(await load())).checks.some(
        check => check.code === `AGENT_POLICY_${agent.id}`
      )
    ).toBe(true);
    await testPrisma.runbookAgent.update({
      where: { id: agent.id },
      data: { policyHash: 'c'.repeat(64) },
    });
    expect(
      (await getBindingReadiness(await load())).checks.some(check =>
        check.code.startsWith('AGENT_POLICY_')
      )
    ).toBe(false);
    await testPrisma.runbookAgent.update({
      where: { id: agent.id },
      data: { policyHash: 'b'.repeat(64) },
    });
    await testPrisma.serviceAutomationRule.update({
      where: { id: rule.id },
      data: { defaultAgentId: other.id },
    });
    expect(
      (await getBindingReadiness(await load())).checks.some(check =>
        check.code.startsWith('AGENT_POLICY_')
      )
    ).toBe(false);
  });
});
