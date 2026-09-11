import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira inbound delivery durability', () => {
  it('does not acknowledge a busy uncommitted delivery as success', () => {
    const route = readFileSync('src/app/api/jira/webhook/route.ts', 'utf8');
    expect(route).toContain("claim?.disposition === 'BUSY'");
    expect(route).toContain("status: 503, headers: { 'Retry-After': '5' }");
  });
});
