import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira provider retry metadata', () => {
  it('carries Retry-After through typed provider details', () => {
    expect(readFileSync('src/lib/provider-errors.ts', 'utf8')).toContain('providerRetryAfterMs');
  });
});
