import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/escalation/automation-snapshot', () => ({
  captureResponderSnapshot: vi.fn(async (_tx: unknown, policyId: string) => ({
    id: policyId,
    name: 'Default policy',
    steps: [],
  })),
}));
vi.mock('@/lib/automation/jobs', () => ({ enqueueAutomationNotification: vi.fn() }));

import { compileAutomation } from '@/lib/automation/compiler';
import { checksum } from '@/lib/automation/cache';
import { builtinFields, LIMITS, type Snapshot } from '@/lib/automation/contract';
import {
  buildResponseContext,
  parseResponseContext,
  readIncidentResponseContext,
  responseContextFieldDefinitions,
} from '@/lib/automation/response-context';
import {
  persistAutomation,
  prepareAutomation,
  type IntegrationEventEnvelope,
} from '@/lib/automation/runtime';

const snapshot: Snapshot = {
  schemaVersion: 1,
  fields: [
    {
      fieldId: 'env',
      key: 'environment',
      label: 'Environment',
      type: 'ENUM',
      caseSensitive: false,
      allowedValues: ['production', 'staging'],
      aliases: { prd: 'production' },
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
    },
    {
      fieldId: 'cluster',
      key: 'cluster',
      label: 'Cluster',
      type: 'STRING',
      caseSensitive: true,
      aliases: {},
      mappings: [{ source: 'PROVIDER', path: 'cluster' }],
    },
    {
      fieldId: 'team',
      key: 'team',
      label: 'Team',
      type: 'STRING',
      caseSensitive: true,
      aliases: {},
      mappings: [],
    },
    {
      fieldId: 'region',
      key: 'region',
      label: 'Region',
      type: 'STRING',
      caseSensitive: true,
      aliases: {},
      mappings: [{ source: 'PROVIDER', path: 'region' }],
    },
  ],
  rules: [
    {
      id: 'enrich',
      name: 'Owner',
      phase: 'ENRICH',
      enabled: true,
      conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
      actions: [{ type: 'SET_CONTEXT', fieldKey: 'team', value: 'platform' }],
    },
  ],
};

let versionSeq = 0;
function fixture(options: { mode?: 'LIVE' | 'SHADOW'; corrupt?: boolean } = {}) {
  const versionId = `version-${++versionSeq}`;
  const { compiled } = compileAutomation(snapshot);
  const stored = {
    id: versionId,
    versionNumber: 7,
    compiledSnapshot: compiled,
    checksum: options.corrupt ? checksum({ wrong: true }) : checksum(compiled),
  };
  const decisionCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const versionFind = vi.fn(async () => stored);
  const tx = {
    $queryRaw: vi.fn(async () => [{ mode: options.mode ?? 'LIVE', activeVersionId: versionId }]),
    service: {
      findUnique: vi.fn(async () => ({
        policy: { id: 'policy-1', name: 'Default policy' },
        escalationPolicyId: 'policy-1',
      })),
    },
    automationVersion: { findUnique: versionFind },
    escalationPolicy: { findUnique: vi.fn() },
    incidentAutomationDecision: { create: decisionCreate },
    automationTrace: { create: vi.fn(async () => ({})) },
    backgroundJob: { create: vi.fn(async () => ({})) },
    tag: { createMany: vi.fn(), findMany: vi.fn(async () => []) },
    incidentTag: { createMany: vi.fn() },
  };
  const envelope: IntegrationEventEnvelope = {
    serviceId: 'service-1',
    integrationId: 'integration-1',
    integrationType: 'EVENTS_API',
    event: {
      event_action: 'trigger',
      dedup_key: 'context',
      payload: {
        summary: 'Disk full on db-1 token=raw-summary-secret',
        source: 'monitor',
        severity: 'critical',
        custom_details: { environment: 'PRD', password: 'hunter2-raw-secret' },
      },
    },
    providerPayload: {
      cluster: 'eu-1',
      extra: { nested: 'object-not-scalar' },
      authorization: 'Bearer raw-provider-secret',
    },
    receivedAt: new Date('2026-10-19T10:00:00.000Z'),
  };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    envelope,
    decisionCreate,
    versionFind,
    versionId,
  };
}

async function run(f: ReturnType<typeof fixture>) {
  const runtime = await prepareAutomation(f.tx, f.envelope, { priority: 'P2', urgency: 'HIGH' });
  await persistAutomation(f.tx, 'incident-1', f.envelope, runtime);
  return runtime;
}

