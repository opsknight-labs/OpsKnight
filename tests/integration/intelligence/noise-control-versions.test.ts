import { beforeEach, describe, expect, it } from 'vitest';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  backfillNoiseControlPolicyVersions,
  compareNoiseControlVersions,
  evaluatePrePagingControls,
  getNoiseControlPolicy,
  listNoiseControlPolicyVersions,
  listPrePagingDecisions,
  loadPrePagingSnapshot,
  noiseVersionChecksum,
  prismaLookups,
  recordPrePagingDecision,
  rollbackNoiseControlPolicy,
  saveNoiseControlPolicy,
  sweepPrePagingControls,
  type PrePagingInput,
} from '@/lib/intelligence/noise-controls';
import {
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

const actorOf = (userId: string) => ({ actorId: userId, source: 'UI' as const });

async function setup() {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  const service = await createTestService('Checkout');
  return { admin, service, actor: actorOf(admin.id) };
}

const dropDebug = {
  id: 'drop-debug',
  name: 'Drop debug',
  conditions: [{ field: 'severity', op: 'equals', value: 'info' }],
  actions: [{ type: 'DROP' }],
};
const suppressCanary = {
  id: 'suppress-canary',
  name: 'Suppress canary',
  conditions: [{ field: 'label', key: 'env', op: 'equals', value: 'canary' }],
  actions: [{ type: 'SUPPRESS' }],
};

function debugAlert(serviceId: string, overrides: Partial<PrePagingInput> = {}): PrePagingInput {
  return {
    serviceId,
    source: 'prometheus',
    summary: 'debug chatter',
    severity: 'info',
    urgency: 'LOW',
    labels: { env: 'prod' },
    resourceKey: null,
    fingerprintHash: null,
    dedupKey: 'debug-1',
    receivedAt: new Date(),
    ...overrides,
  };
}

describe('publishing orchestration rules creates immutable versions', () => {
  it('appends a version per save, points the live policy at it, and lists history with diffs', async () => {
    const { service, actor } = await setup();
    const v1 = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1, orchestration: { rules: [dropDebug] } },
        expectedRevision: 0,
      },
      actor
    );
    expect(v1).toMatchObject({ revision: 1, versionNumber: 1 });
    const v2 = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1, orchestration: { rules: [dropDebug, suppressCanary] } },
        expectedRevision: 1,
      },
      actor
    );
    expect(v2).toMatchObject({ revision: 2, versionNumber: 2 });
    expect(v2.versionId).not.toBe(v1.versionId);

    const first = await db.noiseControlPolicyVersion.findUniqueOrThrow({
      where: { id: v1.versionId! },
    });
    // The first version is untouched by the second publish.
    expect(first).toMatchObject({
      versionNumber: 1,
      origin: 'PUBLISH',
      policyRevision: 1,
      publishedById: actor.actorId,
      checksum: noiseVersionChecksum('SHADOW', first.definition),
    });
    expect(
      (first.definition as { orchestration: { rules: unknown[] } }).orchestration.rules
    ).toHaveLength(1);
    expect(
      (
        await db.noiseControlPolicy.findUniqueOrThrow({
          where: { scopeKey: `service:${service.id}` },
        })
      ).activeVersionId
    ).toBe(v2.versionId);
    expect(await getNoiseControlPolicy(service.id)).toMatchObject({
      versionId: v2.versionId,
      versionNumber: 2,
    });

    const history = await listNoiseControlPolicyVersions(service.id);
    expect(history.map(version => [version.versionNumber, version.active])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(history[0]!.changes).toEqual([
      expect.objectContaining({ kind: 'added', path: 'orchestration.rules[suppress-canary]' }),
    ]);
    expect(history[1]!.changesFromActive).toEqual([
      expect.objectContaining({ kind: 'removed', path: 'orchestration.rules[suppress-canary]' }),
    ]);
    expect(await compareNoiseControlVersions(v1.versionId!, v2.versionId!)).toMatchObject({
      from: { versionNumber: 1 },
      to: { versionNumber: 2 },
      changes: [expect.objectContaining({ kind: 'added' })],
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'intelligence.noise.policy.saved' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(audit.details)).toContain(`"versionId":"${v2.versionId}"`);
  });

  it('serializes concurrent publishes of one scope: one wins, the other gets a conflict, numbers stay dense', async () => {
    const { service, actor } = await setup();
    const save = () =>
      saveNoiseControlPolicy(
        {
          serviceId: service.id,
          mode: 'SHADOW',
          definition: { schemaVersion: 1, orchestration: { rules: [dropDebug] } },
          expectedRevision: 0,
        },
        actor
      );
    const outcomes = await Promise.allSettled([save(), save()]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await db.noiseControlPolicyVersion.findMany({ select: { versionNumber: true } })).map(
        row => row.versionNumber
      )
    ).toEqual([1]);
  });
});

