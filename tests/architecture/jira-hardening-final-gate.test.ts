import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('Jira hardening final gate sources', () => {
  it('ships the ownership migration and destructive-edge behavior suites', () => {
    for (const path of [
      'prisma/migrations/20260911124000_enforce_jira_external_issue_owner/migration.sql',
      'tests/lib/jira-enterprise-validation.test.ts',
      'tests/lib/jira-webhook-ordering-hardening.test.ts',
      'tests/lib/jira-link-existing-hardening.test.ts',
      'tests/lib/jira-retry-after-hardening.test.ts',
    ]) {
      expect(existsSync(path)).toBe(true);
    }
  });
});
