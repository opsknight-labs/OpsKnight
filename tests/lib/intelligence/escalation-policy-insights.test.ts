import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { opsInsightItemSchema } from '@/lib/intelligence/ops-insights/contract';
import {
  escalationPolicyProducer,
  type EscalationPolicyInput,
} from '@/lib/intelligence/ops-insights/producers/escalation-policy';
import {
  ackMinutesQuantile,
  summarizeStepOutcomes,
  type StepOutcomeSummary,
} from '@/lib/escalation/step-outcomes';

const point = (count: number, tags: Record<string, unknown>) => ({
  bucket: new Date('2026-11-01T00:00:00Z'),
  subjectKey: 'policy-1',
  count,
  sum: 0,
  tags: { reason: null, hour: 12, ackWithinMin: null, ...tags },
});

describe('summarizeStepOutcomes', () => {
  it('folds rollup rows per step, splitting night from day', () => {
    const [step0, step1] = summarizeStepOutcomes([
      point(6, { step: 0, outcome: 'ACKED', ackWithinMin: 5 }),
      point(2, { step: 0, outcome: 'ACKED', ackWithinMin: null }),
      point(3, { step: 0, outcome: 'TIMED_OUT', hour: 2 }),
      point(1, { step: 0, outcome: 'UNANSWERED' }),
      point(4, { step: 1, outcome: 'SKIPPED', reason: 'NO_ONE_ON_CALL' }),
      point(1, { step: 1, outcome: 'FAILED', reason: 'NO_CONTACT_METHOD' }),
    ]);
    expect(step0).toMatchObject({
      step: 0,
      paged: 12,
      acked: 8,
      timedOut: 3,
      nightPaged: 3,
      nightTimedOut: 3,
      dayPaged: 9,
      dayTimedOut: 0,
      ackWithin: { 5: 6, 121: 2 },
    });
    expect(step1).toMatchObject({
      paged: 0,
      skipped: 4,
      failed: 1,
      reasons: { NO_ONE_ON_CALL: 4, NO_CONTACT_METHOD: 1 },
    });
    expect(ackMinutesQuantile(step0, 0.75)).toBe(5);
    expect(ackMinutesQuantile(step0, 0.9)).toBe(121);
    expect(ackMinutesQuantile(step1, 0.75)).toBeNull();
  });
});

function stats(step: number, overrides: Partial<StepOutcomeSummary> = {}): StepOutcomeSummary {
  return {
    step,
    paged: 0,
    acked: 0,
    timedOut: 0,
    skipped: 0,
    failed: 0,
    reasons: {},
    ackWithin: {},
    nightPaged: 0,
    nightTimedOut: 0,
    dayPaged: 0,
    dayTimedOut: 0,
    ...overrides,
  };
}

const base: EscalationPolicyInput = {
  policyId: 'policy-1',
  ageDays: 8,
  services: 2,
  steps: [
    { id: 'step-a', delayMinutes: 0 },
    { id: 'step-b', delayMinutes: 30 },
    { id: 'step-c', delayMinutes: 15 },
  ],
  soleResponder: false,
  personalSteps: [false, false, false],
  outcomes: [],
};
const derive = (input: Partial<EscalationPolicyInput>) =>
  escalationPolicyProducer.derive({ ...base, ...input });

