import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira remote deletion contract', () => {
  it('does not advertise deleted Jira issues as synchronized', () => {
    const source = readFileSync('src/lib/jira-sync.ts', 'utf8');
    expect(source).toContain("syncState: 'FAILED'");
    expect(source).toContain("externalStatus: 'Deleted in Jira'");
    expect(source).toContain("action: 'jira.issue.remote_deleted'");
  });
});
