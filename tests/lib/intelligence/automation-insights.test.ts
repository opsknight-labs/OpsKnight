import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { opsInsightItemSchema } from '@/lib/intelligence/ops-insights/contract';
import {
  mineAutomationRules,
  ruleSignature,
  type MiningGroup,
} from '@/lib/intelligence/learning/automation-mining';
import {
  automationRuleHealthProducer,
  type AutomationRuleHealthInput,
} from '@/lib/intelligence/ops-insights/producers/automation-rule-health';
import { automationSuggestedRulesProducer } from '@/lib/intelligence/ops-insights/producers/automation-suggested-rules';
import {
  parseSuggestedRule,
  ruleFromSuggestion,
  suggestedRuleHref,
  SUGGESTED_RULE_PARAM,
} from '@/lib/automation/suggested-rule';

const group = (
  severity: string | null,
  source: string | null,
  incidents: number,
  correctedTo: MiningGroup['correctedTo'] = {}
): MiningGroup => ({ severity, source, incidents, correctedTo });

describe('mineAutomationRules', () => {
  it('suggests a stable correction with its support and Wilson bound', () => {
    const [suggestion, ...rest] = mineAutomationRules([
      group('critical', 'db', 20, { P1: 18 }),
      group('warning', 'db', 30),
      group('critical', 'web', 10),
    ]);
    expect(rest).toEqual([]);
    expect(suggestion.rule).toEqual({
      name: 'Set P1 when severity is critical and source is db',
      conditions: [
        { fieldKey: 'severity', operator: 'EQ', value: 'critical' },
        { fieldKey: 'source', operator: 'EQ', value: 'db' },
      ],
      priority: 'P1',
    });
    expect(suggestion).toMatchObject({ incidents: 20, corrected: 18 });
    expect(suggestion.confidence).toBeGreaterThan(0.6);
  });

  it('prefers the general association over a narrower one with the same priority', () => {
    const suggestions = mineAutomationRules([
      group('critical', 'db', 12, { P1: 12 }),
      group('critical', 'web', 12, { P1: 12 }),
      group('warning', 'db', 20),
      group('warning', 'web', 20),
    ]);
    expect(suggestions.map(s => s.key)).toEqual(['severity=critical&source=>P1']);
  });

  it('needs enough support and confidence', () => {
    expect(mineAutomationRules([group('critical', 'db', 4, { P1: 4 })])).toEqual([]);
    expect(mineAutomationRules([group('critical', 'db', 100, { P1: 10 })])).toEqual([]);
  });

  it('skips a rule that already exists', () => {
    const existing = new Set([
      ruleSignature({
        conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'Critical' }],
        priority: 'P1',
      }),
    ]);
    expect(mineAutomationRules([group('critical', null, 12, { P1: 12 })], { existing })).toEqual(
      []
    );
  });

  it('mines team hand-offs into a route through the one policy paging that team first', () => {
    const teamGroup = (source: string, incidents: number, teamTo: Record<string, number>) => ({
      ...group(null, source, incidents),
      teamTo,
    });
    const groups = [teamGroup('postgres', 10, { dba: 9 }), teamGroup('web', 30, {})];
    // Without a policy for the team there is nothing a rule could do.
    expect(mineAutomationRules(groups)).toEqual([]);
    const [suggestion, ...rest] = mineAutomationRules(groups, { teamPolicies: { dba: 'pol-dba' } });
    expect(rest).toEqual([]);
    expect(suggestion).toMatchObject({
      key: 'severity=&source=postgres>team:dba',
      teamId: 'dba',
      incidents: 10,
      corrected: 9,
      rule: {
        name: 'Route to a policy when source is postgres',
        conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'postgres' }],
        policyId: 'pol-dba',
      },
    });
    expect(suggestion.rule.priority).toBeUndefined();
    // An existing route rule silences it; a priority rule with the same conditions does not.
    const existing = new Set([
      ruleSignature({ conditions: suggestion.rule.conditions, priority: 'P1' }),
    ]);
    expect(
      mineAutomationRules(groups, { teamPolicies: { dba: 'pol-dba' }, existing })
    ).toHaveLength(1);
    existing.add(ruleSignature({ conditions: suggestion.rule.conditions, policyId: 'pol-dba' }));
    expect(mineAutomationRules(groups, { teamPolicies: { dba: 'pol-dba' }, existing })).toEqual([]);
  });

  it('applies the support and confidence thresholds to hand-offs too', () => {
    const teamPolicies = { dba: 'pol-dba' };
    const handOffs = (incidents: number, handed: number) => [
      { ...group(null, 'postgres', incidents), teamTo: { dba: handed } },
    ];
    expect(mineAutomationRules(handOffs(8, 4), { teamPolicies })).toEqual([]); // support < 5
    expect(mineAutomationRules(handOffs(100, 10), { teamPolicies })).toEqual([]); // low confidence
    expect(mineAutomationRules(handOffs(12, 12), { teamPolicies })).toHaveLength(1);
  });

  it('reads at most maxGroups groups, the largest first', () => {
    const groups = [group('critical', 'web', 20, { P1: 18 }), group('a', 'b', 50)];
    expect(mineAutomationRules(groups)).not.toEqual([]);
    // Only the larger, uncorrected group is read: nothing to suggest.
    expect(mineAutomationRules(groups, { limits: { maxGroups: 1 } })).toEqual([]);
  });
});

