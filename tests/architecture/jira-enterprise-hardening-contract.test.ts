import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const ownershipMigration =
  'prisma/migrations/20260911124000_enforce_jira_external_issue_owner/migration.sql';

describe('Jira enterprise hardening architecture', () => {
  it('enforces exactly one parent at the database boundary', () => {
    const migration = readFileSync(ownershipMigration, 'utf8');
    expect(migration).toContain('num_nonnulls("incidentId", "actionItemId") = 1');
    expect(migration).toContain('VALIDATE CONSTRAINT "ExternalIssueLink_exactly_one_owner_check"');
  });

  it('never uses ownership-changing Jira link upserts', () => {
    const sync = readFileSync('src/lib/jira-sync.ts', 'utf8');
    const worker = readFileSync('src/lib/external-operations.ts', 'utf8');

    expect(sync).not.toContain('externalIssueLink.upsert');
    expect(worker).not.toContain('externalIssueLink.upsert');
    expect(sync).toContain('acquireJiraExternalIssueLinkFence');
    expect(worker).toContain('acquireJiraExternalIssueLinkFence');
  });

  it('durably claims and serializes Jira webhook deliveries', () => {
    const route = readFileSync('src/app/api/jira/webhook/route.ts', 'utf8');
    expect(route).toContain('claimInboundDelivery(');
    expect(route).toContain('completeInboundDelivery(');
    expect(route).toContain('failInboundDelivery(');
    expect(route).toContain("withJiraIssueMutationFence('JIRA'");
    expect(route).toContain("request.headers.get('x-atlassian-webhook-identifier')");
  });

  it('uses one workspace-level provider admission state for Jira operations', () => {
    const worker = readFileSync('src/lib/external-operations.ts', 'utf8');
    expect(worker).toContain("const JIRA_PROVIDER_KEY = 'jira:workspace'");
    expect(worker.match(/assertProviderAdmitted\(JIRA_PROVIDER_KEY\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(worker).toContain('providerRetryAfterMs');
    expect(worker).toContain("operationFailureStatus(operation.attempts)");
  });
});
