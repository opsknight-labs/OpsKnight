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
  it.each([
    { type: undefined, config: { command: 'echo [REDACTED]' }, status: 'DEFERRED' },
    { type: 'BASH', config: { command: 'echo [REDACTED]' }, status: 'DEFERRED' },
    {
      type: 'BASH',
      config: { command: 'test -n "$OPSKNIGHT_INPUT_TOKEN"', env: { TOKEN: '[REDACTED]' } },
      status: 'PASSED',
    },
  ])(
    'retains secret uncertainty only in executable policy fields ($status)',
    async ({ type, config, status }) => {
      const actor = await createTestUser();
      const service = await createTestService('Deferred policy');
      const workflow = await testPrisma.runbook.create({
        data: { name: 'Deferred', slug: crypto.randomUUID() },
      });
      const version = await testPrisma.runbookVersion.create({
        data: {
          runbookId: workflow.id,
          version: 1,
          state: 'PUBLISHED',
          checksum: 'c'.repeat(64),
          definition: {
            steps: [
              {
                key: 'command',
                name: 'Command',
                type: 'BASH',
                riskClass: 'NON_IDEMPOTENT',
                config: { command: 'echo [REDACTED]' },
              },
            ],
          },
        },
      });
      const agent = await testPrisma.runbookAgent.create({ data: { name: 'Deferred Agent' } });
      const rule = await testPrisma.serviceAutomationRule.create({
        data: { serviceId: service.id, runbookId: workflow.id },
      });
      const check = await testPrisma.runbookPolicyCheck.create({
        data: {
          id: crypto.randomUUID(),
          ruleId: rule.id,
          agentId: agent.id,
          versionId: version.id,
          checksum: version.checksum,
          steps: [{ key: 'command', ...(type ? { type } : {}), config }],
          expiresAt: new Date(Date.now() + 60000),
          createdById: actor.id,
        },
      });
      await submitPolicyCheck(agent.id, {
        id: check.id,
        policyHash: 'b'.repeat(64),
        results: [{ key: 'command', allowed: true }],
      });
      const saved = await testPrisma.runbookPolicyCheck.findUniqueOrThrow({
        where: { id: check.id },
      });
      expect(saved.status).toBe(status);
      expect(saved.results).toEqual(
        status === 'DEFERRED'
          ? [{ key: 'command', allowed: null, reason: 'REDACTED_INPUT' }]
          : [{ key: 'command', allowed: true }]
      );
      expect(await testPrisma.runbookExecution.count()).toBe(0);
    }
  );
});

suite('bounded fleet policy certification', () => {
  beforeEach(resetDatabase);
  it.each([1, 10, 50, 100])(
    'requires fresh complete evidence for all %i eligible Agents',
    async count => {
      const actor = await createTestUser({ role: 'ADMIN' });
      const service = await createTestService('Fleet policy');
      const runbook = await testPrisma.runbook.create({
        data: { name: 'Fleet policy', slug: `fleet-policy-${crypto.randomUUID()}` },
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
                name: 'Summary',
                type: 'LINUX_DIAGNOSTICS',
                riskClass: 'READ_ONLY',
                config: { diagnostic: 'summary' },
              },
            ],
          },
        },
      });
      await testPrisma.runbook.update({
        where: { id: runbook.id },
        data: { publishedVersionId: version.id },
      });
      const pool = await testPrisma.runbookAgentPool.create({
        data: { name: 'Fleet', mode: 'SHARED_TARGET' },
      });
      const agents = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          testPrisma.runbookAgent.create({
            data: {
              name: `Fleet ${index}`,
              status: 'ONLINE',
              lastHeartbeatAt: new Date(),
              capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
              policyHash: 'b'.repeat(64),
              poolMemberships: { create: { poolId: pool.id } },
            },
          })
        )
      );
      const rule = await testPrisma.serviceAutomationRule.create({
        data: {
          serviceId: service.id,
          runbookId: runbook.id,
          runbookVersionId: version.id,
          versionStrategy: 'PINNED',
          mode: 'AUTOMATIC',
          enabled: false,
          defaultAgentPoolId: pool.id,
          triggers: { create: { event: 'INCIDENT_CREATED' } },
        },
      });
      await expect(requestRulePolicyChecks(service.id, rule.id, actor.id)).resolves.toMatchObject({
        checkedTargets: count,
      });
      const requests = await testPrisma.runbookPolicyCheck.findMany({
        where: { ruleId: rule.id },
        orderBy: { agentId: 'asc' },
      });
      expect(requests).toHaveLength(count);
      const { activateServiceRule } = await import('@/lib/runbooks/bindings');
      // Completion of the first batch must never authorize a partial fleet.
      for (const request of requests.slice(0, -1))
        await submitPolicyCheck(request.agentId, {
          id: request.id,
          policyHash: 'b'.repeat(64),
          results: [{ key: 'diagnose', allowed: true }],
        });
      await expect(activateServiceRule(service.id, rule.id, actor.id, true)).rejects.toThrow(
        'every selected Agent'
      );
      const last = requests.at(-1)!;
      await submitPolicyCheck(last.agentId, {
        id: last.id,
        policyHash: 'b'.repeat(64),
        results: [{ key: 'diagnose', allowed: true }],
      });
      await expect(activateServiceRule(service.id, rule.id, actor.id, true)).resolves.toBeDefined();
      await testPrisma.serviceAutomationRule.update({
        where: { id: rule.id },
        data: { enabled: false },
      });
      await testPrisma.runbookAgent.update({
        where: { id: agents[0].id },
        data: { policyHash: 'c'.repeat(64) },
      });
      await expect(activateServiceRule(service.id, rule.id, actor.id, true)).rejects.toThrow(
        'every selected Agent'
      );
      await testPrisma.runbookAgent.update({
        where: { id: agents[0].id },
        data: { policyHash: 'b'.repeat(64) },
      });
      await testPrisma.runbookPolicyCheck.updateMany({
        where: { ruleId: rule.id },
        data: { checkedAt: new Date(Date.now() - 6 * 60_000) },
      });
      await expect(activateServiceRule(service.id, rule.id, actor.id, true)).rejects.toThrow(
        'every selected Agent'
      );
      expect(await testPrisma.runbookExecution.count()).toBe(0);
    },
    60_000
  );
});
