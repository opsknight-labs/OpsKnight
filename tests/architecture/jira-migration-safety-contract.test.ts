import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira ownership migration safety', () => {
  it('validates existing rows before accepting the exactly-one-owner invariant', () => {
    const sql = readFileSync(
      'prisma/migrations/20260911124000_enforce_jira_external_issue_owner/migration.sql',
      'utf8'
    );
    expect(sql).toContain('NOT VALID');
    expect(sql).toContain('VALIDATE CONSTRAINT');
  });
});
