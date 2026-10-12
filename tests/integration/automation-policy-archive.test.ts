import { afterAll, beforeEach, expect, it } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestUser,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';
import { transitionPolicyArchive, assertPolicyActive } from '@/lib/escalation/policy-lifecycle';
import { updateServiceWithAutomationPolicyGuard } from '@/lib/automation/service-policy';
import { publishVersion, saveDraft } from '@/lib/automation/versioning';
import { resolveIncidentResponderRouting } from '@/lib/escalation/routing';
beforeEach(resetDatabase);
afterAll(() => db.$disconnect());
it('blocks active defaults, preserves policy rows and prevents archived reassignment', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const policy = await db.escalationPolicy.create({ data: { name: 'Retirable policy' } });
  const service = await createTestService('Policy archive test');
  await updateServiceWithAutomationPolicyGuard(service.id, { escalationPolicyId: policy.id });
  await expect(transitionPolicyArchive(policy.id, actor.id, true)).rejects.toThrow('active');
  await updateServiceWithAutomationPolicyGuard(service.id, { escalationPolicyId: null });
  await transitionPolicyArchive(policy.id, actor.id, true);
  expect(
    (await db.escalationPolicy.findUniqueOrThrow({ where: { id: policy.id } })).archivedBy
  ).toBe(actor.id);
  await expect(
    updateServiceWithAutomationPolicyGuard(service.id, { escalationPolicyId: policy.id })
  ).rejects.toThrow('archived');
  await expect(db.$transaction(tx => assertPolicyActive(tx, policy.id))).rejects.toThrow(
    'archived'
  );
  await transitionPolicyArchive(policy.id, actor.id, false);
  expect(
    await db.auditLog.count({
      where: {
        entityId: policy.id,
        actorId: actor.id,
        action: { in: ['escalation_policy.archived', 'escalation_policy.restored'] },
      },
    })
  ).toBe(2);
  await updateServiceWithAutomationPolicyGuard(service.id, { escalationPolicyId: policy.id });
  expect(
    (await db.service.findUniqueOrThrow({ where: { id: service.id } })).escalationPolicyId
  ).toBe(policy.id);
});
it('serializes archive against a concurrent new service default', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const policy = await db.escalationPolicy.create({ data: { name: 'Concurrent archive' } });
  const service = await createTestService('Concurrent default');
  const results = await Promise.allSettled([
    transitionPolicyArchive(policy.id, actor.id, true),
    updateServiceWithAutomationPolicyGuard(service.id, { escalationPolicyId: policy.id }),
  ]);
  expect(results.some(result => result.status === 'rejected')).toBe(true);
  const current = await db.escalationPolicy.findUniqueOrThrow({ where: { id: policy.id } });
  const assigned = await db.service.findUniqueOrThrow({ where: { id: service.id } });
  expect(!!current.archivedAt && assigned.escalationPolicyId === policy.id).toBe(false);
});

it('blocks current published versions but preserves historical versions on archive', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Historical archive');
  const policy = await db.escalationPolicy.create({
    data: { name: 'Historical referenced policy' },
  });
  const version = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 1,
      schemaVersion: 1,
      snapshot: { schemaVersion: 1, fields: [], rules: [] },
      compiledSnapshot: { schemaVersion: 1, fields: [], rules: [] },
      checksum: 'fixture',
      publishedBy: actor.id,
      lintReport: [],
    },
  });
  await db.automationVersionPolicyRef.create({
    data: { versionId: version.id, escalationPolicyId: policy.id, policyNameSnapshot: policy.name },
  });
  await db.serviceAutomationConfig.create({
    data: { serviceId: service.id, activeVersionId: version.id, mode: 'DISABLED' },
  });
  await expect(transitionPolicyArchive(policy.id, actor.id, true)).rejects.toThrow('published');
  await db.serviceAutomationConfig.update({
    where: { serviceId: service.id },
    data: { activeVersionId: null },
  });
  await transitionPolicyArchive(policy.id, actor.id, true);
  expect(await db.automationVersionPolicyRef.count({ where: { versionId: version.id } })).toBe(1);
  expect(await db.automationVersion.count({ where: { id: version.id } })).toBe(1);
  const incident = await createTestIncident('Pinned archived routing', service.id);
  await db.incidentAutomationDecision.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      versionId: version.id,
      mode: 'LIVE',
      routeType: 'ESCALATION_POLICY',
      escalationPolicyId: policy.id,
      evaluationAt: new Date(),
      summary: { responderPolicy: { id: policy.id, name: policy.name, steps: [] } },
    },
  });
  const pinned = await resolveIncidentResponderRouting(incident.id, service.id, db);
  expect(pinned.type).toBe('SELECTED_POLICY');
  expect(pinned.policy?.id).toBe(policy.id);
  expect(pinned.policy?.name).toBe(policy.name);
});

it('serializes archive against publication and rejects archived rollback references', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Publication archive race');
  const policy = await db.escalationPolicy.create({ data: { name: 'Publication policy' } });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: actor.id,
    expectedRevision: 0,
    snapshot: {
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'route',
          name: 'Explicit route',
          phase: 'ROUTE',
          enabled: true,
          conditions: [],
          actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policy.id }],
        },
      ],
    },
  });
  const results = await Promise.allSettled([
    transitionPolicyArchive(policy.id, actor.id, true),
    publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: draft.revision,
      expectedActiveVersionId: null,
    }),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const current = await db.escalationPolicy.findUniqueOrThrow({ where: { id: policy.id } });
  const config = await db.serviceAutomationConfig.findUniqueOrThrow({
    where: { serviceId: service.id },
  });
  expect(Boolean(current.archivedAt && config.activeVersionId)).toBe(false);
  if (config.activeVersionId) {
    await db.serviceAutomationConfig.update({
      where: { serviceId: service.id },
      data: { activeVersionId: null },
    });
    await transitionPolicyArchive(policy.id, actor.id, true);
    await expect(
      publishVersion({
        serviceId: service.id,
        actorId: actor.id,
        expectedRevision: draft.revision,
        expectedActiveVersionId: null,
        sourceVersionId: config.activeVersionId,
      })
    ).rejects.toThrow('archived');
  } else {
    await expect(
      publishVersion({
        serviceId: service.id,
        actorId: actor.id,
        expectedRevision: draft.revision,
        expectedActiveVersionId: null,
      })
    ).rejects.toThrow('archived');
  }
});
