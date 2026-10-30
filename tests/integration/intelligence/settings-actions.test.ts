import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { INTELLIGENCE_SETTINGS_DEFAULTS, DEFAULT_POLICY_DEFINITION } from '@/lib/intelligence/contract';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { createTestIncident, createTestService, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

// Only the session is replaced; the actions, domain services and database are real.
const session = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock('@/lib/rbac', async () => {
  const authorization = await import('@/lib/authorization');
  return {
    assertCapability: async (capability: string) => {
      const user = session.user;
      if (!user || !authorization.hasCapability(user.role as AppRole, capability as never)) {
        throw new authorization.AuthorizationError('Unauthorized.', capability as never);
      }
      return user;
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  previewCorrelationRules,
  publishCorrelationRules,
  publishGlobalPolicy,
  replayIntelligenceDeadLetter,
  rollbackGlobalPolicy,
  saveIntelligenceSettings,
} from '@/app/(app)/settings/intelligence/actions';

const initial = { message: '', ok: false };

function form(values: Record<string, string | boolean | number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === true) data.set(key, 'on');
    else if (value !== false) data.set(key, String(value));
  }
  return data;
}

const settingsForm = (overrides: Record<string, string | boolean | number> = {}) =>
  form({ ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, expectedRevision: 0, ...overrides });

async function signIn(role: AppRole) {
  const user = await createTestUser({ role });
  session.user = { id: user.id, role };
  return user;
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
  session.user = null;
});

describe('authorization', () => {
  it('lets only managers change settings; responders and auditors can read but not write', async () => {
    expect(hasCapability('RESPONDER', CAPABILITIES.INTELLIGENCE_READ)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.INTELLIGENCE_READ)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.INTELLIGENCE_READ)).toBe(false);

    for (const role of ['RESPONDER', 'AUDITOR', 'USER'] as const) {
      await signIn(role);
      const result = await saveIntelligenceSettings(initial, settingsForm());
      expect(result.ok).toBe(false);
      expect(await db.intelligenceSettings.count()).toBe(0);
    }
  });

  it('rejects every action when signed out', async () => {
    for (const run of [
      () => saveIntelligenceSettings(initial, settingsForm()),
      () => publishGlobalPolicy(initial, form({ mode: 'SHADOW', minScore: 0.4, expectedHeadVersion: 0 })),
      () => rollbackGlobalPolicy(initial, form({ targetVersion: 1, expectedHeadVersion: 2, reason: 'x' })),
      () => replayIntelligenceDeadLetter(initial, form({ id: 'abc' })),
    ]) {
      expect((await run()).ok).toBe(false);
    }
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe('saving settings', () => {
  it('persists, audits, and uses the revision as an optimistic lock', async () => {
    const admin = await signIn('ADMIN');
    expect(await saveIntelligenceSettings(initial, settingsForm({ batchSize: 40 }))).toEqual({
      message: 'Intelligence settings saved.',
      ok: true,
    });
    expect(await db.intelligenceSettings.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      enabled: true,
      batchSize: 40,
      revision: 1,
      updatedBy: admin.id,
    });
    expect(await db.auditLog.count({ where: { action: 'intelligence.settings.updated', actorId: admin.id } })).toBe(1);

    const stale = await saveIntelligenceSettings(initial, settingsForm({ expectedRevision: 0 }));
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/changed since you opened the page/);
  });

  it('turns the kill switch off when the checkbox is cleared', async () => {
    await signIn('ADMIN');
    await saveIntelligenceSettings(initial, settingsForm());
    await saveIntelligenceSettings(initial, settingsForm({ enabled: false, expectedRevision: 1 }));
    expect((await db.intelligenceSettings.findUniqueOrThrow({ where: { id: 'default' } })).enabled).toBe(false);
  });

  it('explains validation problems without exposing internals', async () => {
    await signIn('ADMIN');
    const result = await saveIntelligenceSettings(initial, settingsForm({ maxConcurrency: 99 }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/maxConcurrency/);
    expect(await db.intelligenceSettings.count()).toBe(0);
  });

  it('treats non-numeric input as a validation error, never a crash', async () => {
    await signIn('ADMIN');
    const result = await saveIntelligenceSettings(initial, settingsForm({ batchSize: 'abc' }));
    expect(result.ok).toBe(false);
  });
});

describe('policies', () => {
  it('publishes versions, preserves existing rules, and refuses AUTO', async () => {
    await signIn('ADMIN');
    const rules = [
      { id: 'db-errors', kind: 'CONTENT_TEMPLATE', enabled: true, keys: [], windowSeconds: 300, maxWindowSeconds: 900, minScore: 0.8 },
    ];
    const policy = await db.intelligencePolicy.create({ data: { scopeKey: 'global', headVersion: 1 } });
    await db.intelligencePolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        mode: 'SHADOW',
        definition: { ...DEFAULT_POLICY_DEFINITION, correlation: { ...DEFAULT_POLICY_DEFINITION.correlation, rules } },
      },
    });

    const published = await publishGlobalPolicy(
      initial,
      form({ mode: 'SUGGEST', similarityEnabled: true, minScore: 0.5, reason: 'go live', expectedHeadVersion: 1 })
    );
    expect(published).toEqual({ message: 'Policy version 2 published.', ok: true });
    const v2 = await db.intelligencePolicyVersion.findFirstOrThrow({ where: { version: 2 } });
    expect(v2.mode).toBe('SUGGEST');
    expect(v2.reason).toBe('go live');
    expect((v2.definition as { correlation: { rules: unknown[] }; similarity: { minScore: number } }).correlation.rules).toHaveLength(1);
    expect((v2.definition as { similarity: { minScore: number } }).similarity.minScore).toBe(0.5);

    const auto = await publishGlobalPolicy(initial, form({ mode: 'AUTO', minScore: 0.5, expectedHeadVersion: 2 }));
    expect(auto.ok).toBe(false);
    expect(auto.message).toMatch(/AUTO mode is not available/);
    expect(await db.intelligencePolicyVersion.count()).toBe(2);
  });

  it('rejects an unknown mode and a stale head version', async () => {
    await signIn('ADMIN');
    expect((await publishGlobalPolicy(initial, form({ mode: 'WILD', expectedHeadVersion: 0 }))).message).toBe('Choose a valid mode.');
    const first = await publishGlobalPolicy(initial, form({ mode: 'SHADOW', minScore: 0.35, expectedHeadVersion: 0 }));
    expect(first.ok).toBe(true);
    const stale = await publishGlobalPolicy(initial, form({ mode: 'SUGGEST', minScore: 0.35, expectedHeadVersion: 0 }));
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/changed since you opened the page/);
  });

  it('restores an earlier version as a new one', async () => {
    await signIn('ADMIN');
    await publishGlobalPolicy(initial, form({ mode: 'SHADOW', similarityEnabled: true, minScore: 0.35, expectedHeadVersion: 0 }));
    await publishGlobalPolicy(initial, form({ mode: 'SUGGEST', similarityEnabled: true, minScore: 0.6, expectedHeadVersion: 1 }));
    const rolled = await rollbackGlobalPolicy(initial, form({ targetVersion: 1, expectedHeadVersion: 2, reason: 'too noisy' }));
    expect(rolled).toEqual({ message: 'Published version 3, restored from version 1.', ok: true });
    expect(await db.intelligencePolicyVersion.count()).toBe(3);
    expect(await db.auditLog.count({ where: { action: 'intelligence.policy.rolled_back' } })).toBe(1);
  });
});

