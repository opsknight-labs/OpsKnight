import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira hardening substantive implementation', () => {
  it('contains implementation changes, not only documentation', () => {
    expect(readFileSync('src/lib/jira-sync.ts', 'utf8')).toContain('acquireJiraExternalIssueLinkFence');
  });
});
