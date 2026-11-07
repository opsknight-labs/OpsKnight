import { beforeEach, describe, expect, it } from 'vitest';
import {
  getIntelligenceSettings,
  listPolicyVersions,
  publishPolicyVersion,
  resolveEffectivePolicy,
  rollbackPolicy,
  updateIntelligenceSettings,
} from '@/lib/intelligence/settings/service';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { createTestService, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const rule = {
  id: 'db-errors',
  kind: 'CONTENT_TEMPLATE' as const,
  windowSeconds: 300,
  maxWindowSeconds: 900,
};

async function admin() {
  const user = await createTestUser({ role: 'ADMIN' });
  return { actorId: user.id, source: 'UI' as const };
}

describe('intelligence settings', () => {
  it('reads safe defaults without writing and starts at revision 0', async () => {
    const settings = await getIntelligenceSettings();
    expect(settings).toMatchObject({ enabled: false, revision: 0 });
    expect(await db.intelligenceSettings.count()).toBe(0);
  });

  it('updates with an optimistic revision lock and audits the change atomically', async () => {
    const actor = await admin();
    const input = { ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, expectedRevision: 0 };
    const saved = await updateIntelligenceSettings(input, actor);
    expect(saved).toMatchObject({ enabled: true, revision: 1 });

    await expect(updateIntelligenceSettings(input, actor)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    const second = await updateIntelligenceSettings({ ...input, batchSize: 40, expectedRevision: 1 }, actor);
    expect(second).toMatchObject({ batchSize: 40, revision: 2 });
    expect(await db.auditLog.count({ where: { action: 'intelligence.settings.updated' } })).toBe(2);
  });

  it('rejects invalid input before touching the database', async () => {
    const actor = await admin();
    await expect(
      updateIntelligenceSettings(
        { ...INTELLIGENCE_SETTINGS_DEFAULTS, maxConcurrency: 99, expectedRevision: 0 },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db.intelligenceSettings.count()).toBe(0);
  });

  it('lets exactly one of two concurrent writers win', async () => {
    const actor = await admin();
    const input = { ...INTELLIGENCE_SETTINGS_DEFAULTS, expectedRevision: 0 };
    const results = await Promise.allSettled([
      updateIntelligenceSettings({ ...input, batchSize: 30 }, actor),
      updateIntelligenceSettings({ ...input, batchSize: 31 }, actor),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getIntelligenceSettings()).revision).toBe(1);
  });
});

describe('intelligence policies', () => {
  it('publishes immutable versions with compare-and-set on the head', async () => {
    const actor = await admin();
    const first = await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      actor
    );
    expect(first).toEqual({ version: 1, scopeKey: 'global' });
    await expect(
      publishPolicyVersion(
        {},
        { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
        actor
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await db.auditLog.count({ where: { action: 'intelligence.policy.published' } })).toBe(1);
  });

  it('refuses AUTO until it is certified', async () => {
    const actor = await admin();
    await expect(
      publishPolicyVersion(
        {},
        { mode: 'AUTO', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db.intelligencePolicyVersion.count()).toBe(0);
  });

  it('rolls back by publishing a new version and never rewrites history', async () => {
    const actor = await admin();
    const withRule = {
      ...DEFAULT_POLICY_DEFINITION,
      correlation: {
        ...DEFAULT_POLICY_DEFINITION.correlation,
        rules: [{ ...rule, enabled: true, keys: [], minScore: 0.8 }],
      },
    };
    await publishPolicyVersion({}, { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    await publishPolicyVersion({}, { mode: 'SUGGEST', definition: withRule, expectedHeadVersion: 1 }, actor);

    const rolled = await rollbackPolicy(
      {},
      { targetVersion: 1, expectedHeadVersion: 2, reason: 'false merges in shadow report' },
      actor
    );
    expect(rolled).toMatchObject({ version: 3, restoredFrom: 1 });

    const { headVersion, versions } = await listPolicyVersions({});
    expect(headVersion).toBe(3);
    expect(versions.map(v => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]).toMatchObject({ mode: 'SHADOW', createdFromVersion: 1 });
    const effective = await resolveEffectivePolicy(null);
    expect(effective).toMatchObject({ version: 3, mode: 'SHADOW', source: 'global' });
    expect(effective.definition.correlation.rules).toHaveLength(0);
  });

  it('rejects rolling back to the head or to a missing version', async () => {
    const actor = await admin();
    await publishPolicyVersion({}, { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    await expect(
      rollbackPolicy({}, { targetVersion: 1, expectedHeadVersion: 1, reason: 'noop' }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      rollbackPolicy({}, { targetVersion: 7, expectedHeadVersion: 1, reason: 'missing' }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('keeps stored versions immutable at the database level', async () => {
    const actor = await admin();
    await publishPolicyVersion({}, { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    await expect(
      db.intelligencePolicyVersion.updateMany({ data: { mode: 'SUGGEST' } })
    ).rejects.toThrow(/append-only/);
  });

  it('keeps versions when the authoring user is erased', async () => {
    const actor = await admin();
    await publishPolicyVersion({}, { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    await db.user.delete({ where: { id: actor.actorId } });
    const row = await db.intelligencePolicyVersion.findFirstOrThrow();
    expect(row.createdById).toBeNull();
    expect(row.mode).toBe('SHADOW');
  });

  it('lets exactly one of two concurrent publishers advance the head', async () => {
    const actor = await admin();
    const publish = (mode: 'SHADOW' | 'SUGGEST') =>
      publishPolicyVersion({}, { mode, definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    const results = await Promise.allSettled([publish('SHADOW'), publish('SUGGEST')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.intelligencePolicyVersion.count()).toBe(1);
  });

  it('applies a service policy over the global one and honours the global kill switch', async () => {
    const actor = await admin();
    const service = await createTestService('Checkout');
    await publishPolicyVersion({}, { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    await publishPolicyVersion(
      { serviceId: service.id },
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      actor
    );

    // Intelligence is disabled by default, so nothing is effective yet.
    expect(await resolveEffectivePolicy(service.id)).toMatchObject({ mode: 'SUGGEST', effectiveMode: 'OFF', source: 'service' });

    await updateIntelligenceSettings({ ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, expectedRevision: 0 }, actor);
    expect(await resolveEffectivePolicy(service.id)).toMatchObject({ effectiveMode: 'SUGGEST', source: 'service' });
    expect(await resolveEffectivePolicy('unconfigured-service')).toMatchObject({ effectiveMode: 'SHADOW', source: 'global' });
  });

  it('defaults to OFF when no policy exists and rejects unknown services', async () => {
    const actor = await admin();
    expect(await resolveEffectivePolicy(null)).toMatchObject({ mode: 'OFF', effectiveMode: 'OFF', source: 'default', version: 0 });
    await expect(
      publishPolicyVersion(
        { serviceId: 'missing' },
        { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
        actor
      )
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
  });
});
