import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira hardening scope', () => {
  it('keeps incident page rendering free of hidden Jira HTTP calls', () => {
    const page = readFileSync('src/app/(app)/incidents/[id]/page.tsx', 'utf8');
    expect(page).not.toContain('getJiraIssue(');
    expect(page).not.toContain('syncExternalIssueLink(');
  });
});
