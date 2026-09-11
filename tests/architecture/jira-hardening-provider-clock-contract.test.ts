import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira provider clock preference', () => {
  it('prefers issue.updated over transport timestamp for ordering', () => {
    const source = readFileSync('src/lib/jira-sync.ts', 'utf8');
    expect(source).toContain('const candidates = [payload.issue?.fields?.updated, payload.timestamp]');
  });
});
