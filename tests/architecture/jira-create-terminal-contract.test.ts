import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira create retry terminal state', () => {
  it('uses the shared retry budget to terminate ambiguous creates', () => {
    const source = readFileSync('src/lib/external-operations.ts', 'utf8');
    expect(source).toContain('MAX_JIRA_OPERATION_ATTEMPTS = 8');
    expect(source).toContain("return attempts >= MAX_JIRA_OPERATION_ATTEMPTS ? 'FAILED' : 'AMBIGUOUS'");
  });
});