describe('suggested rule links', () => {
  it('round-trips through the workspace URL and becomes a draft rule', () => {
    const rule = mineAutomationRules([group('critical', 'db', 20, { P2: 19 })])[0].rule;
    const href = suggestedRuleHref('svc-1', rule)!;
    expect(href.length).toBeLessThanOrEqual(300);
    const raw = new URL(href, 'https://x').searchParams.get(SUGGESTED_RULE_PARAM);
    const parsed = parseSuggestedRule(raw);
    expect(parsed).toEqual(rule);
    expect(ruleFromSuggestion(parsed!, 'r1')).toMatchObject({
      id: 'r1',
      phase: 'ENRICH',
      enabled: true,
      actions: [{ type: 'SET_PRIORITY', value: 'P2' }],
    });
  });

  it('rejects tampered suggestions', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(parseSuggestedRule('not base64 json')).toBeNull();
    expect(parseSuggestedRule(encode([[['severity', 'DROP', 'x']], 'P1']))).toBeNull();
    expect(parseSuggestedRule(encode([[], 'P1']))).toBeNull();
    expect(parseSuggestedRule(encode([[['severity', 'EQ', 'critical']], 'P9']))).toBeNull();
    expect(parseSuggestedRule(encode([[['severity', 'EQ', 'critical']], 0]))).toMatchObject({
      noEscalation: true,
      name: 'Do not escalate when severity is critical',
    });
  });
});

const healthy: AutomationRuleHealthInput = {
  serviceId: 'svc-1',
  versionDays: 30,
  decisions: 400,
  routeRules: [
    { id: 'r-db', matched: 120 },
    { id: 'r-old', matched: 0 },
    { id: 'r-late', matched: 0 },
  ],
  sample: {
    events: 200,
    rules: [
      { id: 'r-tag', phase: 'ENRICH', matched: 0, shadowed: 0 },
      { id: 'r-db', phase: 'ROUTE', matched: 60, shadowed: 0 },
      { id: 'r-old', phase: 'ROUTE', matched: 0, shadowed: 0 },
      { id: 'r-late', phase: 'ROUTE', matched: 0, shadowed: 40 },
    ],
    unmapped: [
      { field: 'environment', count: 120 },
      { field: 'region', count: 10 },
    ],
  },
  routes: [
    { ruleId: null, decisions: 200, overridden: 5 },
    { ruleId: 'r-db', decisions: 50, overridden: 30 },
  ],
  policies: [
    { policyId: 'pol-quiet', decisions: 20, acknowledged: 0 },
    { policyId: 'pol-ok', decisions: 20, acknowledged: 19 },
  ],
};

describe('automation rule health', () => {
  const items = automationRuleHealthProducer.derive(healthy);
  const keys = items.map(item => item.key);

  it('names each problem once, by key', () => {
    expect(keys.sort()).toEqual([
      'never-matched:r-old',
      'never-matched:r-tag',
      'overridden:r-db',
      'policy-no-ack:pol-quiet',
      'shadowed:r-late',
      'unmapped:environment',
    ]);
    for (const item of items) expect(opsInsightItemSchema.safeParse(item).success).toBe(true);
  });

  it('stores no rule, field or policy names, only ids in keys and links', () => {
    const text = JSON.stringify(
      items.map(({ title, summary, evidence }) => [title, summary, evidence])
    );
    expect(text).not.toMatch(/environment|r-db|r-old/);
    expect(items.find(i => i.key === 'never-matched:r-old')!.draftHref).toBe(
      '/services/svc-1?tab=automation&automationRule=r-old'
    );
  });

  it('stays quiet without enough traffic or on a young version', () => {
    expect(
      automationRuleHealthProducer.derive({
        ...healthy,
        versionDays: 3,
        sample: { ...healthy.sample, events: 20 },
        routes: [],
        policies: [{ policyId: 'p', decisions: 5, acknowledged: 0 }],
      })
    ).toEqual([]);
  });
});

describe('automation suggested rules producer', () => {
  it('emits valid insights whose link opens the pre-filled rule', () => {
    const items = automationSuggestedRulesProducer.derive({
      serviceId: 'svc-1',
      groups: [
        group('critical', 'db', 20, { P1: 18 }),
        group('warning', 'db', 30),
        group('critical', 'web', 10),
      ],
      existing: [],
    });
    expect(items).toHaveLength(1);
    expect(opsInsightItemSchema.safeParse(items[0]).success).toBe(true);
    expect(items[0].title).toBe(
      'Suggested rule: set P1 when severity is critical and source is db'
    );
    expect(items[0].draftHref).toContain('suggestedRule=');
  });
});
