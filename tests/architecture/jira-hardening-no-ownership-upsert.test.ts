import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira ownership persistence contract', () => {
  it('keeps link ownership create-only in both manual link and durable create paths', () => {
    for (const path of ['src/lib/jira-sync.ts', 'src/lib/external-operations.ts']) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('externalIssueLink.upsert');
    }
  });
});
