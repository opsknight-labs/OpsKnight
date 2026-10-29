import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira provider admission coverage', () => {
  it('checks admission for both durable operation kinds', () => {
    const source = readFileSync('src/lib/external-operations.ts', 'utf8');
    expect(source.match(/assertProviderAdmitted\(JIRA_PROVIDER_KEY\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
