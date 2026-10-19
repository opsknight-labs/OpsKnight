import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import * as actions from '@/components/incident/runbook-actions';
import { startRunbookExecution, startTriggeredRunbookExecution } from '@/lib/runbooks/orchestrator';
import {
  computeDefinitionChecksum,
  computeTriggerFingerprint,
  parseRunbookDefinition,
} from '@/lib/runbooks/definition';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const identity = vi.hoisted(() => ({ actorId: '' }));
vi.mock('@/lib/rbac', () => ({
  assertCapability: vi.fn(async () => ({ id: identity.actorId })),
  assertCanViewIncident: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

async function fixture() {
  const actor = await createTestUser({ role: 'ADMIN' });
  identity.actorId = actor.id;
  const service = await createTestService('Preview boundary');
  const incident = await createTestIncident('Identical context', service.id);
  const otherIncident = await createTestIncident('Identical context', service.id);
  const definition = parseRunbookDefinition({
    steps: [
      {
        key: 'wait',
        name: 'Wait',
        type: 'WAIT',
        riskClass: 'READ_ONLY',
        config: { durationSeconds: 0 },
      },
    ],
  });
  const runbook = await testPrisma.runbook.create({
    data: { name: 'Preview authorization', slug: `preview-${crypto.randomUUID()}` },
  });
  const version = await testPrisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'DRAFT',
      definition: definition as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(definition),
    },
  });
  await testPrisma.runbookVersion.update({
    where: { id: version.id },
    data: { state: 'PUBLISHED', publishedAt: new Date() },
  });
  await testPrisma.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id },
  });
  const binding = await testPrisma.serviceAutomationRule.create({
    data: { runbookId: runbook.id, serviceId: service.id, versionStrategy: 'LATEST_PUBLISHED' },
  });
  const response = await actions.previewIncidentRunbookAction(incident.id, binding.id);
  expect(response).toHaveProperty('preview.authorizationToken');
  if (!response.preview) throw new Error(response.error);
  const preview = response.preview;
  const form = () => {
    const data = new FormData();
    data.set('previewDigest', preview.digest);
    data.set('previewAuthorizationToken', preview.authorizationToken!);
    return data;
  };
  return { actor, service, incident, otherIncident, runbook, version, binding, preview, form };
}

async function expectNoWork() {
  expect(await testPrisma.runbookExecution.count()).toBe(0);
  expect(await testPrisma.backgroundJob.count({ where: { type: 'RUNBOOK' } })).toBe(0);
  expect(await testPrisma.auditLog.count({ where: { action: 'runbook.execution.started' } })).toBe(
    0
  );
}

