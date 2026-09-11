import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira workspace breaker scope', () => {
  it('does not partition outage admission by issue key', () => {
    const source = readFileSync('src/lib/external-operations.ts', 'utf8');
    expect(source).toContain("const JIRA_PROVIDER_KEY = 'jira:workspace'");
    expect(source).not.toContain('jira:issue:${input.externalKey}');
  });
});
