import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira release blocker coverage', () => {
  it('contains the three independent blocker fixes', () => {
    const settings = readFileSync('src/app/(app)/settings/integrations/jira/actions.ts', 'utf8');
    const sync = readFileSync('src/lib/jira-sync.ts', 'utf8');
    const migration = readFileSync(
      'prisma/migrations/20260911124000_enforce_jira_external_issue_owner/migration.sql',
      'utf8'
    );
    expect(settings).toContain('originChanged && !hasFreshApiToken');
    expect(sync).toContain('link.lastSyncedAt < eventTime');
    expect(migration).toContain('num_nonnulls("incidentId", "actionItemId") = 1');
  });
});
