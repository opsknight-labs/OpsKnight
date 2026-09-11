import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('Jira hardening documentation', () => {
  it('keeps operator hardening notes beside the implementation', () => {
    expect(existsSync('docs/v1.5/integrations/issue-tracking/jira-hardening-notes.md')).toBe(true);
  });
});
