// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CorrelationRule } from '@/lib/intelligence/contract';
import { simulateCorrelation, type ReplayIncident } from '@/lib/intelligence/evaluation/simulate';

const base = new Date('2026-10-27T10:00:00Z').getTime();
const rule = (o: Partial<CorrelationRule> = {}): CorrelationRule => ({
  id: 'same', kind: 'CONTENT_TEMPLATE', enabled: true, keys: [], windowSeconds: 300, maxWindowSeconds: 900, minScore: 0.8, ...o,
});
let n = 0;
const inc = (seconds: number, o: Partial<ReplayIncident> = {}): ReplayIncident => ({
  id: `i${String(++n).padStart(3, '0')}`,
  serviceId: 's1',
  urgency: 'LOW',
  createdAt: new Date(base + seconds * 1000),
  template: 'database errors on db-<num>',
  labels: {},
  ...o,
});

describe('simulateCorrelation', () => {
  it('groups repeated problems and counts the links SUGGEST mode would propose', () => {
    const result = simulateCorrelation([inc(0), inc(20), inc(40), inc(60, { template: 'disk full' })], [rule()]);
    expect(result).toMatchObject({ incidentsEvaluated: 4, groups: 1, groupedIncidents: 3, suggestedLinks: 2, criticalExcluded: 0 });
    expect(result.topGroups[0]).toMatchObject({ ruleId: 'same', serviceId: 's1', size: 3 });
    expect(result.perRule).toEqual([{ ruleId: 'same', groups: 1, groupedIncidents: 3 }]);
  });

  it('never counts a lone incident as a group', () => {
    expect(simulateCorrelation([inc(0)], [rule()])).toMatchObject({ groups: 0, groupedIncidents: 0, suggestedLinks: 0 });
  });

  it('excludes critical incidents and reports how many', () => {
    const result = simulateCorrelation([inc(0, { urgency: 'HIGH' }), inc(10, { urgency: 'HIGH' }), inc(20), inc(30)], [rule()]);
    expect(result).toMatchObject({ criticalExcluded: 2, groups: 1, groupedIncidents: 2 });
  });

  it('keeps services separate and honours the window with sliding extension', () => {
    const rules = [rule({ windowSeconds: 60, maxWindowSeconds: 600 })];
    const result = simulateCorrelation(
      [inc(0), inc(50), inc(100), inc(500), inc(0, { serviceId: 's2' }), inc(10, { serviceId: 's2' })],
      rules
    );
    // s1: {0,50,100} slide together, 500 is alone; s2: {0,10}.
    expect(result).toMatchObject({ groups: 2, groupedIncidents: 5, suggestedLinks: 3 });
  });

  it('ignores disabled rules and handles an empty rule set', () => {
    expect(simulateCorrelation([inc(0), inc(1)], [rule({ enabled: false })])).toMatchObject({ groups: 0, perRule: [] });
    expect(simulateCorrelation([inc(0), inc(1)], [])).toMatchObject({ groups: 0 });
  });

  it('is deterministic regardless of input order', () => {
    const items = [inc(30), inc(0), inc(60), inc(10)];
    expect(simulateCorrelation(items, [rule()])).toEqual(simulateCorrelation([...items].reverse(), [rule()]));
  });

  it('counts a link once when two rules group the same incidents together', () => {
    const items = [0, 10, 20].map(t => inc(t, { labels: { env: 'prod' } }));
    const result = simulateCorrelation(items, [rule(), rule({ id: 'by-env', kind: 'LABEL_SET', keys: ['env'] })]);
    expect(result.perRule.map(r => r.groups)).toEqual([1, 1]);
    expect(result.suggestedLinks).toBe(2); // two (member, anchor) pairs, not four
  });

  it('evaluates each rule independently', () => {
    const labelled = (seconds: number) => inc(seconds, { labels: { env: 'prod' }, template: `unique ${seconds}` });
    const result = simulateCorrelation(
      [inc(0), inc(10), labelled(20), labelled(30)],
      [rule(), rule({ id: 'by-env', kind: 'LABEL_SET', keys: ['env'] })]
    );
    expect(result.perRule).toEqual([
      { ruleId: 'same', groups: 1, groupedIncidents: 2 },
      { ruleId: 'by-env', groups: 1, groupedIncidents: 2 },
    ]);
  });

  it('limits the preview list to the largest groups', () => {
    const items = Array.from({ length: 30 }, (_, g) => [inc(g * 10_000, { template: `problem ${g}` }), inc(g * 10_000 + 5, { template: `problem ${g}` })]).flat();
    const result = simulateCorrelation(items, [rule()]);
    expect(result.groups).toBe(30);
    expect(result.topGroups).toHaveLength(10);
  });
});
