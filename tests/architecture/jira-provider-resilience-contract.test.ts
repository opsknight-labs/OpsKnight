import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira provider resilience contract', () => {
  it('propagates Retry-After and applies workspace-scoped admission', () => {
    const jira = readFileSync('src/lib/jira.ts', 'utf8');
    const providerErrors = readFileSync('src/lib/provider-errors.ts', 'utf8');
    const worker = readFileSync('src/lib/external-operations.ts', 'utf8');

    expect(jira).toContain("response.headers.get('retry-after')");
    expect(providerErrors).toContain('providerRetryAfterMs');
    expect(worker).toContain("const JIRA_PROVIDER_KEY = 'jira:workspace'");
  });

  it('does not leave final create attempts permanently ambiguous', () => {
    const worker = readFileSync('src/lib/external-operations.ts', 'utf8');
    expect(worker).toContain('MAX_JIRA_OPERATION_ATTEMPTS = 8');
    expect(worker).toContain("attempts >= MAX_JIRA_OPERATION_ATTEMPTS ? 'FAILED' : 'AMBIGUOUS'");
  });
});
