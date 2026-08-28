import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('global search authorization contract', () => {
  it('delegates incident and service visibility to canonical policy filters', () => {
    const source = readFileSync('src/app/api/search/route.ts', 'utf8');

    expect(source).toContain('incidentReadWhere(actor)');
    expect(source).toContain('serviceReadWhere(actor)');
    expect(source).not.toMatch(/const incidentAccess\s*=\s*isPrivileged/);
  });
});
