import { describe, expect, it } from 'vitest';
import { shouldEvaluateControl } from '@/lib/compliance/monitoring/schedule';
import type { ComplianceControlEvaluator } from '@/lib/compliance/evaluators/types';
import type { ComplianceControlState } from '@prisma/client';

describe('shouldEvaluateControl', () => {
  const dummyEvaluator: ComplianceControlEvaluator = {
    id: 'eval-enc-01',
    version: '1.0.0',
    evaluate: async () => ({
      status: 'IMPLEMENTED',
      findings: [],
      evidence: [],
      summary: 'Pass',
    }),
  };

  const now = new Date('2026-09-20T12:00:00.000Z');
  const intervalMinutes = 60;

  it('returns due=true when state is null (no previous evaluation)', () => {
    const result = shouldEvaluateControl({
      state: null,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('NO_PREVIOUS_EVALUATION');
  });

  it('returns due=true when evaluator version differs from state', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '0.9.0',
      evaluatedAt: new Date('2026-09-20T11:30:00.000Z'),
      validUntil: new Date('2026-09-20T13:00:00.000Z'),
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator, // version 1.0.0
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('EVALUATOR_VERSION_CHANGED');
  });

  it('returns due=false when evaluation is fresh and validUntil is in the future', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '1.0.0',
      evaluatedAt: new Date('2026-09-20T11:45:00.000Z'), // 15 mins ago
      validUntil: new Date('2026-09-20T13:00:00.000Z'), // expires in 1h
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(false);
    expect(result.reason).toBe('CURRENT');
  });

  it('returns due=true when validUntil has expired', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '1.0.0',
      evaluatedAt: new Date('2026-09-20T10:00:00.000Z'),
      validUntil: new Date('2026-09-20T11:00:00.000Z'), // expired 1h ago
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes,
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('EVALUATION_EXPIRED');
  });

  it('returns due=true when interval has elapsed without validUntil', () => {
    const state: Partial<ComplianceControlState> = {
      controlId: 'ENC-01',
      evaluatorVersion: '1.0.0',
      evaluatedAt: new Date('2026-09-20T10:00:00.000Z'), // 2 hours ago
      validUntil: null,
    };

    const result = shouldEvaluateControl({
      state: state as ComplianceControlState,
      evaluator: dummyEvaluator,
      now,
      intervalMinutes: 60, // 1 hour interval
    });
    expect(result.due).toBe(true);
    expect(result.reason).toBe('INTERVAL_ELAPSED');
  });
});
