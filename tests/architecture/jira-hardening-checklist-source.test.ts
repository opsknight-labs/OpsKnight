import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('Jira hardening checklist source', () => {
  it('keeps the release verification checklist versioned with the change', () => {
    expect(existsSync('docs/v1.5/integrations/issue-tracking/jira-hardening-checklist.md')).toBe(true);
  });
});
