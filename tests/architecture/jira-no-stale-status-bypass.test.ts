import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira stale-event safety', () => {
  it('has no status-difference exception that bypasses provider ordering', () => {
    const source = readFileSync('src/lib/jira-sync.ts', 'utf8');
    expect(source).not.toContain('eventTime.getTime() + 300_000');
    expect(source).toContain('link.lastSyncedAt < eventTime');
  });
});
