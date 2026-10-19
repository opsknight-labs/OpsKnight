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
import {
  attachRunbookAction,
  updateRunbookBindingAction,
  configureRunbookTriggerAction,
} from '@/app/(app)/services/[id]/runbook-actions';
import {
  activateServiceRule,
  createServiceBinding,
  replaceBindingTrigger,
  detachServiceBinding,
  updateServiceBinding,
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
            triggerRevision: first.revision,
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
        triggerRevision: first.revision,
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
    const configured = await testPrisma.serviceAutomationRule.findUniqueOrThrow({
      where: { id: rule.id },
    });
    expect(configured.configurationRevision).toBe(3);
    await updateServiceBinding(
      service.id,
      rule.id,
      { name: 'Updated name', enabled: false },
      actor.id
    );
    expect(
      (await testPrisma.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } }))
        .configurationRevision
    ).toBe(4);

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
    await detachServiceBinding(service.id, rule.id, actor.id);
    expect(
      await testPrisma.serviceAutomationRule.findUnique({ where: { id: rule.id } })
    ).toMatchObject({
      enabled: false,
      detachedAt: expect.any(Date),
      inputValues: { legacy: 'test' },
    });
    expect(await testPrisma.runbookSuggestion.findMany()).toEqual(
      expect.arrayContaining(suggestions)
    );
    expect(await testPrisma.runbookExecution.findUnique({ where: { id: execution.id } })).toEqual(
      execution
    );
    expect((await getServiceRulePage(service.id)).rules).toHaveLength(0);
    const { evaluateIncidentTriggers } = await import('@/lib/runbooks/triggers');
    expect(await evaluateIncidentTriggers(incident.id, 'after-detach')).toMatchObject({
      matched: 0,
      suggested: 0,
    });
    expect(await testPrisma.runbookSuggestion.count()).toBe(2);

    await expect(
      updateServiceBinding(service.id, rule.id, { enabled: true }, actor.id)
    ).rejects.toThrow('not found');
    await expect(
      replaceBindingTrigger(
        service.id,
        rule.id,
        { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] },
        actor.id
      )
    ).rejects.toThrow('not found');
  });
  it('rejects stale Suggested matches when a condition edit commits after the batch read', async () => {
    const { service, workflow, old } = await fixture();
    const incident = await createTestIncident('Concurrent condition edit', service.id);
    const rule = await testPrisma.serviceAutomationRule.create({
      data: {
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: old.id,
        mode: 'SUGGESTED',
        versionStrategy: 'PINNED',
        inputValues: { legacy: 'test' },
      },
    });
    const trigger = await replaceBindingTrigger(
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
    const { evaluateIncidentTriggers } = await import('@/lib/runbooks/triggers');
    const { default: applicationPrisma } = await import('@/lib/prisma');
    let loaded!: () => void;
    let locked!: () => void;
    const read = new Promise<void>(resolve => {
      loaded = resolve;
    });
    const lock = new Promise<void>(resolve => {
      locked = resolve;
    });
    const original = applicationPrisma.serviceAutomationRule.findMany.bind(
      applicationPrisma.serviceAutomationRule
    );
    const spy = vi
      .spyOn(applicationPrisma.serviceAutomationRule, 'findMany')
      .mockImplementationOnce(args => {
        const query = original(args);
        void query.then(
          () => loaded(),
          () => loaded()
        );
        return query;
      });
    try {
      const editor = testPrisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT id FROM "Runbook" WHERE id = ${workflow.id} FOR UPDATE`;
          locked();
          await read;
          await tx.runbookTrigger.update({
            where: { id: trigger.id },
            data: {
              revision: { increment: 1 },
              conditions: {
                deleteMany: {},
                create: {
                  field: 'incident.urgency',
                  operator: 'EQUALS',
                  value: 'LOW',
                  sequence: 0,
                },
              },
            },
          });
        },
        { timeout: 10000 }
      );
      await lock;
      const evaluation = evaluateIncidentTriggers(incident.id, 'concurrent-edit');
      const [, result] = await Promise.all([editor, evaluation]);
      expect(result).toMatchObject({ matched: 1, suggested: 0 });
      expect(await testPrisma.runbookSuggestion.count()).toBe(0);
      expect(await evaluateIncidentTriggers(incident.id, 'fresh-read')).toMatchObject({
        matched: 0,
        suggested: 0,
      });
    } finally {
      spy.mockRestore();
    }
  });
  it.each(
    (['SUGGESTED', 'AUTOMATIC'] as const).flatMap(mode =>
      (['mode', 'version', 'inputs', 'target'] as const).map(change => ({ mode, change }))
    )
  )('rejects stale $mode suggestions after a concurrent $change edit', async ({ mode, change }) => {
    const { service, workflow, old, current } = await fixture();
    const incident = await createTestIncident('Concurrent rule configuration', service.id);
    const agent = await testPrisma.runbookAgent.create({ data: { name: 'Original target' } });
    const newAgent = await testPrisma.runbookAgent.create({ data: { name: 'New target' } });
    const rule = await testPrisma.serviceAutomationRule.create({
      data: {
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: old.id,
        mode,
        versionStrategy: 'PINNED',
        inputValues: { legacy: 'original' },
        defaultAgentId: agent.id,
        triggers: { create: { event: 'INCIDENT_CREATED' } },
      },
    });
    const { evaluateIncidentTriggers } = await import('@/lib/runbooks/triggers');
    const orchestrator = await import('@/lib/runbooks/orchestrator');
    const { RunbookDefinitionError } = await import('@/lib/runbooks/errors');
    // Isolate the real budget-fallback transaction from execution planning; physical execution is never started.
    const budget =
      mode === 'AUTOMATIC'
        ? vi
            .spyOn(orchestrator, 'startTriggeredRunbookExecution')
            .mockRejectedValue(
              new RunbookDefinitionError('AUTO_REMEDIATION_BUDGET_EXHAUSTED: fixture budget')
            )
        : null;
    const { default: applicationPrisma } = await import('@/lib/prisma');
    let loaded!: () => void;
    let locked!: () => void;
    const read = new Promise<void>(resolve => {
      loaded = resolve;
    });
    const lock = new Promise<void>(resolve => {
      locked = resolve;
    });
    const original = applicationPrisma.serviceAutomationRule.findMany.bind(
      applicationPrisma.serviceAutomationRule
    );
    const spy = vi
      .spyOn(applicationPrisma.serviceAutomationRule, 'findMany')
      .mockImplementationOnce(args => {
        const query = original(args);
        void query.then(
          () => loaded(),
          () => loaded()
        );
        return query;
      });
    try {
      const editor = testPrisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT id FROM "Runbook" WHERE id = ${workflow.id} FOR UPDATE`;
          locked();
          await read;
          await tx.serviceAutomationRule.update({
            where: { id: rule.id },
            data: {
              configurationRevision: { increment: 1 },
              ...(change === 'mode' ? { mode: 'MANUAL' } : {}),
              ...(change === 'version' ? { runbookVersionId: current.id } : {}),
              ...(change === 'inputs' ? { inputValues: { legacy: 'edited' } } : {}),
              ...(change === 'target' ? { defaultAgentId: newAgent.id } : {}),
            },
          });
        },
        { timeout: 15000 }
      );
      await lock;
      const evaluation = evaluateIncidentTriggers(incident.id, `configuration-${mode}-${change}`);
      const [, result] = await Promise.all([editor, evaluation]);
      expect(result).toMatchObject({ matched: 1, suggested: 0 });
      expect(await testPrisma.runbookSuggestion.count()).toBe(0);
      expect(await testPrisma.runbookExecution.count()).toBe(0);
      if (budget) expect(budget).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      budget?.mockRestore();
    }
  });
  it('rejects simultaneous administrator saves from the same displayed rule revision', async () => {
    const { service, workflow, old } = await fixture();
    const rule = await testPrisma.serviceAutomationRule.create({
      data: {
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: old.id,
        versionStrategy: 'PINNED',
        mode: 'SUGGESTED',
        inputValues: { legacy: 'kept' },
        enabled: false,
      },
    });
    const saves = await Promise.allSettled(
      ['First editor', 'Second editor'].map(name =>
        updateServiceBinding(
          service.id,
          rule.id,
          { name },
          actor.id,
          old.id,
          rule.configurationRevision
        )
      )
    );
    expect(saves.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const stale = saves.find(result => result.status === 'rejected');
    expect(stale).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ userMessage: expect.stringContaining('Reload the page') }),
    });
    const saved = await testPrisma.serviceAutomationRule.findUniqueOrThrow({
      where: { id: rule.id },
    });
    expect(saved.configurationRevision).toBe(rule.configurationRevision + 1);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      ruleName: 'Stale UI editor',
      enabled: 'false',
      mode: 'SUGGESTED',
      versionStrategy: 'PINNED',
      runbookVersionId: old.id,
      expectedVersionId: old.id,
      expectedConfigurationRevision: String(rule.configurationRevision),
      agentSelector: '{}',
      executionTarget: 'none',
      'input:legacy': 'stale',
    }))
      form.set(key, value);
    expect(await updateRunbookBindingAction(service.id, rule.id, form)).toMatchObject({
      error: expect.stringContaining('Reload the page'),
    });
    expect(await configureRunbookTriggerAction(service.id, rule.id, form)).toMatchObject({
      error: expect.stringContaining('Reload the page'),
    });
    expect(
      (await testPrisma.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } }))
        .inputValues
    ).toEqual({ legacy: 'kept' });

    await expect(
      replaceBindingTrigger(
        service.id,
        rule.id,
        { event: 'INCIDENT_CREATED', conditionLogic: 'AND', enabled: true, conditions: [] },
        actor.id,
        rule.configurationRevision
      )
    ).rejects.toThrow('Reload the page');
    expect(await testPrisma.runbookTrigger.count({ where: { bindingId: rule.id } })).toBe(0);
  });
  it('explains and blocks Automatic policy certification above 100 online Agents', async () => {
    const { service, workflow, old } = await fixture();
    const pool = await testPrisma.runbookAgentPool.create({
      data: { name: 'Large fixed pool', mode: 'SHARED_TARGET' },
    });
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    await testPrisma.runbookAgent.createMany({
      data: ids.map(id => ({
        id,
        name: id,
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
      })),
    });
    await testPrisma.runbookAgentPoolMember.createMany({
      data: ids.map(agentId => ({ poolId: pool.id, agentId })),
    });
    const rule = await testPrisma.serviceAutomationRule.create({
      data: {
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: old.id,
        mode: 'AUTOMATIC',
        versionStrategy: 'PINNED',
        enabled: false,
        defaultAgentPoolId: pool.id,
        inputValues: { legacy: 'test' },
        triggers: { create: { event: 'INCIDENT_CREATED' } },
      },
      include: {
        runbook: { include: { publishedVersion: { include: { inputs: true } } } },
        runbookVersion: { include: { inputs: true } },
        triggers: { include: { conditions: true } },
      },
    });
    const readiness = await getBindingReadiness({ ...rule, enabled: true });
    expect(readiness).toMatchObject({ state: 'BLOCKED', eligibleAgents: 101 });
    expect(readiness.checks).toContainEqual(
      expect.objectContaining({
        code: 'AUTOMATIC_POLICY_TARGET_LIMIT',
        state: 'blocked',
        message: expect.stringContaining('100 online Agents'),
      })
    );
    await expect(activateServiceRule(service.id, rule.id, actor.id, true)).rejects.toThrow(
      '100 online Agents'
    );
    const { requestRulePolicyChecks } = await import('@/lib/runbooks/policy-checks');
    await expect(requestRulePolicyChecks(service.id, rule.id, actor.id)).rejects.toThrow(
      '1–100 online targets'
    );
    expect(await testPrisma.runbookPolicyCheck.count()).toBe(0);
  });
  it('evaluates 100/1000/10000 incident rules in bounded batches and deduplicates concurrent events', async () => {
    const { service, workflow, old } = await fixture();
    const { evaluateIncidentTriggers } = await import('@/lib/runbooks/triggers');
    const { default: applicationPrisma } = await import('@/lib/prisma');
    const original = applicationPrisma.serviceAutomationRule.findMany.bind(
      applicationPrisma.serviceAutomationRule
    );
    let largestBatch = 0;
    const spy = vi
      .spyOn(applicationPrisma.serviceAutomationRule, 'findMany')
      .mockImplementation(args => {
        const query = original(args);
        void query.then(
          rows => {
            largestBatch = Math.max(largestBatch, rows.length);
          },
          () => {}
        );
        return query;
      });
    const samples = [];
    let previous = 0;
    try {
      for (const size of [100, 1000, 10000]) {
        const ids = Array.from({ length: size - previous }, () => crypto.randomUUID());
        await testPrisma.serviceAutomationRule.createMany({
          data: ids.map(id => ({
            id,
            serviceId: service.id,
            runbookId: workflow.id,
            runbookVersionId: old.id,
            mode: 'SUGGESTED',
            versionStrategy: 'PINNED',
            inputValues: { legacy: 'test' },
          })),
        });
        await testPrisma.runbookTrigger.createMany({
          data: ids.map(id => ({ id, bindingId: id, event: 'INCIDENT_CREATED' })),
        });
        await testPrisma.runbookTriggerCondition.createMany({
          data: ids.map((id, index) => ({
            triggerId: id,
            field: 'incident.urgency',
            operator: 'EQUALS',
            value: previous === 0 && index < 5 ? 'HIGH' : 'LOW',
          })),
        });
        previous = size;
        // A rule suggests a runbook once per incident, so each size gets its own incident.
        const incident = await createTestIncident(`Trigger scale ${size}`, service.id);
        const start = performance.now();
        const source = `scale-${size}`;
        const results = await Promise.all(
          Array.from({ length: 3 }, () => evaluateIncidentTriggers(incident.id, source))
        );
        expect(results.every(result => result.matched === 5)).toBe(true);
        expect(results.reduce((total, result) => total + result.suggested, 0)).toBe(5);
        expect(await testPrisma.runbookSuggestion.count({ where: { sourceEventId: source } })).toBe(
          5
        );
        expect(await testPrisma.runbookExecution.count()).toBe(0);
        expect(largestBatch).toBeLessThanOrEqual(100);
        samples.push({
          rules: size,
          deliveries: 3,
          matchingRules: 5,
          largestBatch,
          elapsedMs: performance.now() - start,
        });
      }
    } finally {
      spy.mockRestore();
    }
    await mkdir('test-results/runbook-engine', { recursive: true });
    await writeFile(
      'test-results/runbook-engine/incident-trigger-scale.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          topology:
            'Local PostgreSQL; real trigger matcher and suggestion writes; three concurrent duplicate deliveries; no physical Agent execution',
          samples,
        },
        null,
        2
      )
    );
  }, 120000);
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