describe('rollback', () => {
  it('publishes a clone of the chosen version as the newest one and keeps history intact', async () => {
    const { service, actor } = await setup();
    const v1 = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1, orchestration: { rules: [dropDebug] } },
        expectedRevision: 0,
      },
      actor
    );
    await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1, orchestration: { rules: [suppressCanary] } },
        expectedRevision: 1,
      },
      actor
    );
    // Stale revision: refused, nothing written.
    await expect(
      rollbackNoiseControlPolicy(
        { serviceId: service.id, versionId: v1.versionId!, expectedRevision: 1 },
        actor
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // A version from another scope is refused.
    await expect(
      rollbackNoiseControlPolicy(
        { serviceId: null, versionId: v1.versionId!, expectedRevision: 0 },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const restored = await rollbackNoiseControlPolicy(
      { serviceId: service.id, versionId: v1.versionId!, expectedRevision: 2 },
      actor
    );
    expect(restored).toMatchObject({ revision: 3, versionNumber: 3, mode: 'SHADOW' });
    const v3 = await db.noiseControlPolicyVersion.findUniqueOrThrow({
      where: { id: restored.versionId! },
    });
    const original = await db.noiseControlPolicyVersion.findUniqueOrThrow({
      where: { id: v1.versionId! },
    });
    expect(v3).toMatchObject({
      origin: 'ROLLBACK',
      sourceVersionId: v1.versionId,
      policyRevision: 3,
      checksum: original.checksum,
    });
    expect(v3.definition).toEqual(original.definition);
    expect(await db.noiseControlPolicyVersion.count()).toBe(3);
    expect(
      await db.auditLog.count({ where: { action: 'intelligence.noise.policy.rolled_back' } })
    ).toBe(1);
    const history = await listNoiseControlPolicyVersions(service.id);
    expect(history[0]).toMatchObject({
      versionNumber: 3,
      origin: 'ROLLBACK',
      sourceVersionNumber: 1,
    });

    // The live cache now runs the restored rules.
    const snapshot = await loadPrePagingSnapshot();
    expect(snapshot.policies.get(`service:${service.id}`)).toMatchObject({
      revision: 3,
      versionId: restored.versionId,
      orchestration: [expect.objectContaining({ id: 'drop-debug' })],
    });
  });

  it('applies the SHADOW→ON readiness gate to a rollback that would turn the policy ON', async () => {
    const { service, actor } = await setup();
    const on = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'ON',
        definition: { schemaVersion: 1 },
        expectedRevision: 0,
        acknowledgeReadiness: true,
      },
      actor
    );
    await saveNoiseControlPolicy(
      { serviceId: service.id, mode: 'OFF', definition: { schemaVersion: 1 }, expectedRevision: 1 },
      actor
    );
    await expect(
      rollbackNoiseControlPolicy(
        { serviceId: service.id, versionId: on.versionId!, expectedRevision: 2 },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      rollbackNoiseControlPolicy(
        {
          serviceId: service.id,
          versionId: on.versionId!,
          expectedRevision: 2,
          acknowledgeReadiness: true,
        },
        actor
      )
    ).resolves.toMatchObject({ mode: 'ON', versionNumber: 3 });
  });
});

describe('decisions reference the version they were evaluated against', () => {
  it('records the active version id on the decision and resolves its number for the list', async () => {
    const { service, actor } = await setup();
    const published = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1, orchestration: { rules: [dropDebug] } },
        expectedRevision: 0,
      },
      actor
    );
    const snapshot = await loadPrePagingSnapshot();
    const decision = await evaluatePrePagingControls(
      debugAlert(service.id),
      snapshot,
      prismaLookups(db)
    );
    expect(decision).toMatchObject({
      action: 'DROP',
      control: 'ORCHESTRATION',
      apply: false,
      policyRevision: 1,
      policyVersionId: published.versionId,
    });
    const id = await recordPrePagingDecision(db, decision, { serviceId: service.id });
    expect(
      (await db.prePagingDecision.findUniqueOrThrow({ where: { id: id! } })).policyVersionId
    ).toBe(published.versionId);
    expect(await listPrePagingDecisions({ serviceId: service.id })).toMatchObject([
      { id, policyVersionId: published.versionId, policyVersionNumber: 1 },
    ]);
  });
});

