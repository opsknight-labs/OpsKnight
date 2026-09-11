import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira origin helper', () => {
  it('compares URL origins rather than raw strings', () => {
    const source = readFileSync('src/app/(app)/settings/integrations/jira/actions.ts', 'utf8');
    expect(source).toContain('new URL(baseUrl).origin');
  });
});
