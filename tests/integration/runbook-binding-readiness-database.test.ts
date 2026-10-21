import { beforeEach, describe, expect, it } from 'vitest';
import { getBindingReadiness } from '@/lib/runbooks/binding-readiness';
import { pauseServiceRule, duplicateServiceRule } from '@/lib/runbooks/bindings';
import { testPrisma, createTestService, createTestUser, resetDatabase } from '../helpers/test-db';
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
suite('canonical service rule readiness', () => {
  beforeEach(resetDatabase);
  async function fixture(mode: 'MANUAL' | 'AUTOMATIC' = 'MANUAL') {
    const service = await createTestService('Readiness service');
    const runbook = await testPrisma.runbook.create({
      data: { name: 'Readiness fixture', slug: `readiness-${crypto.randomUUID()}` },
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
        name: 'Readiness Agent',
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
        labels: { environment: 'test' },
      },
    });
    const binding = await testPrisma.serviceAutomationRule.create({
      data: {
        serviceId: service.id,
        runbookId: runbook.id,
        runbookVersionId: version.id,
        versionStrategy: 'PINNED',
        defaultAgentId: agent.id,
        mode,
      },
    });
    return { binding, agent };
  }
  async function load(id: string) {
    return testPrisma.serviceAutomationRule.findUniqueOrThrow({
      where: { id },
      include: {
        runbook: { include: { publishedVersion: { include: { inputs: true } } } },
        runbookVersion: { include: { inputs: true } },
        triggers: { include: { conditions: true } },
      },
    });
  }
  it('allows independent rules for one reusable runbook while retaining historical references', async () => {
    const { binding } = await fixture();
    const prior = await load(binding.id);
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: binding.runbookId,
        runbookVersionId: binding.runbookVersionId!,
        bindingId: binding.id,
        serviceId: binding.serviceId,
        definitionChecksum: prior.runbookVersion!.checksum,
        deadlineAt: new Date(Date.now() + 60_000),
      },
    });
    const duplicate = await testPrisma.serviceAutomationRule.create({
      data: {
        name: 'Independent staging diagnostic',
        serviceId: binding.serviceId,
        runbookId: binding.runbookId,
        runbookVersionId: binding.runbookVersionId,
        versionStrategy: 'PINNED',
        mode: 'MANUAL',
        enabled: false,
        defaultAgentId: binding.defaultAgentId,
        inputValues: {},
      },
    });
    expect(duplicate.id).not.toBe(binding.id);
    expect(
      await testPrisma.serviceAutomationRule.count({
        where: { serviceId: binding.serviceId, runbookId: binding.runbookId },
      })
    ).toBe(2);
    expect(
      (await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } }))
        .bindingId
    ).toBe(binding.id);
    await testPrisma.serviceAutomationRule.update({
      where: { id: duplicate.id },
      data: { name: 'Renamed rule' },
    });
    expect((await load(binding.id)).enabled).toBe(true);
  });
  it('does not certify local policy merely because an Agent is online and capable', async () => {
    const { binding } = await fixture();
    const result = await getBindingReadiness(await load(binding.id));
    expect(result.state).toBe('CHECKS_REQUIRED');
    expect(result.eligibleAgents).toBe(1);
    expect(result.checks.some(check => check.state === 'deferred')).toBe(true);
  });
  it('defers incident-specific targets instead of reporting zero matching Agents', async () => {
    const { binding } = await fixture();
    await testPrisma.serviceAutomationRule.update({
      where: { id: binding.id },
      data: { defaultAgentId: null, agentSelector: { host: '${{ incident.labels.host }}' } },
    });
    const readiness = await getBindingReadiness(await load(binding.id));
    expect(readiness.state).toBe('CHECKS_REQUIRED');
    expect(readiness.eligibleAgents).toBeNull();
    expect(readiness.checks).toContainEqual(
      expect.objectContaining({ code: 'INCIDENT_CONTEXT_REQUIRED', state: 'deferred' })
    );
  });
  it('blocks automatic mode without an active trigger', async () => {
    const { binding } = await fixture('AUTOMATIC');
    expect((await getBindingReadiness(await load(binding.id))).checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NO_TRIGGER', state: 'blocked' })])
    );
  });
  it('detects target disappearance rather than showing configuration ready', async () => {
    const { binding, agent } = await fixture();
    await testPrisma.runbookAgent.update({ where: { id: agent.id }, data: { status: 'OFFLINE' } });
    expect((await getBindingReadiness(await load(binding.id))).state).toBe('BLOCKED');
  });
  it('keeps a paused rule paused without claiming execution readiness', async () => {
    const { binding } = await fixture();
    await testPrisma.serviceAutomationRule.update({
      where: { id: binding.id },
      data: { enabled: false },
    });
    const readiness = await getBindingReadiness(await load(binding.id));
    expect(readiness.state).toBe('PAUSED');
    expect(readiness.eligibleAgents).toBeNull();
  });
  it('explains a retired target on a paused rule without claiming execution readiness', async () => {
    const { binding } = await fixture();
    const pool = await testPrisma.runbookAgentPool.create({ data: { name: 'Retired target' } });
    await testPrisma.serviceAutomationRule.update({
      where: { id: binding.id },
      data: { enabled: false, defaultAgentId: null, defaultAgentPoolId: pool.id },
    });
    await testPrisma.runbookAgentPool.update({
      where: { id: pool.id },
      data: { lifecycle: 'RETIRED', retiredAt: new Date() },
    });
    const readiness = await getBindingReadiness(await load(binding.id));
    expect(readiness.state).toBe('PAUSED');
    expect(readiness.armed).toBe(false);
    expect(readiness.eligibleAgents).toBeNull();
    expect(readiness.checks).toContainEqual({
      code: 'TARGET_POOL_RETIRED',
      state: 'blocked',
      message:
        'The selected Agent pool is retired. Select an active pool before enabling this rule.',
    });
  });
  it('duplicates trigger configuration into a paused identity and permits pausing broken configuration', async () => {
    const actor = await createTestUser();
    const { binding, agent } = await fixture();
    await testPrisma.runbookTrigger.create({
      data: {
        bindingId: binding.id,
        event: 'INCIDENT_CREATED',
        conditions: { create: { field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' } },
      },
    });
    const copy = await duplicateServiceRule(binding.serviceId, binding.id, actor.id);
    const loaded = await load(copy.id);
    expect(loaded.enabled).toBe(false);
    expect(loaded.triggers[0]?.conditions[0]?.value).toBe('HIGH');
    expect(loaded.triggers[0]?.id).not.toBe((await load(binding.id)).triggers[0]?.id);
    await testPrisma.runbookAgent.update({ where: { id: agent.id }, data: { status: 'REVOKED' } });
    await pauseServiceRule(binding.serviceId, binding.id, actor.id);
    expect((await load(binding.id)).enabled).toBe(false);
    await expect(
      pauseServiceRule((await createTestService('Different service')).id, binding.id, actor.id)
    ).rejects.toThrow('not found');
  });
});