describe('automation response context capture', () => {
  let clock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    // Wall-clock evaluation budget is not under test; a loaded host must not force a fallback.
    clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  });
  afterEach(() => clock.mockRestore());

  it('declares builtins first followed by version fields without duplicates', () => {
    const { compiled } = compileAutomation(snapshot);
    const definitions = responseContextFieldDefinitions(compiled);
    expect(definitions.map(field => field.key)).toEqual([
      ...builtinFields.map(field => field.key),
      'environment',
      'cluster',
      'team',
      'region',
    ]);
    expect(
      responseContextFieldDefinitions({
        fields: [{ fieldId: 'dup', key: 'priority', type: 'STRING' }],
      }).filter(field => field.key === 'priority')
    ).toEqual([{ fieldId: 'priority', key: 'priority', type: 'ENUM' }]);
    expect(
      responseContextFieldDefinitions({
        fields: Array.from({ length: LIMITS.fields }, (_, i) => ({
          fieldId: `f${i}`,
          key: `f${i}`,
          type: 'STRING' as const,
        })),
      })
    ).toHaveLength(builtinFields.length + LIMITS.fields);
  });

  it('captures every built-in and all authorable custom fields without truncation', () => {
    const fields = Array.from({ length: LIMITS.fields }, (_, i) => ({
      fieldId: `f${i}`,
      key: `f${i}`,
      type: 'STRING' as const,
    }));
    const definitions = responseContextFieldDefinitions({ fields });
    const context = buildResponseContext({
      versionId: 'version',
      versionNumber: 1,
      fields: definitions,
      inputContext: {},
      enrichedContext: {},
    });
    expect(context.fields).toHaveLength(builtinFields.length + LIMITS.fields);
    expect(parseResponseContext(context)).not.toBeNull();
    expect(context.fields.at(-1)?.key).toBe(`f${LIMITS.fields - 1}`);
  });

  it('fails instead of silently dropping fields beyond the shared limit', () => {
    expect(() =>
      responseContextFieldDefinitions({
        fields: Array.from({ length: LIMITS.fields + 1 }, (_, i) => ({
          fieldId: `f${i}`,
          key: `f${i}`,
          type: 'STRING' as const,
        })),
      })
    ).toThrow('CONTEXT_FIELD_LIMIT');
  });

  it('stores a checksum-valid context of declared fields only for LIVE decisions', async () => {
    const f = fixture();
    const runtime = await run(f);
    expect(runtime?.fallbackReason).toBeNull();
    expect(runtime?.versionNumber).toBe(7);
    const data = f.decisionCreate.mock.calls[0][0].data;
    const context = parseResponseContext(data.responseContext);
    expect(context).not.toBeNull();
    expect(context).toMatchObject({ versionId: f.versionId, versionNumber: 7 });
    const byKey = Object.fromEntries(context!.fields.map(field => [field.key, field]));
    expect(Object.keys(byKey).sort()).toEqual(
      [...builtinFields.map(field => field.key), 'environment', 'cluster', 'team', 'region'].sort()
    );
    expect(byKey.environment).toMatchObject({
      state: 'RECOGNIZED',
      value: 'production',
      source: 'ALERT',
    });
    expect(byKey.cluster).toMatchObject({ state: 'RECOGNIZED', value: 'eu-1', source: 'ALERT' });
    expect(byKey.team).toMatchObject({
      state: 'RECOGNIZED',
      value: 'platform',
      source: 'ENRICHMENT',
    });
    expect(byKey.region).toMatchObject({ value: null, source: 'NONE' });
    expect(byKey.priority).toMatchObject({ state: 'RECOGNIZED', value: 'P2' });
    const serialized = JSON.stringify(data.responseContext);
    for (const secret of [
      'hunter2-raw-secret',
      'raw-provider-secret',
      'raw-summary-secret',
      'object-not-scalar',
      'password',
      'authorization',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('reuses the cached version number without another version read', async () => {
    const f = fixture();
    await run(f);
    expect(f.versionFind).toHaveBeenCalledTimes(1);
    f.decisionCreate.mockClear();
    const runtime = await run(f);
    expect(f.versionFind).toHaveBeenCalledTimes(1);
    expect(runtime?.versionNumber).toBe(7);
    expect(
      parseResponseContext(f.decisionCreate.mock.calls[0][0].data.responseContext)?.versionNumber
    ).toBe(7);
  });

  it('never stores context for fallback decisions', async () => {
    const f = fixture({ corrupt: true });
    const runtime = await run(f);
    expect(runtime?.fallbackReason).toBe('VERSION_INVALID');
    const data = f.decisionCreate.mock.calls[0][0].data;
    expect(data.fallbackReason).toBe('VERSION_INVALID');
    expect(data).not.toHaveProperty('responseContext');
  });

  it('never stores a decision or context in SHADOW mode', async () => {
    const f = fixture({ mode: 'SHADOW' });
    const runtime = await run(f);
    expect(runtime?.mode).toBe('SHADOW');
    expect(f.decisionCreate).not.toHaveBeenCalled();
  });
});

describe('readIncidentResponseContext', () => {
  const context = buildResponseContext({
    versionId: 'v1',
    versionNumber: 2,
    fields: [{ fieldId: 'cluster', key: 'cluster', type: 'STRING' }],
    inputContext: { cluster: { state: 'RECOGNIZED', value: 'eu-1' } },
    enrichedContext: { cluster: { state: 'RECOGNIZED', value: 'eu-1' } },
  });
  const client = (decision: unknown) =>
    ({
      incidentAutomationDecision: { findUnique: vi.fn(async () => decision) },
    }) as unknown as Parameters<typeof readIncidentResponseContext>[0];

  it.each([
    ['no decision', null, 'NO_LIVE_DECISION'],
    ['SHADOW', { mode: 'SHADOW', fallbackReason: null, responseContext: null }, 'NO_LIVE_DECISION'],
    [
      'fallback',
      { mode: 'LIVE', fallbackReason: 'VERSION_INVALID', responseContext: null },
      'FALLBACK',
    ],
    ['historical', { mode: 'LIVE', fallbackReason: null, responseContext: null }, 'NOT_CAPTURED'],
    [
      'tampered',
      {
        mode: 'LIVE',
        fallbackReason: null,
        responseContext: { ...context, fields: [{ ...context.fields[0], value: 'us-1' }] },
      },
      'INTEGRITY_FAILED',
    ],
    [
      'extra properties',
      { mode: 'LIVE', fallbackReason: null, responseContext: { ...context, raw: 'payload' } },
      'INTEGRITY_FAILED',
    ],
  ])('returns UNAVAILABLE for %s', async (_label, decision, reason) => {
    expect(await readIncidentResponseContext(client(decision), 'incident-1')).toEqual({
      status: 'UNAVAILABLE',
      reason,
    });
  });

  it('returns an intact LIVE context', async () => {
    expect(
      await readIncidentResponseContext(
        client({ mode: 'LIVE', fallbackReason: null, responseContext: context }),
        'incident-1'
      )
    ).toEqual({ status: 'AVAILABLE', context });
  });
});
