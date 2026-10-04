import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'prisma/migrations/20261003210000_harden_runbook_targeting_and_enums/migration.sql',
  'utf8'
);

describe('runbook database hardening migration', () => {
  it('converts every runbook state column to its PostgreSQL enum', () => {
    for (const enumName of [
      'RunbookVersionState',
      'RunbookBindingMode',
      'RunbookVersionStrategy',
      'RunbookTriggerEvent',
      'RunbookExecutionStatus',
      'RunbookStepType',
      'RunbookRiskClass',
      'RunbookStepStatus',
      'RunbookAttemptStatus',
      'RunbookAgentStatus',
      'RunbookAgentPoolMode',
      'RunbookConditionOperator',
      'RunbookInputType',
      'RunbookTriggerByType',
      'RunbookConditionLogic',
    ]) {
      expect(migration).toContain(`CREATE TYPE "${enumName}" AS ENUM`);
      expect(migration).toContain(`TYPE "${enumName}" USING`);
    }
  });

  it('separates immutable targets from claimant identity at the database boundary', () => {
    expect(migration).toContain('RENAME COLUMN "agentId" TO "targetAgentId"');
    expect(migration).toContain('ADD COLUMN "claimedAgentId" TEXT');
    expect(migration).toContain('RunbookExecution_single_target_check');
    expect(migration).toContain('RunbookStepAttempt_single_target_check');
  });

  it('stores suggestions durably with a unique idempotency fingerprint', () => {
    expect(migration).toContain('CREATE TABLE "RunbookSuggestion"');
    expect(migration).toContain('RunbookSuggestion_fingerprint_key');
  });
});