suite('discoverable archived rule history', () => {
  beforeEach(resetDatabase);
  it('searches archived rules without exposing them as active or losing evidence', async () => {
    actor.id = (await createTestUser()).id;
    const service = await createTestService('Archived history');
    const workflow = await testPrisma.runbook.create({
      data: { name: 'Retained workflow', slug: `archived-${crypto.randomUUID()}` },
    });
    const old = await testPrisma.runbookVersion.create({
      data: {
        runbookId: workflow.id,
        version: 1,
        state: 'PUBLISHED',
        definition: diagnostic,
        checksum: 'a'.repeat(64),
      },
    });
    const rule = await testPrisma.serviceAutomationRule.create({
      data: {
        serviceId: service.id,
        runbookId: workflow.id,
        runbookVersionId: old.id,
        versionStrategy: 'PINNED',
        name: 'Retained diagnostic history',
        enabled: false,
      },
    });
    await detachServiceBinding(service.id, rule.id, actor.id);
    expect((await getServiceRulePage(service.id)).rules).toHaveLength(0);
    const archived = await getServiceRulePage(service.id, undefined, testPrisma, {
      state: 'archived',
      search: 'retained diagnostic',
    });
    expect(archived.rules.map(value => value.id)).toEqual([rule.id]);
    expect(archived.rules[0]).toMatchObject({ enabled: false, runbookVersionId: old.id });
    expect(
      (
        await getServiceRulePage(service.id, undefined, testPrisma, {
          state: 'archived',
          search: 'not present',
        })
      ).rules
    ).toHaveLength(0);
  });
});
