// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AUTO_MODE_AVAILABLE,
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
  correlationRuleSchema,
  intelligenceSettingsInputSchema,
  policyDefinitionSchema,
  publishPolicyInputSchema,
  rollbackPolicyInputSchema,
  servicePolicyScopeKey,
} from '@/lib/intelligence/contract';

const validSettings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, expectedRevision: 0 };
const validRule = {
  id: 'db-connection-errors',
  kind: 'CONTENT_TEMPLATE' as const,
  windowSeconds: 300,
  maxWindowSeconds: 900,
};

describe('intelligence settings contract', () => {
  it('ships safe defaults: disabled with modest worker budgets', () => {
    expect(INTELLIGENCE_SETTINGS_DEFAULTS.enabled).toBe(false);
    expect(intelligenceSettingsInputSchema.safeParse(validSettings).success).toBe(true);
  });

  it.each([
    ['maxConcurrency', 0],
    ['maxConcurrency', 17],
    ['batchSize', 501],
    ['candidateCap', 0],
    ['lookbackDays', 3651],
    ['maxJobMs', 99],
    ['fingerprintRetentionDays', 0],
  ])('rejects out-of-range %s=%s', (field, value) => {
    expect(
      intelligenceSettingsInputSchema.safeParse({ ...validSettings, [field]: value }).success
    ).toBe(false);
  });

  it('rejects a database budget larger than the job budget', () => {
    const result = intelligenceSettingsInputSchema.safeParse({
      ...validSettings,
      maxJobMs: 1000,
      maxDbMs: 2000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys so settings cannot smuggle extra state', () => {
    expect(
      intelligenceSettingsInputSchema.safeParse({ ...validSettings, hold: 300 }).success
    ).toBe(false);
  });
});

describe('policy definition contract', () => {
  it('has a valid default with no rules and critical bypass on', () => {
    expect(DEFAULT_POLICY_DEFINITION.correlation.rules).toEqual([]);
    expect(DEFAULT_POLICY_DEFINITION.correlation.criticalBypass).toBe(true);
  });

  it('does not allow disabling the critical bypass', () => {
    const result = policyDefinitionSchema.safeParse({
      schemaVersion: 1,
      correlation: { rules: [], criticalBypass: false },
    });
    expect(result.success).toBe(false);
  });

  it('requires keys for field and label rules but not for content templates', () => {
    expect(correlationRuleSchema.safeParse(validRule).success).toBe(true);
    expect(
      correlationRuleSchema.safeParse({ ...validRule, kind: 'EXACT_FIELD', keys: [] }).success
    ).toBe(false);
    expect(
      correlationRuleSchema.safeParse({ ...validRule, kind: 'LABEL_SET', keys: ['service'] })
        .success
    ).toBe(true);
  });

  it('bounds windows and keeps maxWindow at or above the window', () => {
    expect(correlationRuleSchema.safeParse({ ...validRule, windowSeconds: 29 }).success).toBe(false);
    expect(
      correlationRuleSchema.safeParse({ ...validRule, windowSeconds: 90_000, maxWindowSeconds: 90_000 })
        .success
    ).toBe(false);
    expect(
      correlationRuleSchema.safeParse({ ...validRule, windowSeconds: 600, maxWindowSeconds: 300 })
        .success
    ).toBe(false);
  });

  it('rejects duplicate rule ids and malformed ids', () => {
    expect(
      policyDefinitionSchema.safeParse({
        schemaVersion: 1,
        correlation: { rules: [validRule, validRule] },
      }).success
    ).toBe(false);
    expect(correlationRuleSchema.safeParse({ ...validRule, id: 'Bad Id!' }).success).toBe(false);
  });

  it('rejects unknown schema versions and unknown keys', () => {
    expect(policyDefinitionSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
    expect(policyDefinitionSchema.safeParse({ schemaVersion: 1, hold: 60 }).success).toBe(false);
  });
});

describe('policy command contracts', () => {
  it('requires a reason and an existing head version to roll back', () => {
    expect(
      rollbackPolicyInputSchema.safeParse({ targetVersion: 1, expectedHeadVersion: 3 }).success
    ).toBe(false);
    expect(
      rollbackPolicyInputSchema.safeParse({
        targetVersion: 1,
        expectedHeadVersion: 3,
        reason: 'false merges seen in shadow report',
      }).success
    ).toBe(true);
  });

  it('accepts publishing from a brand-new policy (head version 0)', () => {
    expect(
      publishPolicyInputSchema.safeParse({
        mode: 'SHADOW',
        definition: DEFAULT_POLICY_DEFINITION,
        expectedHeadVersion: 0,
      }).success
    ).toBe(true);
  });

  it('keeps AUTO unavailable until it is certified', () => {
    expect(AUTO_MODE_AVAILABLE).toBe(false);
  });

  it('namespaces service policies so a service id can never collide with the global scope', () => {
    expect(servicePolicyScopeKey('abc')).toBe('service:abc');
    expect(servicePolicyScopeKey('global')).not.toBe('global');
  });
});
