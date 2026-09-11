import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira owner count contract', () => {
  it('checks exactly one owner in both manual link and durable create paths', () => {
    expect(readFileSync('src/lib/jira-sync.ts', 'utf8')).toContain('ownerCount !== 1');
    expect(readFileSync('src/lib/external-operations.ts', 'utf8')).toContain('ownerCount !== 1');
  });
});
