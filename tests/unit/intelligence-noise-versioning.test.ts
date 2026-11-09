import { describe, expect, it } from 'vitest';
import {
  noiseControlDefinitionSchema,
  noiseControlRollbackInputSchema,
  type PrePagingInput,
} from '@/lib/intelligence/noise-controls/contract';
import { compileMatcher } from '@/lib/intelligence/noise-controls/matchers';
import {
  evaluatePrePagingControls,
  type CompiledPolicy,
  type PrePagingLookups,
  type PrePagingSnapshot,
} from '@/lib/intelligence/noise-controls/evaluate';
import {
  diffNoiseControlVersions,
  noiseVersionChecksum,
} from '@/lib/intelligence/noise-controls/versioning';

const dropDebug = {
  id: 'drop-debug',
  name: 'Drop debug',
  enabled: true,
  conditions: [{ field: 'severity' as const, op: 'equals' as const, value: 'info' }],
  actions: [{ type: 'DROP' as const }],
};
const tagProd = {
  id: 'tag-prod',
  name: 'Tag prod',
  enabled: true,
  conditions: [{ field: 'source' as const, op: 'exists' as const }],
  actions: [{ type: 'SET_LABEL' as const, key: 'tier', value: 'prod' }],
};

const definition = (overrides: Record<string, unknown> = {}) =>
  noiseControlDefinitionSchema.parse({ schemaVersion: 1, ...overrides });

describe('noise-control version checksum', () => {
  it('is stable under key order and changes with content or mode', () => {
    const a = definition({ storm: { enabled: true, threshold: 5 } });
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(a));
    expect(noiseVersionChecksum('SHADOW', a)).toBe(noiseVersionChecksum('SHADOW', reordered));
    expect(noiseVersionChecksum('SHADOW', a)).toMatch(/^[0-9a-f]{64}$/);
    expect(noiseVersionChecksum('ON', a)).not.toBe(noiseVersionChecksum('SHADOW', a));
    expect(noiseVersionChecksum('SHADOW', definition())).not.toBe(
      noiseVersionChecksum('SHADOW', a)
    );
  });
});

describe('noise-control version diff', () => {
  it('reports nothing for identical versions', () => {
    const d = definition({ orchestration: { rules: [dropDebug] } });
    expect(
      diffNoiseControlVersions({ mode: 'ON', definition: d }, { mode: 'ON', definition: d })
    ).toEqual([]);
  });

  it('reports mode, section fields, and orchestration rules by id', () => {
    const before = definition({
      storm: { enabled: false, threshold: 10 },
      orchestration: { rules: [dropDebug, tagProd] },
    });
    const after = definition({
      allowHighUrgency: true,
      storm: { enabled: true, threshold: 10 },
      orchestration: {
        rules: [
          { ...tagProd, actions: [{ type: 'SET_LABEL', key: 'tier', value: 'gold' }] },
          { ...dropDebug, enabled: false },
          {
            id: 'suppress-noise',
            name: 'Suppress noise',
            conditions: [{ field: 'summary', op: 'contains', value: 'noise' }],
            actions: [{ type: 'SUPPRESS' }],
          },
        ],
      },
    });
    const changes = diffNoiseControlVersions(
      { mode: 'SHADOW', definition: before },
      { mode: 'ON', definition: after }
    );
    expect(changes.map(change => [change.kind, change.path])).toEqual([
      ['changed', 'mode'],
      ['changed', 'allowHighUrgency'],
      ['changed', 'storm.enabled'],
      ['changed', 'orchestration.rules[drop-debug]'],
      ['changed', 'orchestration.rules[tag-prod]'],
      ['added', 'orchestration.rules[suppress-noise]'],
      ['reordered', 'orchestration.rules'],
    ]);
    expect(changes[3]!.summary).toBe('Rule changed: Drop debug (enabled)');
    expect(changes[4]!.summary).toBe('Rule changed: Tag prod (actions)');
  });

  it('reports removed rules and tolerates a definition that no longer parses', () => {
    const before = definition({ orchestration: { rules: [dropDebug] } });
    const unparsable = diffNoiseControlVersions(
      { mode: 'ON', definition: before },
      { mode: 'ON', definition: null }
    );
    expect(unparsable).toContainEqual(
      expect.objectContaining({ kind: 'removed', path: 'orchestration.rules[drop-debug]' })
    );
    expect(unparsable).toContainEqual(
      expect.objectContaining({ kind: 'changed', path: 'storm.threshold', after: undefined })
    );
    const removed = diffNoiseControlVersions(
      { mode: 'ON', definition: before },
      { mode: 'ON', definition: definition() }
    );
    expect(removed).toEqual([
      expect.objectContaining({
        kind: 'removed',
        path: 'orchestration.rules[drop-debug]',
        summary: 'Rule removed: Drop debug',
      }),
    ]);
  });
});

