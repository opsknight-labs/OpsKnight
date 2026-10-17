import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { emptySnapshot } from '@/lib/automation/contract';
import { saveDraft, publishVersion } from '@/lib/automation/versioning';

describe('automation history and service deletion cascade guards', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('cascades AutomationVersion, config, draft, and policy refs on service deletion when 0 incidents exist', async () => {
    const actor = await createTestUser({ role: 'ADMIN' });
    const policy = await db.escalationPolicy.create({ data: { name: 'Cascade Test Policy' } });
    const service = await db.service.create({
      data: { name: 'Cascade Service', escalationPolicyId: policy.id },
    });

    // Save draft with routing rule to policy
    const draft = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      snapshot: {
        ...emptySnapshot,
        rules: [
          {
            id: 'rule-cascade',
            name: 'Cascade route',
            phase: 'ROUTE',
            enabled: true,
            conditions: [],
            actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policy.id }],
          },
        ],
      },
      expectedRevision: 0,
    });

    // Publish version
    const version = await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: draft.revision,
      expectedActiveVersionId: null,
    });

    expect(await db.automationVersion.count({ where: { serviceId: service.id } })).toBe(1);
    expect(await db.automationDraft.count({ where: { serviceId: service.id } })).toBe(1);
    expect(await db.serviceAutomationConfig.count({ where: { serviceId: service.id } })).toBe(1);
    expect(await db.automationVersionPolicyRef.count({ where: { versionId: version.id } })).toBe(1);

    // Delete service directly with 0 incidents
    await db.service.delete({ where: { id: service.id } });

    // Everything cascaded cleanly
    expect(await db.service.findUnique({ where: { id: service.id } })).toBeNull();
    expect(await db.automationVersion.count({ where: { serviceId: service.id } })).toBe(0);
    expect(await db.automationDraft.count({ where: { serviceId: service.id } })).toBe(0);
    expect(await db.serviceAutomationConfig.count({ where: { serviceId: service.id } })).toBe(0);
    expect(await db.automationVersionPolicyRef.count({ where: { versionId: version.id } })).toBe(0);
    // Referenced escalation policy is unaffected
    expect(await db.escalationPolicy.findUnique({ where: { id: policy.id } })).not.toBeNull();
  });

  it('blocks service deletion when incidents with IncidentAutomationDecision exist', async () => {
    const actor = await createTestUser({ role: 'ADMIN' });
    const policy = await db.escalationPolicy.create({ data: { name: 'Protected Policy' } });
    const service = await db.service.create({
      data: { name: 'Protected Service', escalationPolicyId: policy.id },
    });

    const draft = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      snapshot: {
        ...emptySnapshot,
        rules: [
          {
            id: 'rule-protect',
            name: 'Route rule',
            phase: 'ROUTE',
            enabled: true,
            conditions: [],
            actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policy.id }],
          },
        ],
      },
      expectedRevision: 0,
    });

    const version = await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: draft.revision,
      expectedActiveVersionId: null,
    });

    const incident = await db.incident.create({
      data: {
        title: 'Guarded Incident',
        serviceId: service.id,
        status: 'OPEN',
      },
    });

    await db.incidentAutomationDecision.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        versionId: version.id,
        mode: 'LIVE',
        routeType: 'ESCALATION_POLICY',
        escalationPolicyId: policy.id,
        evaluationAt: new Date(),
        summary: {},
      },
    });

    // Attempting to delete service must be rejected due to foreign key RESTRICT
    await expect(db.service.delete({ where: { id: service.id } })).rejects.toThrow();

    // Verify service and decision remain intact
    expect(await db.service.findUnique({ where: { id: service.id } })).not.toBeNull();
    expect(await db.incidentAutomationDecision.findUnique({ where: { incidentId: incident.id } })).not.toBeNull();
  });

  it('blocks escalation policy deletion when referenced by AutomationVersionPolicyRef or Decision', async () => {
    const actor = await createTestUser({ role: 'ADMIN' });
    const policy = await db.escalationPolicy.create({ data: { name: 'Dependency Policy' } });
    const service = await db.service.create({
      data: { name: 'Dependent Service', escalationPolicyId: policy.id },
    });

    const draft = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      snapshot: {
        ...emptySnapshot,
        rules: [
          {
            id: 'rule-dep',
            name: 'Route rule',
            phase: 'ROUTE',
            enabled: true,
            conditions: [],
            actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policy.id }],
          },
        ],
      },
      expectedRevision: 0,
    });

    await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: draft.revision,
      expectedActiveVersionId: null,
    });

    // Deleting the referenced policy directly must fail
    await expect(db.escalationPolicy.delete({ where: { id: policy.id } })).rejects.toThrow();
  });
});
