import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira outbound URL boundary', () => {
  it('rejects credential-bearing and metadata-style targets before provider calls', () => {
    const source = readFileSync('src/lib/jira-validation.ts', 'utf8');
    expect(source).toContain('url.username || url.password');
    expect(source).toContain('url.search || url.hash');
    expect(source).toContain('169.254');
    expect(source).toContain('metadata.google.internal');
  });
});