describe('rollback input', () => {
  it('needs a version id and an expected revision, and rejects unknown keys', () => {
    expect(
      noiseControlRollbackInputSchema.safeParse({ versionId: 'v1', expectedRevision: 2 }).success
    ).toBe(true);
    expect(noiseControlRollbackInputSchema.safeParse({ versionId: 'v1' }).success).toBe(false);
    expect(
      noiseControlRollbackInputSchema.safeParse({
        versionId: 'v1',
        expectedRevision: 2,
        definition: {},
      }).success
    ).toBe(false);
  });
});

describe('decisions reference the evaluated version (hot path unchanged)', () => {
  const T0 = new Date('2026-03-02T10:00:00Z');
  const lookups: PrePagingLookups = {
    findOpenIncidentByFingerprint: async () => null,
    countRecentIncidents: async () => 0,
    findStormParent: async () => null,
    recentAlertStatuses: async () => [],
  };
  const input: PrePagingInput = {
    serviceId: 'svc',
    source: 'prometheus',
    summary: 'debug chatter',
    severity: 'info',
    urgency: 'LOW',
    labels: {},
    resourceKey: null,
    fingerprintHash: null,
    dedupKey: 'k',
    receivedAt: T0,
  };
  function compiled(
    versionId: string | null | undefined,
    mode: 'ON' | 'OFF' = 'ON'
  ): CompiledPolicy {
    return {
      scopeKey: 'global',
      serviceId: null,
      mode,
      revision: 4,
      ...(versionId === undefined ? {} : { versionId }),
      definition: definition({ orchestration: { rules: [dropDebug] } }),
      orchestration: [
        {
          id: dropDebug.id,
          name: dropDebug.name,
          conditions: dropDebug.conditions.map(compileMatcher),
          actions: dropDebug.actions,
        },
      ],
    };
  }
  const snapshotOf = (policy: CompiledPolicy): PrePagingSnapshot => ({
    loadedAt: T0.getTime(),
    policies: new Map([['global', policy]]),
    windows: [],
    rules: [],
    serviceTeams: new Map(),
    topology: new Map(),
  });

  it('carries the version id on matched decisions and leaves the outcome identical', async () => {
    const versioned = await evaluatePrePagingControls(
      input,
      snapshotOf(compiled('ver_7')),
      lookups
    );
    const legacy = await evaluatePrePagingControls(input, snapshotOf(compiled(undefined)), lookups);
    expect(versioned).toMatchObject({
      action: 'DROP',
      control: 'ORCHESTRATION',
      apply: true,
      policyRevision: 4,
      policyVersionId: 'ver_7',
    });
    expect(legacy.policyVersionId).toBeNull();
    const strip = ({ elapsedMs: _e, policyVersionId: _v, ...rest }: typeof versioned) => rest;
    expect(strip(versioned)).toEqual(strip(legacy));
  });

  it('carries the version id on fail-open results too', async () => {
    const off = await evaluatePrePagingControls(
      input,
      snapshotOf(compiled('ver_8', 'OFF')),
      lookups
    );
    expect(off).toMatchObject({
      action: 'NONE',
      failOpen: { reason: 'off' },
      policyVersionId: 'ver_8',
    });
    const cold = await evaluatePrePagingControls(input, null, lookups);
    expect(cold).toMatchObject({ action: 'NONE', policyVersionId: null });
  });
});
