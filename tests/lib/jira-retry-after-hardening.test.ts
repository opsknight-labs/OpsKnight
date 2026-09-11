import { describe, expect, it } from 'vitest';
import { parseJiraRetryAfterMs } from '@/lib/jira';

describe('Jira Retry-After handling', () => {
  it('parses provider delay seconds', () => {
    expect(parseJiraRetryAfterMs('15', 0)).toBe(15_000);
  });

  it('parses HTTP-date Retry-After values', () => {
    const now = Date.parse('2026-09-11T10:00:00.000Z');
    expect(parseJiraRetryAfterMs('Fri, 11 Sep 2026 10:00:45 GMT', now)).toBe(45_000);
  });

  it('bounds malformed, tiny, and excessive provider delays safely', () => {
    expect(parseJiraRetryAfterMs('not-a-delay', 0)).toBeUndefined();
    expect(parseJiraRetryAfterMs('0', 0)).toBe(1_000);
    expect(parseJiraRetryAfterMs(String(48 * 60 * 60), 0)).toBe(24 * 60 * 60_000);
  });
});
