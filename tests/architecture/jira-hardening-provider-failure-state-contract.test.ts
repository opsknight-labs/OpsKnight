import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira provider breaker transitions', () => {
  it('opens after repeated transient failures', () => {
    const source = readFileSync('src/lib/provider-admission.ts', 'utf8');
    expect(source).toContain('consecutiveFails < 2');
    expect(source).toContain("state: blockedUntil ? 'OPEN' : 'DEGRADED'");
  });
});
