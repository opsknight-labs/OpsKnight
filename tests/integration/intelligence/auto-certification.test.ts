import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_ENGINE_VERSION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { publishPolicyVersion, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { evaluateServiceQuality, getAutoGate } from '@/lib/intelligence/evaluation/quality';
import { correlateIncident } from '@/lib/intelligence/correlation/handler';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { decideRelationship } from '@/lib/intelligence/correlation/commands';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
const definition = {
  ...DEFAULT_POLICY_DEFINITION,
  correlation: {
    criticalBypass: true as const,
    rules: [
      {
        id: 'template',
        kind: 'CONTENT_TEMPLATE' as const,
        enabled: true,
        keys: [],
        windowSeconds: 300,
        maxWindowSeconds: 900,
        minScore: 0.8,
      },
    ],
  },
};
const settings = {
  ...INTELLIGENCE_SETTINGS_DEFAULTS,
  revision: 1,
  enabled: true,
  maxDbMs: 30000,
  maxJobMs: 60000,
};
async function setup() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const actor = { actorId: admin.id, source: 'UI' as const };
  const service = await createTestService('Checkout');
  await publishPolicyVersion({}, { mode: 'SHADOW', definition, expectedHeadVersion: 0 }, actor);
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  return { admin, actor, service };
}
async function reviewedFixture(serviceId: string, userId: string) {
  const policy = await resolveEffectivePolicy(serviceId);
  const createdAt = new Date(Date.now() - 3600000);
  const reviewedAt = new Date(Date.now() - 10000);
  await db.incident.createMany({
    data: Array.from({ length: 540 }, (_, i) => ({
      id: `label-${i}`,
      title: 'Synthetic reviewed incident',
      serviceId,
      urgency: i >= 490 ? ('HIGH' as const) : ('LOW' as const),
      createdAt,
    })),
  });
  const group = await db.correlationGroup.create({
    data: {
      policyId: policy.policyId!,
      policyVersion: policy.version,
      ruleId: 'template',
      scopeKind: 'SERVICE',
      scopeHash: 'labelled',
      signatureHash: 'labelled',
      windowStart: createdAt,
      windowEnd: new Date(+createdAt + 300000),
      maxWindowEnd: new Date(+createdAt + 900000),
    },
  });
  await db.correlationMember.createMany({
    data: Array.from({ length: 440 }, (_, i) => ({
      incidentId: `label-${i}`,
      groupId: group.id,
      score: 1,
      evidence: {},
      policyVersion: policy.version,
      engineVersion: INTELLIGENCE_ENGINE_VERSION,
      createdAt,
    })),
  });
  await db.incidentRelationship.createMany({
    data: Array.from({ length: 270 }, (_, i) => ({
      id: `review-${i}`,
      sourceIncidentId: `label-${2 * i}`,
      targetIncidentId: `label-${2 * i + 1}`,
      type: 'RELATED' as const,
      origin: 'HUMAN' as const,
      decision: i < 220 ? ('ACCEPTED' as const) : ('REJECTED' as const),
      evidence: {},
      engineVersion: INTELLIGENCE_ENGINE_VERSION,
    })),
  });
  await db.incidentRelationshipEvent.createMany({
    data: Array.from({ length: 270 }, (_, i) => ({
      relationshipId: `review-${i}`,
      toDecision: i < 220 ? ('ACCEPTED' as const) : ('REJECTED' as const),
      actorType: 'USER' as const,
      actorId: userId,
      reasonCode: 'HUMAN_REVIEW',
      createdAt: reviewedAt,
    })),
  });
  return policy;
}
async function fresh(serviceId: string, ageSeconds: number, urgency: 'LOW' | 'HIGH' = 'LOW') {
  const incident = await createTestIncident('Database errors on node-1', serviceId, {
    urgency,
    createdAt: new Date(Date.now() - ageSeconds * 1000),
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

describe('service-scoped AUTO certification', () => {
  it('fails closed without reviewed evidence and never enables global AUTO', async () => {
    const { actor, service } = await setup();
    expect((await getAutoGate(service.id, definition)).allowed).toBe(false);
    await expect(
      publishPolicyVersion(
        { serviceId: service.id },
        { mode: 'AUTO', definition, expectedHeadVersion: 0 },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      publishPolicyVersion({}, { mode: 'AUTO', definition, expectedHeadVersion: 1 }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('requires explicit certification and invalidates it on policy, expiry and new human decisions', async () => {
    const { actor, admin, service } = await setup();
    const policy = await reviewedFixture(service.id, admin.id);
    expect((await evaluateServiceQuality(service.id, policy, actor, false)).allowed).toBe(true);
    expect((await getAutoGate(service.id, definition)).allowed).toBe(false);
    const result = await evaluateServiceQuality(service.id, policy, actor, true);
    expect(result).toMatchObject({
      allowed: true,
      metrics: { predictions: 220, negativeLabels: 50, criticalLabels: 25, precision: 1 },
    });
    expect((await getAutoGate(service.id, definition)).allowed).toBe(true);
    expect(
      (
        await getAutoGate(service.id, {
          ...definition,
          similarity: { ...definition.similarity, minScore: 0.99 },
        })
      ).allowed
    ).toBe(false);
    expect(
      (await getAutoGate(service.id, definition, db, new Date(Date.now() + 8 * 86400000))).allowed
    ).toBe(false);
    await db.incidentRelationshipEvent.create({
      data: {
        relationshipId: 'review-0',
        toDecision: 'REVERTED',
        actorType: 'USER',
        actorId: admin.id,
        reasonCode: 'HUMAN_REVERTED',
      },
    });
    expect((await getAutoGate(service.id, definition)).allowed).toBe(false);
  });
  it('groups only after initial paging, excludes HIGH, preserves incidents and honors undo on replay', async () => {
    const { actor, admin, service } = await setup();
    const policy = await reviewedFixture(service.id, admin.id);
    await evaluateServiceQuality(service.id, policy, actor, true);
    await publishPolicyVersion(
      { serviceId: service.id },
      { mode: 'AUTO', definition, expectedHeadVersion: 0 },
      actor
    );
    const anchor = await fresh(service.id, 30);
    const child = await fresh(service.id, 10);
    const critical = await fresh(service.id, 5, 'HIGH');
    const before = await db.incident.findMany({
      where: { id: { in: [anchor.id, child.id, critical.id] } },
      orderBy: { id: 'asc' },
    });
    expect(await correlateIncident({ subjectKey: anchor.id }, settings)).toMatchObject({
      groups: 1,
    });
    const paging = await db.backgroundJob.create({
      data: {
        type: 'SCHEDULED_TASK',
        status: 'PENDING',
        scheduledAt: new Date(),
        payload: { incidentId: child.id, effect: 'TRIGGER_ESCALATION_NOTIFICATIONS' },
      },
    });
    expect(await correlateIncident({ subjectKey: child.id }, settings)).toMatchObject({
      outcome: 'no_match',
    });
    expect(await db.incidentRelationship.count({ where: { sourceIncidentId: child.id } })).toBe(0);
    expect(await db.backgroundJob.findUnique({ where: { id: paging.id } })).toEqual(paging);
    await db.backgroundJob.update({ where: { id: paging.id }, data: { status: 'COMPLETED' } });
    expect(await correlateIncident({ subjectKey: child.id }, settings)).toMatchObject({
      suggestions: 1,
    });
    const link = await db.incidentRelationship.findFirstOrThrow({
      where: { sourceIncidentId: child.id },
    });
    expect(link).toMatchObject({
      targetIncidentId: anchor.id,
      decision: 'ACCEPTED',
      evidence: { automatic: true },
    });
    expect(await correlateIncident({ subjectKey: critical.id }, settings)).toMatchObject({
      outcome: 'skipped_critical',
    });
    expect(
      await db.incident.findMany({
        where: { id: { in: [anchor.id, child.id, critical.id] } },
        orderBy: { id: 'asc' },
      })
    ).toEqual(before);
    const userActor = await resolveUserActor(admin.id);
    await decideRelationship(userActor!, { relationshipId: link.id, decision: 'REVERTED' });
    expect((await getAutoGate(service.id, definition)).allowed).toBe(false);
    await evaluateServiceQuality(service.id, await resolveEffectivePolicy(service.id), actor, true);
    await correlateIncident({ subjectKey: child.id }, settings);
    expect(await db.incidentRelationship.findUnique({ where: { id: link.id } })).toMatchObject({
      decision: 'REVERTED',
    });
  });
});