describe('backfill of policies saved before versioning', () => {
  async function legacyPolicy(serviceId: string | null, revision = 1) {
    return db.noiseControlPolicy.create({
      data: {
        scopeKey: serviceId ? `service:${serviceId}` : 'global',
        serviceId,
        mode: 'SHADOW',
        revision,
        updatedById: 'legacy-user',
        definition: { schemaVersion: 1, orchestration: { rules: [dropDebug] } },
      },
    });
  }

  it('captures existing rows as version 1, is idempotent, and recaptures a row rewritten without a version', async () => {
    const { service } = await setup();
    const legacy = await legacyPolicy(service.id, 4);
    // Before backfill the cache still evaluates the rules exactly as before; decisions carry no version.
    const before = await loadPrePagingSnapshot();
    expect(before.policies.get(legacy.scopeKey)).toMatchObject({ revision: 4, versionId: null });
    const unversioned = await evaluatePrePagingControls(
      debugAlert(service.id),
      before,
      prismaLookups(db)
    );
    expect(unversioned).toMatchObject({ action: 'DROP', policyVersionId: null });

    expect(await backfillNoiseControlPolicyVersions()).toEqual({
      scanned: 1,
      captured: 1,
      complete: true,
    });
    const v1 = await db.noiseControlPolicyVersion.findFirstOrThrow({
      where: { scopeKey: legacy.scopeKey },
    });
    expect(v1).toMatchObject({
      versionNumber: 1,
      origin: 'BACKFILL',
      policyRevision: 4,
      mode: 'SHADOW',
      publishedById: 'legacy-user',
      checksum: noiseVersionChecksum('SHADOW', legacy.definition),
    });
    expect(v1.definition).toEqual(legacy.definition);
    const row = await db.noiseControlPolicy.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(row).toMatchObject({ activeVersionId: v1.id, revision: 4 });
    expect(row.definition).toEqual(legacy.definition);

    // Idempotent.
    expect(await backfillNoiseControlPolicyVersions()).toEqual({
      scanned: 0,
      captured: 0,
      complete: true,
    });

    // A replica that predates versioning rewrites the row: the pointer is now stale.
    await db.noiseControlPolicy.update({
      where: { id: legacy.id },
      data: {
        revision: 5,
        definition: { schemaVersion: 1, orchestration: { rules: [suppressCanary] } },
      },
    });
    expect((await loadPrePagingSnapshot()).policies.get(legacy.scopeKey)?.versionId).toBeNull();
    const sweep = await sweepPrePagingControls();
    expect(sweep.policyVersionsCaptured).toBe(1);
    const history = await listNoiseControlPolicyVersions(service.id);
    expect(history.map(version => [version.versionNumber, version.origin, version.active])).toEqual(
      [
        [2, 'BACKFILL', true],
        [1, 'BACKFILL', false],
      ]
    );
    expect((await loadPrePagingSnapshot()).policies.get(legacy.scopeKey)?.versionId).toBe(
      history[0]!.id
    );
  });

  it('pages through rows in bounded batches', async () => {
    await setup();
    const services = await Promise.all(
      ['A', 'B', 'C'].map(name => createTestService(`Svc ${name}`))
    );
    for (const service of services) await legacyPolicy(service.id);
    await legacyPolicy(null);
    expect(await backfillNoiseControlPolicyVersions({ batchSize: 1, maxBatches: 2 })).toEqual({
      scanned: 2,
      captured: 2,
      complete: false,
    });
    expect(await backfillNoiseControlPolicyVersions({ batchSize: 2, maxBatches: 5 })).toEqual({
      scanned: 2,
      captured: 2,
      complete: true,
    });
    expect(await db.noiseControlPolicyVersion.count({ where: { origin: 'BACKFILL' } })).toBe(4);
  });

  it('captures the pre-versioning state before the first publish, and listing history captures lazily', async () => {
    const { service, actor } = await setup();
    const legacy = await legacyPolicy(service.id, 2);
    const published = await saveNoiseControlPolicy(
      {
        serviceId: service.id,
        mode: 'SHADOW',
        definition: { schemaVersion: 1 },
        expectedRevision: 2,
      },
      actor
    );
    expect(published).toMatchObject({ revision: 3, versionNumber: 2 });
    const history = await listNoiseControlPolicyVersions(service.id);
    expect(history.map(version => [version.versionNumber, version.origin])).toEqual([
      [2, 'PUBLISH'],
      [1, 'BACKFILL'],
    ]);
    // Rolling back to the captured pre-versioning state restores its rules.
    await rollbackNoiseControlPolicy(
      { serviceId: service.id, versionId: history[1]!.id, expectedRevision: 3 },
      actor
    );
    // (Restored through the current schema, so defaults the legacy row omitted are filled in.)
    expect(legacy.definition).toMatchObject({ orchestration: { rules: [dropDebug] } });
    expect((await getNoiseControlPolicy(service.id)).definition).toMatchObject({
      orchestration: { rules: [{ ...dropDebug, enabled: true }] },
    });

    const global = await legacyPolicy(null);
    expect(await listNoiseControlPolicyVersions(null)).toEqual([
      expect.objectContaining({ versionNumber: 1, origin: 'BACKFILL', active: true }),
    ]);
    expect(
      (await db.noiseControlPolicy.findUniqueOrThrow({ where: { id: global.id } })).activeVersionId
    ).not.toBeNull();
  });
});
