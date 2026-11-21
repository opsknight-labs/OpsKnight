import { describe, expect, it } from 'vitest';
import {
  measureQuality,
  assessAutoQuality,
  assessRuleCoverage,
  assessWithPool,
  correlationRuleSignature,
} from '@/lib/intelligence/evaluation/quality-metrics';

const perfect = () => [
  ...Array.from({ length: 220 }, () => ({
    predicted: true,
    linked: true,
    critical: false,
    score: 1,
  })),
  ...Array.from({ length: 25 }, () => ({
    predicted: false,
    linked: false,
    critical: false,
    score: 0,
  })),
  ...Array.from({ length: 25 }, () => ({
    predicted: false,
    linked: false,
    critical: true,
    score: 0,
  })),
];
describe('reviewed shadow quality', () => {
  it('fails closed without enough independent positive, negative and critical examples', () => {
    expect(assessAutoQuality(measureQuality([])).allowed).toBe(false);
    expect(assessAutoQuality(measureQuality(perfect().slice(0, 100))).allowed).toBe(false);
    expect(assessAutoQuality(measureQuality(perfect().filter(p => !p.critical))).allowed).toBe(
      false
    );
    expect(assessAutoQuality(measureQuality(perfect())).allowed).toBe(true);
  });
  it('measures false positives, missed links and reliability bins', () => {
    const result = measureQuality([
      { predicted: true, linked: true, critical: false, score: 0.9 },
      { predicted: true, linked: false, critical: true, score: 0.9 },
      { predicted: false, linked: true, critical: false, score: 0.1 },
      { predicted: false, linked: false, critical: false, score: 0.1 },
    ]);
    expect(result).toMatchObject({
      precision: 0.5,
      recall: 0.5,
      falseMergeRate: 0.5,
      criticalFalseMerges: 1,
    });
    expect(result.calibration.reduce((sum, bin) => sum + bin.count, 0)).toBe(4);
    expect(assessAutoQuality(result).allowed).toBe(false);
  });
  it('never certifies a critical false merge, even with otherwise strong precision', () => {
    expect(
      assessAutoQuality(
        measureQuality([...perfect(), { predicted: true, linked: false, critical: true, score: 1 }])
      ).allowed
    ).toBe(false);
  });
});

describe('per-rule certification coverage', () => {
  const metrics = measureQuality(perfect());
  const rule = { id: 'topology', enabled: true, kind: 'TOPOLOGY' };
  it('does not let aggregate quality certify an unmeasured rule or topology scope', () => {
    expect(assessRuleCoverage([rule], []).allowed).toBe(false);
    expect(
      assessRuleCoverage([rule], [{ ruleId: rule.id, metrics, crossService: measureQuality([]) }])
        .allowed
    ).toBe(false);
    expect(
      assessRuleCoverage([rule], [{ ruleId: rule.id, metrics, crossService: metrics }]).allowed
    ).toBe(true);
    expect(
      assessRuleCoverage(
        [rule, { ...rule, id: 'new-rule' }],
        [{ ruleId: rule.id, metrics, crossService: metrics }]
      ).allowed
    ).toBe(false);
  });
});

describe('pooled certification evidence', () => {
  const rule = {
    id: 'template',
    kind: 'CONTENT_TEMPLATE' as const,
    enabled: true,
    keys: [],
    windowSeconds: 300,
    maxWindowSeconds: 900,
    minScore: 0.8,
  };
  const rules = [rule];
  const good = measureQuality(perfect());
  const thin = measureQuality(perfect().slice(0, 50));
  const perRule = (metrics: typeof good) => [
    { ruleId: 'template', metrics, crossService: metrics },
  ];
  it('signs a rule by behaviour, not by id, enablement or key order', () => {
    expect(correlationRuleSignature({ ...rule, id: 'renamed', enabled: false })).toBe(
      correlationRuleSignature(rule)
    );
    expect(correlationRuleSignature({ ...rule, kind: 'LABEL_SET', keys: ['b', 'a'] })).toBe(
      correlationRuleSignature({ ...rule, kind: 'LABEL_SET', keys: ['a', 'b'] })
    );
    expect(correlationRuleSignature({ ...rule, minScore: 0.9 })).not.toBe(
      correlationRuleSignature(rule)
    );
  });
  it('certifies a thin service from pooled evidence with unchanged thresholds, and labels it', () => {
    expect(assessWithPool(rules, thin, perRule(thin))).toMatchObject({ allowed: false });
    const gate = assessWithPool(rules, thin, perRule(thin), {
      ...good,
      perRule: perRule(good),
      services: 4,
    });
    expect(gate).toMatchObject({ allowed: true, pooled: true });
    expect(gate.reason).toMatch(/pooled/i);
    // Thresholds are not relaxed: thin pooled evidence still fails.
    expect(
      assessWithPool(rules, thin, perRule(thin), { ...thin, perRule: perRule(thin), services: 4 })
        .allowed
    ).toBe(false);
  });
  it('never pools over a local critical false merge', () => {
    const bad = measureQuality([
      ...perfect().slice(0, 50),
      { predicted: true, linked: false, critical: true, score: 1 },
    ]);
    expect(
      assessWithPool(rules, bad, perRule(bad), { ...good, perRule: perRule(good), services: 4 })
        .allowed
    ).toBe(false);
  });
  it('prefers local evidence when it passes on its own', () => {
    expect(assessWithPool(rules, good, perRule(good))).toMatchObject({
      allowed: true,
      pooled: false,
    });
  });
});
