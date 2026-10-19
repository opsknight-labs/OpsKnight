import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { classifyEvaluationSource } from '@/lib/runbooks/triggers';

describe('classifyEvaluationSource', () => {
  const unexpected: unknown[] = [
    'manual',
    'MANUAL ',
    ' MANUAL',
    'Manual',
    'OTHER',
    'EVENT',
    'monitoring',
    '',
    null,
    0,
    1,
    true,
    {},
    ['MANUAL'],
  ];

  it.each([...unexpected, undefined, 'MANUAL', 'MONITORING'])(
    'treats %j as MONITORING for an alert-linked incident',
    raw => {
      expect(classifyEvaluationSource(raw, true)).toBe('MONITORING');
    }
  );

  it.each(unexpected)('fails closed to MONITORING for unexpected %j without alerts', raw => {
    expect(classifyEvaluationSource(raw, false)).toBe('MONITORING');
  });

  it('counts only an exact MANUAL (or a legacy missing source) without alerts as manual', () => {
    expect(classifyEvaluationSource('MANUAL', false)).toBe('MANUAL');
    expect(classifyEvaluationSource(undefined, false)).toBe('MANUAL');
  });
});
