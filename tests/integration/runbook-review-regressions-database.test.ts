import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  testPrisma,
  resetDatabase,
  createTestService,
  createTestUser,
  createTestIncident,
} from '../helpers/test-db';
import { attachRunbookAction } from '@/app/(app)/services/[id]/runbook-actions';
import {
  activateServiceRule,
  createServiceBinding,
  replaceBindingTrigger,
} from '@/lib/runbooks/bindings';
import { getServiceRulePage } from '@/lib/runbooks/service-rule-page';
import { getBindingReadiness } from '@/lib/runbooks/binding-readiness';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
const actor = vi.hoisted(() => ({ id: '' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: async () => actor,
  assertCapability: async () => actor,
}));
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const diagnostic = {
  steps: [
    {
      key: 'diagnose',
      name: 'Diagnose',
      type: 'LINUX_DIAGNOSTICS',
      riskClass: 'READ_ONLY',
      config: { action: 'summary' },
    },
  ],
};
const write = {
  steps: [
    {
      key: 'restart',
      name: 'Restart',
      type: 'SYSTEMD',
      riskClass: 'NON_IDEMPOTENT',
      requiresApproval: true,
      config: { action: 'restart', unit: 'test.service' },
    },
  ],
};
const measured = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let queries = 0;
measured.$on('query', () => queries++);
afterAll(() => measured.$disconnect());
suite('PR 864 review regression contracts', () => {
  beforeEach(resetDatabase, 60000);
  async function fixture() {
    actor.id = (await createTestUser()).id;
    const service = await createTestService('Review fixture');
    const workflow = await testPrisma.runbook.create({
      data: { name: 'Review workflow', slug: crypto.randomUUID() },
    });
    const old = await testPrisma.runbookVersion.create({
      data: {
        runbookId: workflow.id,
        version: 1,
        state: 'DRAFT',
        checksum: 'a'.repeat(64),
        definition: diagnostic,
        inputs: {
          create: {
            key: 'legacy',
            label: 'Legacy input',
            type: 'STRING',
            required: true,
            description: '',
            sequence: 0,
          },
        },
      },
    });
    await testPrisma.runbookVersion.update({ where: { id: old.id }, data: { state: 'PUBLISHED' } });
    const current = await testPrisma.runbookVersion.create({
      data: {
        runbookId: workflow.id,
        version: 2,
        state: 'DRAFT',
        checksum: 'b'.repeat(64),
        definition: write,
        inputs: {
          create: {
            key: 'unit',
            label: 'Unit',
            type: 'STRING',
            required: true,
            description: '',
            sequence: 0,
          },
        },
      },
    });
    await testPrisma.runbookVersion.update({
      where: { id: current.id },
      data: { state: 'PUBLISHED' },
    });
    await testPrisma.runbook.update({
      where: { id: workflow.id },
      data: { publishedVersionId: current.id },
    });
    return { service, workflow, old, current };
  }
  it('honors a selected older published version with its own input schema and rejects mismatched inputs', async () => {
    const { service, workflow, old, current } = await fixture();
    const form = new FormData();
    for (const [key, value] of Object.entries({
      runbookSelection: `${workflow.id}:${current.id}`,
      versionStrategy: 'PINNED',
      runbookVersionId: old.id,
      expectedVersionId: old.id,
      enabled: 'false',
      agentSelector: '{}',
      'input:legacy': 'old-schema-value',
    }))
      form.set(key, value);
    expect(await attachRunbookAction(service.id, form)).toBeUndefined();
    expect(await testPrisma.serviceAutomationRule.findFirstOrThrow()).toMatchObject({
      runbookVersionId: old.id,
      inputValues: { legacy: 'old-schema-value' },
    });
    form.set('runbookVersionId', current.id);
    expect(await attachRunbookAction(service.id, form)).toMatchObject({
      error: expect.stringContaining('Inputs changed'),
    });
    expect(await testPrisma.serviceAutomationRule.count()).toBe(1);
    form.set('agentSelector', '{');
    expect(await attachRunbookAction(service.id, form)).toMatchObject({ field: 'agentSelector' });
  });
  it('rejects latest publication drift inside the workflow lock without creating a rule', async () => {
    const { service, workflow, old } = await fixture();
    await expect(
      createServiceBinding(
        service.id,
        {
          runbookId: workflow.id,
          versionStrategy: 'LATEST_PUBLISHED',
          mode: 'MANUAL',
          enabled: false,
          inputValues: { unit: 'test.service' },
          agentSelector: {},
        },
        actor.id,
        undefined,
        old.id
      )
    ).rejects.toThrow('published version changed');
    expect(await testPrisma.serviceAutomationRule.count()).toBe(0);
  });
  it('preserves pending and accepted suggestions, completed executions and audited condition revisions', async () => {
    const { service, workflow, old } = await fixture();
    const rule = await testPrisma.serviceAutomationRule.create({
      data: {
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: old.id,
        versionStrategy: 'PINNED',
        mode: 'SUGGESTED',
        inputValues: { legacy: 'test' },
      },
    });
    const incident = await createTestIncident('Keep response history', service.id);
    const first = await replaceBindingTrigger(
      service.id,
      rule.id,
      {
        event: 'INCIDENT_CREATED',
        enabled: true,
        conditionLogic: 'AND',
        conditions: [{ field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH', sequence: 0 }],
      },
      actor.id
    );
    const suggestions = await Promise.all(
      (['SUGGESTED', 'STARTED'] as const).map(state =>
        testPrisma.runbookSuggestion.create({
          data: {
            incidentId: incident.id,
            bindingId: rule.id,
            runbookVersionId: old.id,
            triggerId: first.id,
            sourceEventId: crypto.randomUUID(),
            fingerprint: crypto.randomUUID(),
            state,
            planSnapshot: { definitionChecksum: old.checksum, inputValues: { legacy: 'frozen' } },
          },
        })
      )
    );
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: workflow.id,
        runbookVersionId: old.id,
        serviceId: service.id,
        bindingId: rule.id,
        triggerId: first.id,
        triggerFingerprint: 'original-evidence',
        definitionChecksum: old.checksum,
        status: 'SUCCEEDED',
        completedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60000),
      },
    });
    const second = await replaceBindingTrigger(
      service.id,
      rule.id,
      {
        event: 'INCIDENT_CREATED',
        enabled: true,
        conditionLogic: 'OR',
        conditions: [{ field: 'incident.urgency', operator: 'EQUALS', value: 'LOW', sequence: 0 }],
      },
      actor.id
    );
    expect(second).toMatchObject({ id: first.id, revision: 2, conditionLogic: 'OR' });
    expect(await testPrisma.runbookTrigger.count({ where: { bindingId: rule.id } })).toBe(1);
    expect(await testPrisma.runbookSuggestion.findMany()).toEqual(
      expect.arrayContaining(suggestions)
    );
    expect(await testPrisma.runbookSuggestion.count()).toBe(2);
    expect(await testPrisma.runbookExecution.findUnique({ where: { id: execution.id } })).toEqual(
      execution
    );
    const audit = await testPrisma.auditLog.findMany({
      where: { action: 'runbook.trigger.configured' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect((audit[1].details as { metadata: unknown }).metadata).toMatchObject({
      triggerId: first.id,
      revision: 2,
      before: { revision: 1, conditions: [{ field: 'incident.urgency', value: 'HIGH' }] },
      after: { revision: 2, conditions: [{ field: 'incident.urgency', value: 'LOW' }] },
    });
  });
  it('bounds visible rule queries and readiness at 100/1000/10000 rules with a 1000-Agent inventory', async () => {
    const { service, workflow, old } = await fixture();
    await testPrisma.runbookAgent.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        id: `review-agent-${i}`,
        name: `Agent ${i}`,
        status: 'ONLINE' as const,
        lastHeartbeatAt: new Date(),
        capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
      })),
    });
    const samples = [];
    let previous = 0;
    for (const size of [100, 1000, 10000]) {
      await testPrisma.serviceAutomationRule.createMany({
        data: Array.from({ length: size - previous }, () => ({
          serviceId: service.id,
          runbookId: workflow.id,
          runbookVersionId: old.id,
          versionStrategy: 'PINNED' as const,
          inputValues: { legacy: 'test' },
          defaultAgentId: 'review-agent-0',
        })),
      });
      previous = size;
      const latencies = [];
      const queryCounts = [];
      for (let sample = 0; sample < 5; sample++) {
        queries = 0;
        const started = performance.now();
        const page = await getServiceRulePage(service.id, undefined, measured);
        expect(page.rules).toHaveLength(20);
        expect(page.hasNext).toBe(true);
        for (let offset = 0; offset < page.rules.length; offset += 8)
          await Promise.all(
            page.rules
              .slice(offset, offset + 8)
              .map(rule => getBindingReadiness(rule, new Date(), measured))
          );
        latencies.push(performance.now() - started);
        queryCounts.push(queries);
      }
      expect(Math.max(...queryCounts)).toBeLessThan(250);
      samples.push({
        rules: size,
        agents: 1000,
        visible: 20,
        queryCounts,
        p95Ms: Math.max(...latencies),
      });
    }
    // Prisma query-event delivery can lag the completed promise by a tick; assert the bounded budget across samples.
    expect(Math.max(...samples[2].queryCounts)).toBeLessThanOrEqual(
      Math.max(...samples[0].queryCounts) + 5
    );
    const first = await getServiceRulePage(service.id);
    const second = await getServiceRulePage(service.id, first.nextCursor);
    expect(second.rules.some(rule => first.rules.some(previous => previous.id === rule.id))).toBe(
      false
    );
    await mkdir('test-results/runbook-engine', { recursive: true });
    await writeFile(
      'test-results/runbook-engine/rule-page-scale.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          topology:
            'Local PostgreSQL read model plus visible-page readiness; excludes full browser rendering and network authorization',
          samples,
        },
        null,
        2
      )
    );
  }, 60000);
  it('deduplicates three concurrent reconciliation sweeps over 1000 cancelled executions', async () => {
    const { service, workflow, old } = await fixture();
    await testPrisma.runbookExecution.createMany({
      data: Array.from({ length: 1000 }, () => ({
        runbookId: workflow.id,
        runbookVersionId: old.id,
        serviceId: service.id,
        definitionChecksum: old.checksum,
        status: 'CANCEL_REQUESTED' as const,
        deadlineAt: new Date(Date.now() + 60000),
      })),
    });
    await Promise.all(Array.from({ length: 3 }, () => reconcileRunbooks(100)));
    expect(await testPrisma.backgroundJob.count({ where: { type: 'RUNBOOK' } })).toBe(100);
    await reconcileRunbooks(100);
    expect(await testPrisma.backgroundJob.count({ where: { type: 'RUNBOOK' } })).toBe(100);
    expect(await testPrisma.runbookStepAttempt.count()).toBe(0);
  }, 60000);
  it('permits one watchdog leader across three database sessions', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 3 }, () =>
        testPrisma.$transaction(async tx => {
          const [lock] = await tx.$queryRaw<
            Array<{ acquired: boolean }>
          >`SELECT pg_try_advisory_xact_lock(864, 1) AS acquired`;
          if (lock.acquired) await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.2)`;
          return lock.acquired;
        })
      )
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });
});

suite('second audit activation and minimum-pool contracts', () => {
  beforeEach(resetDatabase, 60000);
  it('always creates Automatic rules paused and requires separate match-all confirmation and current policy evidence', async () => {
    const user = await createTestUser();
    const service = await createTestService('Activation');
    const workflow = await testPrisma.runbook.create({
      data: { name: 'Activation', slug: crypto.randomUUID() },
    });
    const version = await testPrisma.runbookVersion.create({
      data: {
        runbookId: workflow.id,
        version: 1,
        state: 'PUBLISHED',
        checksum: 'e'.repeat(64),
        definition: diagnostic,
      },
    });
    await testPrisma.runbook.update({
      where: { id: workflow.id },
      data: { publishedVersionId: version.id },
    });
    const agent = await testPrisma.runbookAgent.create({
      data: {
        name: 'Activation Agent',
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
        policyHash: 'f'.repeat(64),
      },
    });
    const rule = await createServiceBinding(
      service.id,
      {
        runbookId: workflow.id,
        runbookVersionId: version.id,
        versionStrategy: 'PINNED',
        mode: 'AUTOMATIC',
        enabled: true,
        inputValues: {},
        agentSelector: {},
        defaultAgentId: agent.id,
      },
      user.id,
      { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] }
    );
    expect(rule.enabled).toBe(false);
    await expect(activateServiceRule(service.id, rule.id, user.id, false)).rejects.toThrow(
      'Explicitly confirm'
    );
    await expect(activateServiceRule(service.id, rule.id, user.id, true)).rejects.toThrow(
      'policy checks'
    );
    const { requestRulePolicyChecks, pendingAgentPolicyChecks, submitPolicyCheck } =
      await import('@/lib/runbooks/policy-checks');
    await requestRulePolicyChecks(service.id, rule.id, user.id);
    const [check] = await pendingAgentPolicyChecks(agent.id);
    await submitPolicyCheck(agent.id, {
      id: check.id,
      policyHash: 'f'.repeat(64),
      results: [{ key: 'diagnose', allowed: true }],
    });
    await testPrisma.serviceAutomationRule.update({
      where: { id: rule.id },
      data: {
        defaultAgentId: null,
        agentSelector: { region: 'production' },
      },
    });
    await testPrisma.runbookAgent.update({
      where: { id: agent.id },
      data: { labels: { region: 'production' } },
    });
    const secondAgent = await testPrisma.runbookAgent.create({
      data: {
        name: 'Second certified selector Agent',
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        labels: { region: 'production' },
        capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
        policyHash: 'f'.repeat(64),
      },
    });
    await requestRulePolicyChecks(service.id, rule.id, user.id);
    for (const candidate of [agent, secondAgent]) {
      const [pending] = await pendingAgentPolicyChecks(candidate.id);
      expect(pending).toBeDefined();
      await submitPolicyCheck(candidate.id, {
        id: pending.id,
        policyHash: 'f'.repeat(64),
        results: [{ key: 'diagnose', allowed: true }],
      });
    }
    expect(
      await testPrisma.runbookPolicyCheck.count({ where: { ruleId: rule.id, status: 'PASSED' } })
    ).toBe(3);
    await expect(activateServiceRule(service.id, rule.id, user.id, true)).rejects.toThrow(
      'Use Suggested mode'
    );
    await testPrisma.serviceAutomationRule.update({
      where: { id: rule.id },
      data: {
        defaultAgentId: agent.id,
        agentSelector: { region: '{{incident.labels.region}}' },
      },
    });
    await expect(activateServiceRule(service.id, rule.id, user.id, true)).rejects.toThrow(
      'Use Suggested mode'
    );
    await testPrisma.serviceAutomationRule.update({
      where: { id: rule.id },
      data: {
        defaultAgentId: agent.id,
        agentSelector: {},
      },
    });
    await activateServiceRule(service.id, rule.id, user.id, true);
    expect(
      (await testPrisma.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled
    ).toBe(true);
    expect(await testPrisma.runbookExecution.count()).toBe(0);
    await replaceBindingTrigger(
      service.id,
      rule.id,
      { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] },
      user.id
    );
    expect(
      (await testPrisma.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled
    ).toBe(false);
  });
  it('recovers a 1000-execution outage with three schedulers using one connection each', async () => {
    const service = await createTestService('Minimum pool');
    const workflow = await testPrisma.runbook.create({
      data: { name: 'Minimum pool', slug: crypto.randomUUID() },
    });
    const version = await testPrisma.runbookVersion.create({
      data: {
        runbookId: workflow.id,
        version: 1,
        state: 'PUBLISHED',
        checksum: 'e'.repeat(64),
        definition: diagnostic,
      },
    });
    await testPrisma.runbookExecution.createMany({
      data: Array.from({ length: 1000 }, () => ({
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: version.id,
        definitionChecksum: version.checksum,
        status: 'CANCEL_REQUESTED' as const,
        deadlineAt: new Date(Date.now() + 60000),
      })),
    });
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('pool_timeout', '2');
    const schedulers = Array.from(
      { length: 3 },
      () => new PrismaClient({ datasources: { db: { url: url.toString() } } })
    );
    try {
      const acquired = await Promise.all(
        schedulers.map(limited =>
          limited.$transaction(
            async tx => {
              const [lock] = await tx.$queryRaw<
                Array<{ acquired: boolean }>
              >`SELECT pg_try_advisory_xact_lock(864, 1) AS acquired`;
              if (!lock.acquired) return false;
              await reconcileRunbooks(100, tx);
              return true;
            },
            { timeout: 10000 }
          )
        )
      );
      expect(acquired.filter(Boolean)).toHaveLength(1);
      expect(await schedulers[0].backgroundJob.count()).toBe(100);
      expect(await schedulers[0].runbookStepAttempt.count()).toBe(0);
      // The same single connection remains usable after recovery releases its transaction.
      expect(await schedulers[0].runbookExecution.count()).toBe(1000);
    } finally {
      await Promise.all(schedulers.map(limited => limited.$disconnect()));
    }
  }, 30000);
});
