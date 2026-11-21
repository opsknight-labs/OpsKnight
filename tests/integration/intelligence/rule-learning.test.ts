import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { adoptRuleSuggestion, suggestCorrelationRules } from '@/lib/intelligence/learning/service';
import { listPolicyVersions, publishPolicyVersion, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { createTestIncident, createTestService, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
});

async function setup() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const ctx = { actorId: admin.id, source: 'UI' as const };
  await publishPolicyVersion({}, { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, ctx);
  await db.intelligenceSettings.create({ data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true } });
  return { admin, ctx };
}

async function labelled(title: string, serviceId: string, labels: Record<string, string>, createdAt: Date) {
  const incident = await createTestIncident(title, serviceId, { createdAt });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  await db.incidentFingerprint.update({ where: { incidentId: incident.id }, data: { labels } });
  return incident;
}

async function relate(sourceId: string, targetId: string, decision: 'ACCEPTED' | 'REJECTED', origin: 'HUMAN' | 'RULE' = 'HUMAN') {
  await db.incidentRelationship.create({
    data: { sourceIncidentId: sourceId, targetIncidentId: targetId, type: 'RELATED', origin, decision, evidence: {}, engineVersion: 'test' },
  });
}

describe('learned correlation rule suggestions', () => {
  it('learns a rule from confirmed links and publishes it only when a person adopts it', async () => {
    const { ctx } = await setup();
    const service = await createTestService('Payments');
    for (let day = 1; day <= 4; day += 1) {
      const at = new Date(Date.now() - day * 86_400_000);
      const first = await labelled(`Card auth errors ${day}`, service.id, { cluster: `east-${day}` }, at);
      const second = await labelled(`Gateway timeouts ${day}`, service.id, { cluster: `east-${day}` }, new Date(at.getTime() + 120_000));
      await relate(second.id, first.id, 'ACCEPTED', day % 2 === 0 ? 'HUMAN' : 'RULE');
    }
    // Pending engine suggestions are not human judgements and are ignored.
    const x = await labelled('Noise a', service.id, { cluster: 'west' }, new Date(Date.now() - 3_600_000));
    const y = await labelled('Noise b', service.id, { cluster: 'west' }, new Date(Date.now() - 3_500_000));
    await db.incidentRelationship.create({
      data: { sourceIncidentId: y.id, targetIncidentId: x.id, type: 'RELATED', origin: 'RULE', decision: 'SUGGESTED', evidence: {}, engineVersion: 'test' },
    });

    const suggestions = await suggestCorrelationRules();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ support: 4, conflicts: 0, precision: 1, rule: { id: 'learned-cluster', kind: 'LABEL_SET', keys: ['cluster'], windowSeconds: 300 } });
    // Suggesting changes nothing.
    expect((await resolveEffectivePolicy(null)).definition.correlation.rules).toEqual([]);

    const head = (await listPolicyVersions({}, { limit: 1 })).headVersion;
    const adopted = await adoptRuleSuggestion({ ruleId: 'learned-cluster', expectedHeadVersion: head }, ctx);
    expect(adopted.version).toBe(head + 1);
    const policy = await resolveEffectivePolicy(null);
    expect(policy.mode).toBe('SUGGEST');
    expect(policy.definition.correlation.rules.map(rule => rule.id)).toEqual(['learned-cluster']);
    const version = await db.intelligencePolicyVersion.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(version?.reason).toMatch(/learned rule learned-cluster.*4 confirmed links/);

    // Once adopted it is no longer suggested, and adopting it again is refused.
    expect(await suggestCorrelationRules()).toEqual([]);
    await expect(adoptRuleSuggestion({ ruleId: 'learned-cluster', expectedHeadVersion: head + 1 }, ctx)).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
    });
  });

  it('refuses rules it did not suggest, and stale policy heads', async () => {
    const { ctx } = await setup();
    await expect(adoptRuleSuggestion({ ruleId: 'anything', expectedHeadVersion: 1 }, ctx)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });

    const service = await createTestService('Payments');
    for (let day = 1; day <= 3; day += 1) {
      const at = new Date(Date.now() - day * 86_400_000);
      const a = await labelled(`A ${day}`, service.id, { zone: `z${day}` }, at);
      const b = await labelled(`B ${day}`, service.id, { zone: `z${day}` }, new Date(at.getTime() + 60_000));
      await relate(b.id, a.id, 'ACCEPTED');
    }
    await expect(adoptRuleSuggestion({ ruleId: 'learned-zone', expectedHeadVersion: 0 }, ctx)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('drops a candidate once people reject what it would suggest', async () => {
    await setup();
    const service = await createTestService('Payments');
    for (let day = 1; day <= 6; day += 1) {
      const at = new Date(Date.now() - day * 86_400_000);
      const a = await labelled(`A ${day}`, service.id, { zone: `z${day}` }, at);
      const b = await labelled(`B ${day}`, service.id, { zone: `z${day}` }, new Date(at.getTime() + 60_000));
      await relate(b.id, a.id, day <= 3 ? 'ACCEPTED' : 'REJECTED', 'RULE');
    }
    expect(await suggestCorrelationRules()).toEqual([]);
  });
});