describe('escalation policy insights (pure half)', () => {
  it('says nothing about a healthy policy', () => {
    expect(
      derive({
        outcomes: [
          stats(0, { paged: 20, acked: 20, dayPaged: 20, ackWithin: { 30: 20 } }),
          stats(1, { paged: 2, acked: 2, dayPaged: 2 }),
        ],
      })
    ).toEqual([]);
  });

  it('flags a step that was paged but never acknowledged', () => {
    const items = derive({ outcomes: [stats(1, { paged: 6, timedOut: 6, dayPaged: 6 })] });
    expect(items.map(item => item.key)).toEqual(['never-acked:1']);
    expect(items[0].title).toBe('Step 2 was never acknowledged');
  });

  it("keeps a one-person step's acknowledgement record off the policy", () => {
    const night = stats(0, {
      paged: 26,
      acked: 21,
      timedOut: 5,
      nightPaged: 6,
      nightTimedOut: 4,
      dayPaged: 20,
      dayTimedOut: 1,
      ackWithin: { 1: 21 },
    });
    const outcomes = [night, stats(1, { paged: 6, timedOut: 6, dayPaged: 6 })];
    expect(derive({ outcomes }).map(item => item.key)).toEqual([
      'night-timeouts',
      'timeout:1',
      'never-acked:1',
    ]);
    expect(derive({ outcomes, personalSteps: [true, true, false] })).toEqual([]);
    // Skips say nothing about a person's answering, so they still show.
    expect(
      derive({
        personalSteps: [true, true, true],
        outcomes: [stats(1, { skipped: 7, reasons: { NO_ONE_ON_CALL: 7 } })],
      }).map(item => item.key)
    ).toEqual(['always-skipped:1']);
  });

  it('flags a step that is always skipped, with its reason', () => {
    const [item] = derive({
      outcomes: [stats(1, { skipped: 7, reasons: { NO_ONE_ON_CALL: 7 } })],
    });
    expect(item.key).toBe('always-skipped:1');
    expect(item.summary).toContain('nobody is on call in its schedule');
  });

  it('flags step 1 timing out at night when days are fine', () => {
    const items = derive({
      outcomes: [
        stats(0, {
          paged: 26,
          acked: 21,
          timedOut: 5,
          nightPaged: 6,
          nightTimedOut: 4,
          dayPaged: 20,
          dayTimedOut: 1,
          ackWithin: { 30: 21 },
        }),
      ],
    });
    expect(items.map(item => item.key)).toEqual(['night-timeouts']);
  });

  it('suggests a shorter wait from the 75th percentile, with the expected effect and an editor link', () => {
    const [item] = derive({
      outcomes: [
        stats(0, {
          paged: 24,
          acked: 12,
          timedOut: 12,
          dayPaged: 24,
          dayTimedOut: 12,
          ackWithin: { 3: 6, 5: 4, 15: 2 },
        }),
      ],
    });
    expect(item.key).toBe('timeout:1');
    expect(item.title).toBe('Wait 5 minutes before step 2, not 30');
    expect(item.summary).toContain('12 incidents would have reached step 2 25 minutes sooner');
    expect(item.summary).toContain('2 slower acknowledgements');
    expect(item.draftHref).toBe('/policies/policy-1?tab=steps&suggestStep=step-b&suggestDelay=5');
  });

  it('bounds the suggested wait and never suggests for the last step', () => {
    const [item] = derive({
      outcomes: [
        stats(0, { paged: 20, acked: 10, timedOut: 10, dayPaged: 20, ackWithin: { 1: 10 } }),
      ],
    });
    expect(item.draftHref).toContain('suggestDelay=2');
    expect(
      derive({
        outcomes: [
          stats(2, { paged: 20, acked: 10, timedOut: 10, dayPaged: 20, ackWithin: { 1: 10 } }),
        ],
      })
    ).toEqual([]);
  });

  it('flags one person on every step and a policy no service uses', () => {
    expect(derive({ soleResponder: true, services: 0 }).map(item => item.key)).toEqual([
      'single-person',
      'unused',
    ]);
    // A new policy is not "unused" yet.
    expect(derive({ services: 0, ageDays: 2 })).toEqual([]);
  });

  it('ignores outcomes of steps the policy no longer has', () => {
    expect(derive({ outcomes: [stats(5, { paged: 9, timedOut: 9, dayPaged: 9 })] })).toEqual([]);
  });

  it('emits only items the store accepts', () => {
    const items = derive({
      soleResponder: true,
      services: 0,
      outcomes: [
        stats(0, {
          paged: 30,
          acked: 12,
          timedOut: 18,
          nightPaged: 10,
          nightTimedOut: 9,
          dayPaged: 20,
          dayTimedOut: 9,
          ackWithin: { 3: 12 },
        }),
        stats(1, { paged: 9, timedOut: 9, dayPaged: 9 }),
        stats(2, { skipped: 6, failed: 1, reasons: { TARGET_INACTIVE: 6, NO_CONTACT_METHOD: 1 } }),
      ],
    });
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) expect(opsInsightItemSchema.safeParse(item).success).toBe(true);
  });
});
