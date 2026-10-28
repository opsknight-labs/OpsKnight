import { describe, expect, it } from 'vitest';
import { mineRuleSuggestions, type JudgedPair, type MiningIncident } from '@/lib/intelligence/learning/rule-mining';
import type { CorrelationRule } from '@/lib/intelligence/contract';

const BASE = Date.parse('2026-05-01T00:00:00Z');
let counter = 0;
const incident = (overrides: Partial<MiningIncident> = {}, minutes = 0): MiningIncident => ({
  id: `i${(counter += 1)}`,
  serviceId: 'svc',
  urgency: 'LOW',
  createdAt: new Date(BASE + minutes * 60_000),
  template: `unique title ${counter}`,
  labels: {},
  ...overrides,
});

/** `count` confirmed links between incidents sharing `labels`, `gapMinutes` apart, a day apart from each other. */
function linkedPairs(count: number, labels: (index: number) => Record<string, string>, gapMinutes = 3, linked = true): JudgedPair[] {
  return Array.from({ length: count }, (_, index) => ({
    a: incident({ labels: labels(index) }, index * 1440),
    b: incident({ labels: labels(index) }, index * 1440 + gapMinutes),
    linked,
  }));
}

/** Unrelated recent history to replay against. */
const quietHistory = Array.from({ length: 40 }, (_, index) => incident({ labels: { cluster: `c${index}` } }, index * 600));

describe('learned correlation rules', () => {
  it('proposes a label rule with the narrowest window that explains confirmed links', () => {
    const pairs = linkedPairs(4, index => ({ cluster: `c${index}`, pod: `p${index}-${Math.random()}` }));
    const [suggestion, ...rest] = mineRuleSuggestions(pairs, quietHistory, []);
    expect(rest).toEqual([]);
    expect(suggestion.rule).toMatchObject({ id: 'learned-cluster', kind: 'LABEL_SET', keys: ['cluster'], windowSeconds: 300, maxWindowSeconds: 1200, enabled: true });
    expect(suggestion).toMatchObject({ support: 4, conflicts: 0, precision: 1, coverage: 1 });
    expect(suggestion.replay.incidentsEvaluated).toBe(40);
  });

  it('widens the window only as far as the evidence needs', () => {
    const pairs = linkedPairs(4, index => ({ cluster: `c${index}` }), 40);
    expect(mineRuleSuggestions(pairs, quietHistory, [])[0].rule.windowSeconds).toBe(3600);
  });

  it('suggests a same-title rule when confirmed links share a title', () => {
    const pairs = Array.from({ length: 3 }, (_, index) => ({
      a: incident({ template: `queue backlog high ${index}` }, index * 1440),
      b: incident({ template: `queue backlog high ${index}` }, index * 1440 + 1),
      linked: true,
    }));
    const suggestions = mineRuleSuggestions(pairs, quietHistory, []);
    expect(suggestions.map(s => s.rule.id)).toEqual(['learned-same-title']);
  });

  it('does not propose a rule that people keep rejecting', () => {
    const positives = linkedPairs(4, index => ({ cluster: `c${index}` }));
    const negatives = linkedPairs(2, index => ({ cluster: `x${index}` }), 3, false);
    expect(mineRuleSuggestions([...positives, ...negatives], quietHistory, [])).toEqual([]);
    const oneNegative = linkedPairs(1, () => ({ cluster: 'x' }), 3, false);
    expect(mineRuleSuggestions([...positives, ...oneNegative], quietHistory, [])[0]).toMatchObject({ conflicts: 1, precision: 0.8 });
  });

  it('rejects a rule that would group too much of recent history', () => {
    const pairs = linkedPairs(4, () => ({ env: 'prod' }));
    const busy = Array.from({ length: 40 }, (_, index) => incident({ labels: { env: 'prod' } }, index));
    expect(mineRuleSuggestions(pairs, busy, [])).toEqual([]);
  });

  it('needs enough same-service evidence and skips rules that already exist', () => {
    expect(mineRuleSuggestions(linkedPairs(2, index => ({ cluster: `c${index}` })), quietHistory, [])).toEqual([]);
    const crossService = linkedPairs(4, index => ({ cluster: `c${index}` })).map(pair => ({ ...pair, b: { ...pair.b, serviceId: 'other' } }));
    expect(mineRuleSuggestions(crossService, quietHistory, [])).toEqual([]);

    const existing: CorrelationRule = { id: 'learned-cluster', kind: 'LABEL_SET', keys: ['cluster'], enabled: true, windowSeconds: 600, maxWindowSeconds: 1200, minScore: 0.8 };
    const pairs = linkedPairs(4, index => ({ cluster: `c${index}`, zone: `z${index}` }));
    const suggestions = mineRuleSuggestions(pairs, quietHistory, [existing]);
    expect(suggestions.map(s => s.rule.keys)).toEqual([['zone']]);
  });

  it('turns label keys into valid, unique rule ids', () => {
    const existing: CorrelationRule = { id: 'learned-app-kubernetes-io-name', kind: 'LABEL_SET', keys: ['other'], enabled: true, windowSeconds: 600, maxWindowSeconds: 1200, minScore: 0.8 };
    const pairs = linkedPairs(3, index => ({ 'app.kubernetes.io/name': `n${index}` }));
    const [suggestion] = mineRuleSuggestions(pairs, quietHistory, [existing]);
    expect(suggestion.rule.id).toBe('learned-app-kubernetes-io-name-2');
    expect(suggestion.rule.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });
});
