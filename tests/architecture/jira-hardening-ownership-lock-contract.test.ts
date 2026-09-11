import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira external issue lock', () => {
  it('uses a deterministic external issue identity lock', () => {
    const source = readFileSync('src/lib/jira-concurrency.ts', 'utf8');
    expect(source).toContain('jiraExternalIssueLinkLockKey');
    expect(source).toContain('0x4a4b000000000000');
  });
});
