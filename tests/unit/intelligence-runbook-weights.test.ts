import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  DEFAULT_RUNBOOK_WEIGHTS,
  policyDefinitionSchema,
  runbookWeightsSchema,
} from '@/lib/intelligence/contract';
import {
  fitRunbookWeights,
  mergeRunbookLabels,
  RUNBOOK_FIT_LIMITS,
  type RunbookExample,
} from '@/lib/intelligence/learning/runbook-weights';
import { rankRunbooks, scoreRunbook } from '@/lib/intelligence/recommendations/wilson';
import { coordinateDescent, hasMinimumSupport } from '@/lib/intelligence/learning/bounded-fit';

const example = (overrides: Partial<RunbookExample>): RunbookExample => ({
  succeeded: 0,
  eligible: 0,
  bound: false,
  helpful: true,
  source: 'FEEDBACK',
  ...overrides,
});

describe('runbook ranking weights', () => {
  it('reproduces the shipped ranking exactly with the default weights', () => {
    const candidates = [
      { runbookId: 'lucky', succeeded: 1, eligible: 1, bound: false },
      { runbookId: 'proven', succeeded: 47, eligible: 50, bound: false, mttrImprovement: 0.5 },
      {
        runbookId: 'specialist',
        succeeded: 2,
        eligible: 10,
        bound: true,
        sameProblem: { succeeded: 8, eligible: 8 },
      },
      { runbookId: 'untried', succeeded: 0, eligible: 0, bound: true },
    ];
    expect(rankRunbooks(candidates, 5)).toEqual(
      rankRunbooks(candidates, 5, { ...DEFAULT_RUNBOOK_WEIGHTS })
    );
    expect(scoreRunbook({ succeeded: 0, eligible: 0, bound: true })).toBe(0);
  });

  it('lets a bound-but-untried prior lift an untried runbook above a weak record, never above a proven one', () => {
    const candidates = [
      { runbookId: 'weak', succeeded: 1, eligible: 3, bound: false },
      { runbookId: 'untried', succeeded: 0, eligible: 0, bound: true },
    ];
    const prior = { ...DEFAULT_RUNBOOK_WEIGHTS, boundPrior: 0.2 };
    expect(rankRunbooks(candidates, 5).map(r => r.runbookId)).toEqual(['weak', 'untried']);
    expect(rankRunbooks(candidates, 5, prior).map(r => r.runbookId)).toEqual(['untried', 'weak']);
    // The bound keeps the prior below even a lucky one-off's lower bound.
    expect(
      rankRunbooks(
        [...candidates, { runbookId: 'lucky', succeeded: 1, eligible: 1, bound: false }],
        5,
        prior
      )[0].runbookId
    ).toBe('lucky');
  });

  it('keeps the policy schema backward compatible and bounds the learned weights', () => {
    expect(DEFAULT_POLICY_DEFINITION.response.runbookWeights).toBeUndefined();
    expect(runbookWeightsSchema.safeParse(DEFAULT_RUNBOOK_WEIGHTS).success).toBe(true);
    expect(
      runbookWeightsSchema.safeParse({ ...DEFAULT_RUNBOOK_WEIGHTS, boundPrior: 0.5 }).success
    ).toBe(false);
    expect(
      runbookWeightsSchema.safeParse({ ...DEFAULT_RUNBOOK_WEIGHTS, overall: 0.1 }).success
    ).toBe(false);
    const versioned = policyDefinitionSchema.parse({
      schemaVersion: 1,
      response: { enabled: true, runbookWeights: { ...DEFAULT_RUNBOOK_WEIGHTS, mttrBonus: 0.2 } },
    });
    expect(versioned.response.runbookWeights?.mttrBonus).toBe(0.2);
  });

  it('applies the minimum-sample guard', () => {
    expect(fitRunbookWeights([])).toBeNull();
    // Plenty of rows, but only one verdict: nothing to learn from.
    const oneSided = Array.from({ length: 100 }, () => example({ bound: true, helpful: true }));
    expect(fitRunbookWeights(oneSided)).toBeNull();
    // Enough of each verdict, but below the row minimum.
    const few = Array.from({ length: RUNBOOK_FIT_LIMITS.minExamples - 1 }, (_, i) =>
      example({ bound: true, helpful: i % 2 === 0 })
    );
    expect(fitRunbookWeights(few)).toBeNull();
    expect(hasMinimumSupport(few, { rows: 40, perVerdict: 8 })).toBe(false);
    // Inconsistent counts are discarded before the guard.
    const garbage = Array.from({ length: 100 }, (_, i) =>
      example({ succeeded: 9, eligible: 3, helpful: i % 2 === 0 })
    );
    expect(fitRunbookWeights(garbage)).toBeNull();
  });

  it('learns to trust an untried binding when responders accept those recommendations', () => {
    const rows: RunbookExample[] = [];
    for (let i = 0; i < 120; i += 1) {
      const untried = i % 2 === 0;
      rows.push(
        untried
          ? // Bound, never run here, and usually accepted or fixing the incident.
            example({ bound: true, helpful: i % 7 !== 0, source: i % 3 ? 'OUTCOME' : 'FEEDBACK' })
          : // A one-off success elsewhere that usually does not help.
            example({ succeeded: 1, eligible: 1, helpful: i % 7 === 0 })
      );
    }
    const proposal = fitRunbookWeights(rows);
    expect(proposal).not.toBeNull();
    expect(proposal!.weights.boundPrior).toBeGreaterThan(DEFAULT_RUNBOOK_WEIGHTS.boundPrior);
    expect(proposal!.heldOutLoss).toBeLessThan(proposal!.baselineLoss);
    expect(proposal!.fromFeedback + proposal!.fromOutcomes).toBe(proposal!.support);
    expect(runbookWeightsSchema.safeParse(proposal!.weights).success).toBe(true);
  });

  it('learns to discount the same-problem record when it keeps failing to fix incidents', () => {
    const rows: RunbookExample[] = [];
    for (let i = 0; i < 160; i += 1) {
      const specialist = i % 2 === 0;
      rows.push(
        specialist
          ? // A thin service-wide record but a perfect same-problem record that rarely fixes anything now.
            example({
              succeeded: 1,
              eligible: 10,
              sameProblem: { succeeded: 6, eligible: 6 },
              helpful: i % 7 === 0,
              source: 'OUTCOME',
            })
          : // A middling but honest service-wide record that usually works.
            example({ succeeded: 12, eligible: 20, helpful: i % 7 !== 0, source: 'OUTCOME' })
      );
    }
    const proposal = fitRunbookWeights(rows);
    expect(proposal).not.toBeNull();
    expect(proposal!.weights.sameProblem).toBeLessThan(DEFAULT_RUNBOOK_WEIGHTS.sameProblem);
    expect(proposal!.heldOutLoss).toBeLessThan(proposal!.baselineLoss);
  });

  it('offers nothing when no weight explains the labels better than the shipped ranking', () => {
    // Unbound and untried: every weight setting scores these the same, so no proposal can beat the default.
    const rows = Array.from({ length: 120 }, (_, i) => example({ helpful: i % 9 === 0 }));
    expect(fitRunbookWeights(rows)).toBeNull();
  });

  it('merges labels with one row per recommendation and lets an observed outcome win', () => {
    const evidence = { succeeded: 3, eligible: 4, bound: true };
    const merged = mergeRunbookLabels(
      [
        { findingId: 'f1', incidentId: 'i1', runbookId: 'r1', evidence, helpful: true },
        { findingId: 'f2', incidentId: 'i2', runbookId: 'r1', evidence, helpful: true },
        { findingId: 'bad', incidentId: 'i3', runbookId: 'r1', evidence: { x: 1 }, helpful: true },
      ],
      [{ findingId: 'f1b', incidentId: 'i1', runbookId: 'r1', evidence, helpful: false }]
    );
    expect(merged).toEqual([
      { ...evidence, helpful: false, source: 'OUTCOME' },
      { ...evidence, helpful: true, source: 'FEEDBACK' },
    ]);
  });

  it('coordinate descent only keeps moves that lower the loss and respects bounds', () => {
    const result = coordinateDescent(
      { x: 0 },
      [(w, d) => ({ x: Math.max(-1, Math.min(0.33, w.x + d)) })],
      w => (w.x - 0.5) ** 2
    );
    expect(result.x).toBeCloseTo(0.33, 5);
  });
});
