import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('Jira hardening regression index', () => {
  it('keeps the critical regression suites present', () => {
    expect(existsSync('tests/lib/jira-external-operation-concurrency.test.ts')).toBe(true);
    expect(existsSync('tests/lib/jira-create-owner-validation.test.ts')).toBe(true);
    expect(existsSync('tests/lib/provider-admission-jira-breaker.test.ts')).toBe(true);
  });
});
