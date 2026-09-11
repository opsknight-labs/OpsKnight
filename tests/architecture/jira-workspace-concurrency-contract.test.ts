import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migrationPath =
  'prisma/migrations/20260910174500_guard_jira_mapping_workspace/migration.sql';

describe('Jira workspace concurrency architecture', () => {
  it('uses one stable workspace lock key for provider and lifecycle fencing', () => {
    const locks = readFileSync('src/lib/db-locks.ts', 'utf8');
    const concurrency = readFileSync('src/lib/jira-concurrency.ts', 'utf8');
    const settings = readFileSync('src/app/(app)/settings/integrations/jira/actions.ts', 'utf8');
    const worker = readFileSync('src/lib/external-operations.ts', 'utf8');

    expect(locks).toContain('JIRA_WORKSPACE: BigInt(9141005)');
    expect(concurrency).toContain('acquireSharedAdvisoryLock(tx, LOCK_KEYS.JIRA_WORKSPACE)');
    expect(concurrency).toContain('acquireAdvisoryLock(tx, LOCK_KEYS.JIRA_WORKSPACE)');
    expect(settings).toContain('await acquireJiraWorkspaceLifecycleFence(tx)');
    expect(worker).toContain('await acquireJiraWorkspaceProviderFence(tx)');
  });

  it('guards mapping and Jira-link writes at the database boundary', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('pg_advisory_xact_lock_shared(9141005::bigint)');
    expect(migration).toContain('trg_guard_jira_service_mapping_workspace');
    expect(migration).toContain('trg_guard_jira_external_issue_link_workspace');
    expect(migration.match(/"enabled" = TRUE/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('enforces one own Jira ticket per action item without duplicating incident context', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const actionItemActions = readFileSync('src/app/(app)/action-items/jira/actions.ts', 'utf8');

    expect(migration).toContain('ExternalIssueLink_jira_actionItemId_unique');
    expect(migration).toContain('WHERE "provider" = \'JIRA\' AND "actionItemId" IS NOT NULL');
    expect(migration).toContain('HAVING COUNT(*) > 1');
    expect(actionItemActions).toContain('await acquireJiraActionItemLinkFence(tx, actionItemId)');
  });

  it('never performs Jira provider synchronization during incident page rendering', () => {
    const page = readFileSync('src/app/(app)/incidents/[id]/page.tsx', 'utf8');

    expect(page).not.toContain("await import('@/lib/jira-sync')");
    expect(page).not.toContain('syncExternalIssueLink(');
  });

  it('fences the complete inbound webhook mutation chain', () => {
    const webhook = readFileSync('src/app/api/jira/webhook/route.ts', 'utf8');

    expect(webhook).toContain('withJiraWorkspaceProviderFence(() =>');
    expect(webhook).toContain('processJiraWebhookEvent(');
    expect(webhook).toContain("reason: 'integration_disabled_or_removed'");
  });
});