describeIfRealDB('incident server-action preview authorization (PostgreSQL)', () => {
  beforeEach(async () => resetDatabase(), 30000);
  afterAll(async () => testPrisma.$disconnect());

  it('retires both legacy public start actions and rejects digest-only manual execution', async () => {
    expect(actions).not.toHaveProperty('startIncidentRunbookAction');
    expect(actions).not.toHaveProperty('startIncidentRunbookSuggestionAction');
    const target = await fixture();
    const data = target.form();
    data.delete('previewAuthorizationToken');
    expect(
      await actions.executePreviewedIncidentRunbookAction(
        target.incident.id,
        target.binding.id,
        undefined,
        data
      )
    ).toHaveProperty('error');
    await expect(
      startRunbookExecution({
        runbookId: target.runbook.id,
        triggeredByUserId: target.actor.id,
        expectedPlanDigest: target.preview.digest,
      })
    ).rejects.toThrow('PREVIEW_AUTHORIZATION_REQUIRED');
    await expectNoWork();
  });

  it('rejects another incident using the original digest even when its action plan is identical', async () => {
    const target = await fixture();
    const result = await actions.executePreviewedIncidentRunbookAction(
      target.otherIncident.id,
      target.binding.id,
      undefined,
      target.form()
    );
    expect(result?.error).toContain('PREVIEW_STALE');
    await expectNoWork();
  });

  it.each(['incident', 'actor', 'binding', 'suggestion', 'tampered', 'expired'] as const)(
    'rejects a %s authorization mismatch without creating work',
    async change => {
      const target = await fixture();
      let incidentId = target.incident.id;
      let bindingId = target.binding.id;
      let suggestionId: string | undefined;
      const data = target.form();
      if (change === 'incident') incidentId = target.otherIncident.id;
      if (change === 'actor') identity.actorId = (await createTestUser({ role: 'ADMIN' })).id;
      if (change === 'binding') {
        // A different binding for the same plan is tested using a second runbook-scoped service boundary.
        const service = await createTestService('Other binding');
        incidentId = (await createTestIncident('Identical context', service.id)).id;
        bindingId = (
          await testPrisma.serviceAutomationRule.create({
            data: { serviceId: service.id, runbookId: target.runbook.id },
          })
        ).id;
      }
      if (change === 'suggestion') {
        const trigger = await testPrisma.runbookTrigger.create({
          data: { bindingId, event: 'INCIDENT_CREATED' },
        });
        suggestionId = (
          await testPrisma.runbookSuggestion.create({
            data: {
              incidentId,
              bindingId,
              runbookVersionId: target.version.id,
              fingerprint: crypto.randomUUID(),
              triggerId: trigger.id,
              sourceEventId: crypto.randomUUID(),
              planSnapshot: {
                definitionChecksum: target.version.checksum,
                inputValues: {},
                agentSelector: {},
                agentId: null,
                agentPoolId: null,
              },
            },
          })
        ).id;
      }
      if (change === 'tampered') data.set('previewAuthorizationToken', 'f'.repeat(64));
      if (change === 'expired')
        await testPrisma.runbookPreviewAuthorization.updateMany({
          data: { expiresAt: new Date(0) },
        });
      if (['incident', 'actor', 'binding', 'suggestion'].includes(change)) {
        // Even a valid digest for the destination cannot reuse another scope's bearer token.
        const destination = await actions.previewIncidentRunbookAction(
          incidentId,
          bindingId,
          suggestionId
        );
        expect(destination.preview).toBeDefined();
        data.set('previewDigest', destination.preview!.digest);
      }
      const result = await actions.executePreviewedIncidentRunbookAction(
        incidentId,
        bindingId,
        suggestionId,
        data
      );
      expect(result?.error).toContain('PREVIEW_AUTHORIZATION_INVALID');
      await expectNoWork();
    }
  );

  it.each(['title', 'description', 'status', 'urgency', 'priority', 'tags', 'service'] as const)(
    'rejects changed %s context before starting',
    async field => {
      const target = await fixture();
      if (field === 'tags') {
        const tag = await testPrisma.tag.create({ data: { name: 'changed-preview-context' } });
        await testPrisma.incidentTag.create({
          data: { incidentId: target.incident.id, tagId: tag.id },
        });
      } else if (field === 'service') {
        await testPrisma.service.update({
          where: { id: target.service.id },
          data: { name: 'Changed service context' },
        });
      } else {
        const values = {
          title: 'Changed',
          description: 'Changed',
          status: 'ACKNOWLEDGED',
          urgency: 'LOW',
          priority: 'P1',
        } as const;
        await testPrisma.incident.update({
          where: { id: target.incident.id },
          data: { [field]: Object.entries(values).find(([key]) => key === field)![1] },
        });
      }
      expect(
        await actions.executePreviewedIncidentRunbookAction(
          target.incident.id,
          target.binding.id,
          undefined,
          target.form()
        )
      ).toHaveProperty('error');
      await expectNoWork();
    }
  );

  it('rejects a bare actor-less manual entry point even for an agent-free runbook', async () => {
    const target = await fixture();
    await expect(startRunbookExecution({ runbookId: target.runbook.id })).rejects.toThrow(
      'PREVIEW_AUTHORIZATION_REQUIRED'
    );
    await expectNoWork();
  });

  it.each([
    'missingRevision',
    'staleRevision',
    'otherRuleRevision',
    'missingIncident',
    'missingBinding',
    'missingTrigger',
    'missingFingerprint',
    'manualBinding',
    'suggestedBinding',
    'disabledBinding',
    'latestVersion',
    'wrongTrigger',
    'disabledTrigger',
    'wrongIncidentService',
    'wrongVersion',
    'wrongFingerprint',
    'nonMatchingCondition',
    'invalidOrCondition',
  ] as const)('rejects automatic execution with %s', async change => {
    const target = await fixture();
    await testPrisma.serviceAutomationRule.update({
      where: { id: target.binding.id },
      data: { mode: 'AUTOMATIC', versionStrategy: 'PINNED', runbookVersionId: target.version.id },
    });
    const trigger = await testPrisma.runbookTrigger.create({
      data: { bindingId: target.binding.id, event: 'INCIDENT_CREATED' },
    });
    const request: Partial<Parameters<typeof startTriggeredRunbookExecution>[0]> = {
      runbookId: target.runbook.id,
      runbookVersionId: target.version.id,
      incidentId: target.incident.id,
      serviceId: target.service.id,
      bindingId: target.binding.id,
      triggerId: trigger.id,
      expectedRuleRevision: target.binding.configurationRevision,
      sourceEventId: 'automatic-source',
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId: 'automatic-source',
        bindingId: target.binding.id,
        runbookVersionId: target.version.id,
      }),
    };
    if (change === 'missingRevision') delete request.expectedRuleRevision;
    if (change === 'staleRevision')
      request.expectedRuleRevision = target.binding.configurationRevision + 1;
    if (change === 'otherRuleRevision') {
      const other = await testPrisma.serviceAutomationRule.create({
        data: {
          serviceId: target.service.id,
          runbookId: target.runbook.id,
          configurationRevision: 7,
        },
      });
      request.expectedRuleRevision = other.configurationRevision;
    }
    if (change === 'missingIncident') delete request.incidentId;
    if (change === 'missingBinding') delete request.bindingId;
    if (change === 'missingTrigger') delete request.triggerId;
    if (change === 'missingFingerprint') delete request.triggerFingerprint;
    if (change === 'manualBinding')
      await testPrisma.serviceAutomationRule.update({
        where: { id: target.binding.id },
        data: { mode: 'MANUAL' },
      });
    if (change === 'suggestedBinding')
      await testPrisma.serviceAutomationRule.update({
        where: { id: target.binding.id },
        data: { mode: 'SUGGESTED' },
      });
    if (change === 'disabledBinding')
      await testPrisma.serviceAutomationRule.update({
        where: { id: target.binding.id },
        data: { enabled: false },
      });
    if (change === 'latestVersion')
      await testPrisma.serviceAutomationRule.update({
        where: { id: target.binding.id },
        data: { versionStrategy: 'LATEST_PUBLISHED' },
      });
    if (change === 'wrongTrigger') request.triggerId = target.binding.id;
    if (change === 'disabledTrigger')
      await testPrisma.runbookTrigger.update({
        where: { id: trigger.id },
        data: { enabled: false },
      });
    if (change === 'wrongIncidentService')
      request.incidentId = (
        await createTestIncident('Other service', (await createTestService('Other service')).id)
      ).id;
    if (change === 'wrongVersion') request.runbookVersionId = target.runbook.id;
    if (change === 'wrongFingerprint') request.triggerFingerprint = '0'.repeat(64);
    if (change === 'invalidOrCondition') {
      await testPrisma.runbookTrigger.update({
        where: { id: trigger.id },
        data: { conditionLogic: 'OR' },
      });
      await testPrisma.runbookTriggerCondition.createMany({
        data: [
          {
            triggerId: trigger.id,
            field: 'incident.title',
            operator: 'EQUALS',
            value: 'Identical context',
            sequence: 0,
          },
          {
            triggerId: trigger.id,
            field: 'incident.severityTYPO',
            operator: 'NOT_EXISTS',
            value: 'ignored',
            sequence: 1,
          },
        ],
      });
    }
    if (change === 'nonMatchingCondition')
      await testPrisma.runbookTriggerCondition.create({
        data: {
          triggerId: trigger.id,
          field: 'incident.status',
          operator: 'EQUALS',
          value: 'RESOLVED',
        },
      });
    await expect(
      startTriggeredRunbookExecution(
        request as Parameters<typeof startTriggeredRunbookExecution>[0]
      )
    ).rejects.toThrow(/AUTOMATION_NOT_AUTHORIZED|valid execution boundary|unsupported condition/);
    await expectNoWork();
  });

  it('starts a matching enabled automatic trigger and retains its exact fingerprint', async () => {
    const target = await fixture();
    await testPrisma.serviceAutomationRule.update({
      where: { id: target.binding.id },
      data: { mode: 'AUTOMATIC', versionStrategy: 'PINNED', runbookVersionId: target.version.id },
    });
    const trigger = await testPrisma.runbookTrigger.create({
      data: { bindingId: target.binding.id, event: 'INCIDENT_CREATED' },
    });
    const triggerFingerprint = computeTriggerFingerprint({
      sourceEventId: 'valid-event',
      bindingId: target.binding.id,
      runbookVersionId: target.version.id,
    });
    const request = {
      runbookId: target.runbook.id,
      runbookVersionId: target.version.id,
      serviceId: target.service.id,
      incidentId: target.incident.id,
      bindingId: target.binding.id,
      triggerId: trigger.id,
      expectedRuleRevision: target.binding.configurationRevision,
      sourceEventId: 'valid-event',
      triggerFingerprint,
    };
    await expect(startRunbookExecution(request)).rejects.toThrow('PREVIEW_AUTHORIZATION_REQUIRED');
    const execution = await startTriggeredRunbookExecution(request);
    expect(execution).toMatchObject({
      triggeredByType: 'TRIGGER',
      triggeredByUserId: null,
      triggerId: trigger.id,
      triggerFingerprint,
      incidentId: target.incident.id,
    });
  });

  it('purges authorization records in bounded batches after retention while preserving durable audit links', async () => {
    const target = await fixture();
    await actions.executePreviewedIncidentRunbookAction(
      target.incident.id,
      target.binding.id,
      undefined,
      target.form()
    );
    const consumed = await testPrisma.runbookPreviewAuthorization.findFirstOrThrow({
      where: { consumedAt: { not: null } },
    });
    await testPrisma.runbookPreviewAuthorization.update({
      where: { id: consumed.id },
      data: { expiresAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    const oldUnused = await actions.previewIncidentRunbookAction(
      target.incident.id,
      target.binding.id
    );
    await testPrisma.runbookPreviewAuthorization.updateMany({
      where: { consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    expect(oldUnused.preview).toBeDefined();
    await actions.previewIncidentRunbookAction(target.incident.id, target.binding.id);
    const auditsBefore = await testPrisma.auditLog.count();
    expect((await reconcileRunbooks(1)).previewAuthorizationsDeleted).toBe(1);
    expect(await testPrisma.runbookPreviewAuthorization.count()).toBe(2);
    expect((await reconcileRunbooks(1)).previewAuthorizationsDeleted).toBe(1);
    expect(await testPrisma.runbookPreviewAuthorization.count()).toBe(1);
    expect(await testPrisma.auditLog.count()).toBe(auditsBefore);
    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: 'runbook.execution.started', entityId: consumed.executionId! },
    });
    expect(JSON.stringify(audit)).toContain(consumed.id);
    expect(JSON.stringify(audit)).toContain(consumed.executionId!);
  });

  it('atomically consumes one authorization and audits the responder, scope and plan without the bearer token', async () => {
    const target = await fixture();
    const results = await Promise.all([
      actions.executePreviewedIncidentRunbookAction(
        target.incident.id,
        target.binding.id,
        undefined,
        target.form()
      ),
      actions.executePreviewedIncidentRunbookAction(
        target.incident.id,
        target.binding.id,
        undefined,
        target.form()
      ),
    ]);
    expect(results.filter(result => result === undefined)).toHaveLength(1);
    expect(results.filter(result => result?.error)).toHaveLength(1);
    const executions = await testPrisma.runbookExecution.findMany();
    expect(executions).toHaveLength(1);
    const grant = await testPrisma.runbookPreviewAuthorization.findUniqueOrThrow({
      where: { id: createHash('sha256').update(target.preview.authorizationToken!).digest('hex') },
    });
    expect(grant).toMatchObject({
      actorId: target.actor.id,
      incidentId: target.incident.id,
      bindingId: target.binding.id,
      planDigest: target.preview.digest,
      executionId: executions[0].id,
    });
    expect(grant.consumedAt).toBeInstanceOf(Date);
    const audits = await testPrisma.auditLog.findMany({
      where: { action: { in: ['runbook.execution.previewed', 'runbook.execution.started'] } },
    });
    expect(audits).toHaveLength(2);
    expect(audits.every(audit => audit.actorId === target.actor.id)).toBe(true);
    expect(JSON.stringify(audits)).toContain(target.preview.digest);
    expect(JSON.stringify(audits)).toContain(grant.id);
    expect(JSON.stringify(audits)).toContain(target.binding.id);
    expect(JSON.stringify(audits)).not.toContain(target.preview.authorizationToken);
    expect(
      await actions.executePreviewedIncidentRunbookAction(
        target.incident.id,
        target.binding.id,
        undefined,
        target.form()
      )
    ).toHaveProperty('error');
    expect(await testPrisma.runbookExecution.count()).toBe(1);
  });
});
