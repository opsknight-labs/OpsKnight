import { expect, it } from 'vitest';
import { describeWorkFailure, encodeWorkFailure } from '@/lib/intelligence/jobs/failures';
it.each([
  ['P2024', 'DB_BUSY'],
  ['57014', 'DB_BUSY'],
  ['BUDGET_EXHAUSTED', 'AI_LIMIT'],
  ['NO_PROVIDER', 'AI_UNAVAILABLE'],
  ['ABORTED', 'CANCELLED'],
  ['secret-canary', 'UNKNOWN'],
])('uses a fixed diagnostic for code %s', (code, expected) => {
  const stored = encodeWorkFailure(Object.assign(new Error('private-source-canary'), { code }));
  expect(describeWorkFailure(stored).failureCode).toBe(expected);
  expect(stored).not.toContain('canary');
});
it('does not serialize legacy errors, objects or hostile accessors', () => {
  const bad = {
    get code() {
      throw new Error('secret');
    },
    toString() {
      throw new Error('secret');
    },
  };
  expect(encodeWorkFailure(bad)).toBe('work:v1:UNKNOWN');
  for (const legacy of [
    null,
    'password=private-canary',
    'work:v1:UNKNOWN private-canary',
    '__proto__',
  ]) {
    const view = describeWorkFailure(legacy);
    expect(view.failureCode).toBe('UNKNOWN');
    expect(JSON.stringify(view)).not.toContain('private-canary');
  }
});
it('recognizes a work budget without retaining the original timing/error payload', () => {
  const error = new Error('private-provider-payload');
  error.name = 'WorkTimeoutError';
  expect(describeWorkFailure(encodeWorkFailure(error)).failureCode).toBe('WORK_BUDGET');
});
