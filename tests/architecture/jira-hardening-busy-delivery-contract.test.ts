import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira busy inbound delivery behavior', () => {
  it('asks the provider to retry instead of acknowledging an uncommitted duplicate', () => {
    const source = readFileSync('src/app/api/jira/webhook/route.ts', 'utf8');
    expect(source).toContain("status: 503, headers: { 'Retry-After': '5' }");
  });
});
