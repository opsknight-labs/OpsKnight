import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const failedMigrationPath =
  'prisma/migrations/20260910174500_guard_jira_mapping_workspace/migration.sql';
const repairMigrationPath =
  'prisma/migrations/20260911013000_jira_action_item_link_rolling_guard/migration.sql';

describe('Jira rolling migration contract', () => {
  it('recovers only the exact known duplicate-data/index-build failure class', () => {
    const failedMigration = readFileSync(failedMigrationPath, 'utf8');
    const recovery = readFileSync('scripts/auto-recover-migrations.ts', 'utf8');

    expect(failedMigration).toContain(
      'Cannot enforce one Jira issue per action item: duplicate Jira links exist.'
    );
    expect(recovery).toContain("'20260910174500_guard_jira_mapping_workspace'");
    expect(recovery).toContain(
      "'Cannot enforce one Jira issue per action item: duplicate Jira links exist.'"
    );
    expect(recovery).toContain("'ExternalIssueLink_jira_actionItemId_unique'");
    expect(recovery).toContain("['migrate', 'resolve', '--applied', migrationName]");
    expect(recovery).toContain('failedLegacyPrecondition || failedUniqueIndexBuild');
    expect(recovery).toContain('AND rolled_back_at IS NULL');
  });

  it('never requires historical duplicate cleanup during application startup', () => {
    const repairMigration = readFileSync(repairMigrationPath, 'utf8');

    expect(repairMigration).not.toContain('HAVING COUNT(*) > 1');
    expect(repairMigration).not.toContain('CREATE UNIQUE INDEX');
    expect(repairMigration).not.toContain('DELETE FROM "ExternalIssueLink"');
    expect(repairMigration).not.toContain('UPDATE "ExternalIssueLink" SET');
  });

  it('blocks new duplicates at write time while preserving metadata sync for legacy rows', () => {
    const repairMigration = readFileSync(repairMigrationPath, 'utf8');

    expect(repairMigration).toContain('guard_jira_action_item_single_link');
    expect(repairMigration).toContain('hashtextextended(NEW."actionItemId", 9141006::bigint)');
    expect(repairMigration).toContain('BEFORE INSERT ON "ExternalIssueLink"');
    expect(repairMigration).toContain(
      'BEFORE UPDATE OF "provider", "actionItemId" ON "ExternalIssueLink"'
    );
    expect(repairMigration).toContain('IF TG_OP = \'UPDATE\' THEN');
    expect(repairMigration).toContain('"id" <> NEW."id"');
    expect(repairMigration).toContain("ERRCODE = '23505'");
  });

  it('recreates workspace lifecycle guards idempotently after partial failure', () => {
    const repairMigration = readFileSync(repairMigrationPath, 'utf8');

    expect(repairMigration).toContain(
      'CREATE OR REPLACE FUNCTION "guard_jira_service_mapping_workspace"()'
    );
    expect(repairMigration).toContain(
      'CREATE OR REPLACE FUNCTION "guard_jira_external_issue_link_workspace"()'
    );
    expect(repairMigration.match(/pg_advisory_xact_lock_shared\(9141005::bigint\)/g)?.length).toBe(
      2
    );
  });
});
