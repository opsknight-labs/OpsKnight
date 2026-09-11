import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira structured provider retry metadata', () => {
  it('passes status and Retry-After as structured provider details', () => {
    const jira = readFileSync('src/lib/jira.ts', 'utf8');
    expect(jira).toContain('status: response.status');
    expect(jira).toContain('retryAfterMs: parseJiraRetryAfterMs');
  });
});
