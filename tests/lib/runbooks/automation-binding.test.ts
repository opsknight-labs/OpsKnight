import { describe, expect, it } from 'vitest';
import {
  approvedBindingTargets,
  canonicalizeContextTargetMapping,
  contextTargetMappingSchema,
  resolveBindingAutomationPlan,
  resolveContextInputs,
  resolveContextTarget,
  validateAutomationCondition,
  validateContextInputMappings,
  type AutomationContextField,
} from '@/lib/runbooks/automation-binding';

const POOL_PROD = 'cjld2cjxh0000qzrmn831i7rn';
const POOL_STAGING = 'cjld2cyuq0000t3rmniod1foy';
const AGENT = 'cjld2cyuq0001t3rmniod1foy';

const published = [
  { key: 'environment', type: 'ENUM' as const, allowedValues: ['production', 'staging'] },
  { key: 'cluster', type: 'STRING' as const, caseSensitive: true },
  { key: 'replicas', type: 'NUMBER' as const },
  { key: 'canary', type: 'BOOLEAN' as const },
];

const ctx = (overrides: Partial<Record<string, Partial<AutomationContextField>>> = {}) =>
  (
    [
      { key: 'environment', type: 'ENUM', state: 'RECOGNIZED', value: 'production' },
      { key: 'cluster', type: 'STRING', state: 'RECOGNIZED', value: 'prod-k8s-01' },
      { key: 'replicas', type: 'NUMBER', state: 'RECOGNIZED', value: 3 },
      { key: 'canary', type: 'BOOLEAN', state: 'RECOGNIZED', value: false },
    ] as AutomationContextField[]
  ).map(field => ({ ...field, ...overrides[field.key] }));

describe('authoring validation', () => {
  it('rejects unknown fields and canonicalizes ENUM values', () => {
    expect(
      validateAutomationCondition(
        { field: 'automation.nope', operator: 'EQUALS', value: 'x' },
        published
      )
    ).toEqual({ ok: false, error: expect.stringContaining('not published') });
    expect(
      validateAutomationCondition(
        { field: 'automation.environment', operator: 'IN', value: ['PRODUCTION'] },
        published
      )
    ).toEqual({ ok: true, value: ['production'] });
    expect(
      validateAutomationCondition(
        { field: 'automation.environment', operator: 'EQUALS', value: 'dev' },
        published
      ).ok
    ).toBe(false);
    expect(
      validateAutomationCondition(
        { field: 'automation.replicas', operator: 'EQUALS', value: '3' },
        published
      ).ok
    ).toBe(false);
    expect(
      validateAutomationCondition(
        { field: 'automation.canary', operator: 'CONTAINS', value: true },
        published
      ).ok
    ).toBe(false);
    expect(
      validateAutomationCondition(
        { field: 'automation.cluster', operator: 'NOT_EXISTS' },
        published
      ).ok
    ).toBe(false);
    expect(
      validateAutomationCondition(
        { field: 'automation.cluster', operator: 'IS_UNMAPPED' },
        published
      )
    ).toEqual({ ok: true, value: null });
  });

  it('type-checks input mappings against runbook inputs and never maps secrets', () => {
    const inputs = [
      { key: 'cluster', type: 'STRING' as const, required: true },
      { key: 'replicas', type: 'NUMBER' as const, required: false },
      { key: 'token', type: 'SECRET_REF' as const, required: false },
    ];
    expect(
      validateContextInputMappings(
        [{ inputKey: 'cluster', contextKey: 'environment' }],
        inputs,
        published
      )
    ).toBeNull();
    expect(
      validateContextInputMappings(
        [{ inputKey: 'replicas', contextKey: 'cluster' }],
        inputs,
        published
      )
    ).toContain('cannot supply NUMBER');
    expect(
      validateContextInputMappings(
        [{ inputKey: 'token', contextKey: 'cluster' }],
        inputs,
        published
      )
    ).toContain('cannot supply SECRET_REF');
    expect(
      validateContextInputMappings(
        [{ inputKey: 'missing', contextKey: 'cluster' }],
        inputs,
        published
      )
    ).toContain('not declared');
  });

  it('validates approved target tables', () => {
    expect(
      contextTargetMappingSchema.safeParse({
        contextKey: 'cluster',
        entries: [{ value: 'a', agentPoolId: POOL_PROD, agentId: AGENT }],
      }).success
    ).toBe(false);
    expect(
      contextTargetMappingSchema.safeParse({
        contextKey: 'cluster',
        entries: [
          { value: 'a', agentPoolId: POOL_PROD },
          { value: 'a', agentPoolId: POOL_STAGING },
        ],
      }).success
    ).toBe(false);
    expect(
      canonicalizeContextTargetMapping(
        { contextKey: 'environment', entries: [{ value: 'Production', agentPoolId: POOL_PROD }] },
        published
      )
    ).toEqual({
      ok: true,
      mapping: {
        contextKey: 'environment',
        entries: [{ value: 'production', agentPoolId: POOL_PROD }],
      },
    });
    expect(
      canonicalizeContextTargetMapping(
        { contextKey: 'replicas', entries: [{ value: 'three', agentPoolId: POOL_PROD }] },
        published
      ).ok
    ).toBe(false);
  });
});

