import { describe, expect, it } from 'vitest';
import { assertSafeRegex } from '@/lib/intelligence/noise-controls/contract';
import { compileMatcher, matches } from '@/lib/intelligence/noise-controls/matchers';

/**
 * Matching runs on the ingestion event loop with no timeout, so a pattern that backtracks exponentially
 * stalls every alert behind it. These shapes slipped past the save-time check.
 */
const BACKTRACKING = ['(a|aa)+$', '(a|a)*b', '(\\w|\\d)+x', '(?:foo|foob)+z', '(x|xx){1,40}y'];
const FINE = [
  '^disk .* full$',
  'timeout|refused',
  '(prod|staging)-db',
  'cpu (high|low)?',
  '^5\\d\\d$',
];

describe('regex safety for suppression and orchestration matchers', () => {
  it.each(BACKTRACKING)('rejects %s at save time', pattern => {
    expect(() => assertSafeRegex(pattern)).toThrow();
  });

  it.each(FINE)('accepts %s', pattern => {
    expect(() => assertSafeRegex(pattern)).not.toThrow();
  });

  it.each(BACKTRACKING)(
    'never lets %s stall matching, even from a row written around the check',
    pattern => {
      const matcher = compileMatcher({ field: 'summary', op: 'regex', value: pattern });
      const startedAt = performance.now();
      matches(matcher, {
        serviceId: 's',
        source: 'x',
        summary: `${'a'.repeat(40)}${'foo'.repeat(10)}!`,
        severity: 'error',
        urgency: 'MEDIUM',
        labels: {},
        resourceKey: null,
        fingerprintHash: null,
        dedupKey: 'k',
        receivedAt: new Date(),
      });
      expect(performance.now() - startedAt).toBeLessThan(50);
    }
  );
});
