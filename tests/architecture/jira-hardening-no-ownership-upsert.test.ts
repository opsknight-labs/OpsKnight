import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira ownership persistence contract', () => {
  it('keeps link ownership create-only in both manual link and durable create paths', () => {
    const jiraSyncSource = readFileSync('src/lib/jira-sync.ts', 'utf8');
    const externalOperationsSource = readFileSync('src/lib/external-operations.ts', 'utf8');

    expect(jiraSyncSource).not.toContain('externalIssueLink.upsert');
    expect(externalOperationsSource).not.toContain('externalIssueLink.upsert');
  });
});