describe('dead letters', () => {
  it('replays a quarantined item and validates the identifier', async () => {
    await signIn('ADMIN');
    const dead = await db.intelligenceWorkItem.create({ data: { kind: 'INDEX_INCIDENT', subjectKey: 'x', attempts: 8, lastError: 'boom' } });
    expect((await replayIntelligenceDeadLetter(initial, form({ id: 'bad id!' }))).message).toBe('Invalid work item.');
    expect((await replayIntelligenceDeadLetter(initial, form({ id: dead.id }))).ok).toBe(true);
    expect((await db.intelligenceWorkItem.findUniqueOrThrow({ where: { id: dead.id } })).attempts).toBe(0);
    expect((await replayIntelligenceDeadLetter(initial, form({ id: dead.id }))).ok).toBe(false);
  });
});

describe('correlation rules', () => {
  const rule = { id: 'same-problem', kind: 'CONTENT_TEMPLATE', enabled: true, keys: [], windowSeconds: 300, maxWindowSeconds: 900, minScore: 0.8 };
  const previewState = { message: '', ok: false };

  it('is limited to managers', async () => {
    await signIn('RESPONDER');
    expect((await previewCorrelationRules(previewState, form({ rulesJson: JSON.stringify([rule]), days: 7 }))).ok).toBe(false);
    expect((await publishCorrelationRules(initial, form({ rulesJson: JSON.stringify([rule]), expectedHeadVersion: 0 }))).ok).toBe(false);
    expect(await db.intelligencePolicyVersion.count()).toBe(0);
    expect(await db.intelligenceEvaluationRun.count()).toBe(0);
  });

  it('previews on real history without changing anything', async () => {
    const admin = await signIn('ADMIN');
    const service = await createTestService('Checkout');
    for (const n of [1, 2, 3]) {
      const incident = await createTestIncident(`Database errors on db-${n}`, service.id, { urgency: 'LOW', createdAt: new Date(Date.now() - 3_600_000 + n * 1000) });
      await indexIncident(incident.id, db);
    }
    const result = await previewCorrelationRules(previewState, form({ rulesJson: JSON.stringify([rule]), days: 7 }));
    expect(result.ok).toBe(true);
    expect(result.preview).toMatchObject({ incidentsEvaluated: 3, groups: 1, groupedIncidents: 3, suggestedLinks: 2, criticalExcluded: 0 });
    expect(await db.intelligenceEvaluationRun.count({ where: { createdById: admin.id, status: 'COMPLETED' } })).toBe(1);
    expect(await db.correlationGroup.count()).toBe(0);
    expect(await db.intelligencePolicyVersion.count()).toBe(0);
  });

  it('rejects unreadable, duplicate and invalid rules and bad day counts with clear messages', async () => {
    await signIn('ADMIN');
    const run = (rulesJson: string, days = 7) => previewCorrelationRules(previewState, form({ rulesJson, days }));
    expect((await run('not json')).message).toMatch(/could not be read/);
    expect((await run(JSON.stringify([rule, rule]))).message).toMatch(/unique id/);
    expect((await run(JSON.stringify([{ ...rule, windowSeconds: 10 }]))).ok).toBe(false);
    expect((await run(JSON.stringify([{ ...rule, windowSeconds: 600, maxWindowSeconds: 300 }]))).ok).toBe(false);
    expect((await run(JSON.stringify([rule]), 0)).message).toMatch(/between 1 and 90/);
    expect((await run(JSON.stringify([rule]), 500)).message).toMatch(/between 1 and 90/);
    expect(await db.intelligenceEvaluationRun.count()).toBe(0);
  });

  it('publishes rules as a new version while keeping the current mode and similarity settings', async () => {
    await signIn('ADMIN');
    await publishGlobalPolicy(initial, form({ mode: 'SUGGEST', similarityEnabled: true, minScore: 0.5, expectedHeadVersion: 0 }));
    const result = await publishCorrelationRules(initial, form({ rulesJson: JSON.stringify([rule]), expectedHeadVersion: 1, reason: 'group db errors' }));
    expect(result).toEqual({ message: 'Rules published as policy version 2.', ok: true });
    const v2 = await db.intelligencePolicyVersion.findFirstOrThrow({ where: { version: 2 } });
    expect(v2).toMatchObject({ mode: 'SUGGEST', reason: 'group db errors' });
    const definition = v2.definition as { similarity: { minScore: number }; correlation: { rules: Array<{ id: string }>; criticalBypass: boolean } };
    expect(definition.similarity.minScore).toBe(0.5);
    expect(definition.correlation.rules.map(r => r.id)).toEqual(['same-problem']);
    expect(definition.correlation.criticalBypass).toBe(true);
  });

  it('detects a stale head and removes all rules when asked', async () => {
    await signIn('ADMIN');
    await publishCorrelationRules(initial, form({ rulesJson: JSON.stringify([rule]), expectedHeadVersion: 0 }));
    const stale = await publishCorrelationRules(initial, form({ rulesJson: '[]', expectedHeadVersion: 0 }));
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/changed since you opened the page/);
    expect((await publishCorrelationRules(initial, form({ rulesJson: '[]', expectedHeadVersion: 1 }))).ok).toBe(true);
    const latest = await db.intelligencePolicyVersion.findFirstOrThrow({ where: { version: 2 } });
    expect((latest.definition as { correlation: { rules: unknown[] } }).correlation.rules).toEqual([]);
  });
});
