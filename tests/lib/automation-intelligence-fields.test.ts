import { describe, expect, it } from 'vitest';
import { compileAutomation } from '@/lib/automation/compiler';
import { usesIntelligenceFields, type Snapshot } from '@/lib/automation/contract';
import { evaluateAutomation } from '@/lib/automation/evaluator';
import {
  EMPTY_SIGNALS,
  inMaintenanceAt,
  intelligenceContext,
  INTELLIGENCE_SIGNALS,
  type SignalWindow,
} from '@/lib/automation/context/intelligence';

const at = new Date('2026-11-17T12:00:00Z');
const minutesAgo = (m: number) => at.getTime() - m * 60_000;

const snapshot = (conditions: Snapshot['rules'][number]['conditions']): Snapshot => ({
  schemaVersion: 1,
  fields: [],
  rules: [
    {
      id: 'calm',
      name: 'Calm during maintenance',
      phase: 'ENRICH',
      enabled: true,
      conditions,
      actions: [{ type: 'SET_PRIORITY', value: 'P5' }],
    },
  ],
});

describe('intelligence fields', () => {
  it('reads every field as MISSING when the snapshot is cold', () => {
    const context = intelligenceContext({ signals: null, inMaintenance: null, at });
    expect(Object.values(context).every(field => field.state === 'MISSING')).toBe(true);
  });

  it('turns time-stamped evidence into booleans inside each window', () => {
    const context = intelligenceContext({
      signals: {
        riskyChangeAt: [minutesAgo(INTELLIGENCE_SIGNALS.riskyChangeMinutes - 1)],
        flappingAt: [minutesAgo(INTELLIGENCE_SIGNALS.flappingMinutes + 1)],
        stormAt: [minutesAgo(1)],
        slo: [
          { objectiveId: 'a', endAt: minutesAgo(120), breached: true },
          { objectiveId: 'a', endAt: minutesAgo(5), breached: false },
          { objectiveId: 'b', endAt: minutesAgo(5), breached: false },
        ],
      },
      inMaintenance: false,
      at,
    });
    expect(context).toEqual({
      inMaintenance: { state: 'RECOGNIZED', value: false },
      recentRiskyChange: { state: 'RECOGNIZED', value: true },
      sloBurning: { state: 'RECOGNIZED', value: false },
      flapping: { state: 'RECOGNIZED', value: false },
      stormActive: { state: 'RECOGNIZED', value: true },
    });
  });

  it('ignores evidence from after the evaluation time (replay) and keeps SLO unknown without data', () => {
    const context = intelligenceContext({
      signals: { ...EMPTY_SIGNALS, stormAt: [at.getTime() + 60_000] },
      inMaintenance: true,
      at,
    });
    expect(context.stormActive).toEqual({ state: 'RECOGNIZED', value: false });
    expect(context.sloBurning).toEqual({ state: 'MISSING' });
    expect(context.inMaintenance).toEqual({ state: 'RECOGNIZED', value: true });
  });

  it('matches service, team and global windows that are active and not ended', () => {
    const base = {
      startsAt: new Date(minutesAgo(10)),
      endsAt: new Date(minutesAgo(-10)),
      recurrence: null,
      endedAt: null,
      serviceId: null,
      teamId: null,
    };
    const scope = { serviceId: 'svc', teamId: 'team' };
    const check = (window: Partial<SignalWindow>) =>
      inMaintenanceAt([{ ...base, scope: 'SERVICE', ...window } as SignalWindow], scope, at);
    expect(check({ serviceId: 'svc' })).toBe(true);
    expect(check({ serviceId: 'other' })).toBe(false);
    expect(check({ scope: 'TEAM', teamId: 'team' })).toBe(true);
    expect(check({ scope: 'ALL' })).toBe(true);
    expect(check({ scope: 'LABEL' })).toBe(false);
    expect(check({ serviceId: 'svc', endedAt: new Date(minutesAgo(1)) })).toBe(false);
    expect(check({ serviceId: 'svc', startsAt: new Date(minutesAgo(-5)) })).toBe(false);
  });

  it('compiles rules on intelligence fields, refuses writes to them, and flags their use', () => {
    const ok = snapshot([{ fieldKey: 'inMaintenance', operator: 'EQ', value: true }]);
    expect(compileAutomation(ok).issues.filter(i => i.level === 'ERROR')).toEqual([]);
    expect(usesIntelligenceFields(ok)).toBe(true);
    expect(usesIntelligenceFields(snapshot([]))).toBe(false);

    const write: Snapshot = {
      ...ok,
      rules: [
        {
          ...ok.rules[0],
          actions: [{ type: 'SET_CONTEXT', fieldKey: 'inMaintenance', value: false }],
        },
      ],
    };
    expect(compileAutomation(write).issues.map(i => i.code)).toContain('INVALID_CONTEXT_TARGET');
  });

  it('a rule on a cold field never matches; a warm field drives the rule', () => {
    const { compiled } = compileAutomation(
      snapshot([{ fieldKey: 'inMaintenance', operator: 'EQ', value: true }])
    );
    const run = (
      inMaintenance: boolean | null,
      signals = inMaintenance === null ? null : EMPTY_SIGNALS
    ) =>
      evaluateAutomation({
        version: compiled,
        initialContext: intelligenceContext({ signals, inMaintenance, at }),
        evaluationAt: at.toISOString(),
      }).enrichedContext.priority;
    expect(run(null)).toBeUndefined();
    expect(run(false)).toBeUndefined();
    expect(run(true)).toEqual({ state: 'RECOGNIZED', value: 'P5' });
  });
});
