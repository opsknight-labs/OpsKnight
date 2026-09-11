import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira shared circuit breaker', () => {
  it('uses a single workspace-scoped provider key', () => {
    expect(readFileSync('src/lib/external-operations.ts', 'utf8')).toContain(
      "const JIRA_PROVIDER_KEY = 'jira:workspace'"
    );
  });
});