describe('runtime resolution', () => {
  const definitions = [
    { key: 'cluster', type: 'STRING' as const, required: true },
    { key: 'replicas', type: 'NUMBER' as const, required: false },
  ];

  it('maps inputs from recognized context values', () => {
    expect(
      resolveContextInputs({
        definitions,
        mappings: [
          { inputKey: 'cluster', contextKey: 'cluster' },
          { inputKey: 'replicas', contextKey: 'replicas' },
        ],
        bindingValues: {},
        context: ctx(),
      })
    ).toEqual({
      ok: true,
      values: { cluster: 'prod-k8s-01', replicas: 3 },
      provenance: {
        cluster: { source: 'AUTOMATION_CONTEXT', contextKey: 'cluster' },
        replicas: { source: 'AUTOMATION_CONTEXT', contextKey: 'replicas' },
      },
    });
  });

  it.each([
    ['MISSING', ctx({ cluster: { state: 'MISSING', value: null } })],
    ['UNMAPPED', ctx({ cluster: { state: 'UNMAPPED', value: null } })],
    ['UNAVAILABLE', null],
  ])('blocks a required input whose context is %s', (state, context) => {
    const result = resolveContextInputs({
      definitions,
      mappings: [{ inputKey: 'cluster', contextKey: 'cluster' }],
      bindingValues: { cluster: 'static-fallback' },
      context,
    });
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining('INPUT_CONTEXT_UNRESOLVED'),
    });
    expect(result.ok ? '' : result.reason).toContain(`which is ${state}`);
  });

  it('lets optional inputs fall back to the admin-configured value', () => {
    const result = resolveContextInputs({
      definitions,
      mappings: [{ inputKey: 'replicas', contextKey: 'replicas' }],
      bindingValues: { cluster: 'c1', replicas: 2 },
      context: ctx({ replicas: { state: 'MISSING', value: null } }),
    });
    expect(result).toMatchObject({ ok: true, values: { cluster: 'c1', replicas: 2 } });
  });

  const mapping = {
    contextKey: 'environment',
    entries: [
      { value: 'production', agentPoolId: POOL_PROD },
      { value: 'staging', agentPoolId: POOL_STAGING },
    ],
  };

  it('selects only an approved target and never the prod pool for staging', () => {
    expect(resolveContextTarget(mapping, ctx())).toMatchObject({
      kind: 'MAPPED',
      agentPoolId: POOL_PROD,
    });
    expect(resolveContextTarget(mapping, ctx({ environment: { value: 'staging' } }))).toMatchObject(
      { kind: 'MAPPED', agentPoolId: POOL_STAGING }
    );
  });

  it('blocks unknown values, unresolved, removed or unavailable context', () => {
    expect(
      resolveContextTarget(
        { contextKey: 'cluster', entries: [{ value: 'prod-k8s-02', agentId: AGENT }] },
        ctx()
      )
    ).toEqual({ kind: 'BLOCKED', reason: expect.stringContaining('TARGET_UNMAPPED_VALUE') });
    expect(
      resolveContextTarget(mapping, ctx({ environment: { state: 'UNMAPPED', value: null } }))
    ).toMatchObject({ kind: 'BLOCKED', reason: expect.stringContaining('UNRESOLVED') });
    expect(resolveContextTarget({ ...mapping, contextKey: 'gone' }, ctx())).toMatchObject({
      kind: 'BLOCKED',
      reason: expect.stringContaining('TARGET_MAPPING_INVALID'),
    });
    expect(resolveContextTarget(mapping, null)).toMatchObject({
      kind: 'BLOCKED',
      reason: expect.stringContaining('UNAVAILABLE'),
    });
    expect(resolveContextTarget({ contextKey: null, entries: [] }, null)).toEqual({ kind: 'NONE' });
  });

  it('builds a plan with provenance and lists approved targets', () => {
    const binding = {
      inputValues: {},
      contextInputMappings: [{ inputKey: 'cluster', contextKey: 'cluster' }],
      contextTargetMappings: mapping,
      defaultAgentId: null,
      defaultAgentPoolId: null,
    };
    expect(resolveBindingAutomationPlan({ definitions, binding, context: ctx() })).toMatchObject({
      ok: true,
      agentPoolId: POOL_PROD,
      targetProvenance: { kind: 'CONTEXT_MAPPING', contextKey: 'environment', value: 'production' },
    });
    expect(approvedBindingTargets({ ...binding, defaultAgentId: AGENT })).toEqual({
      agentIds: new Set([AGENT]),
      poolIds: new Set([POOL_PROD, POOL_STAGING]),
    });
  });
});
