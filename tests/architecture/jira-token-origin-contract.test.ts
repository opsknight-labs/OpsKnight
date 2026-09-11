import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira credential origin binding', () => {
  it('requires a fresh API token before accepting a changed origin', () => {
    const source = readFileSync('src/app/(app)/settings/integrations/jira/actions.ts', 'utf8');
    expect(source).toContain('originChanged && !hasFreshApiToken');
    expect(source).toContain('Re-enter the Jira API token');
  });
});
