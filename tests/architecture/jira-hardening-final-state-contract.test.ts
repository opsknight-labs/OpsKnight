import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira terminal operation helper', () => {
  it('has one authoritative terminal-state helper', () => {
    const source = readFileSync('src/lib/external-operations.ts', 'utf8');
    expect(source).toContain('function operationFailureStatus');
  });
});
