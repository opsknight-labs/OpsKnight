import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationPath = path.join(
  root,
  'prisma/migrations/20260916120000_unified_chatops_slack_backfill/migration.sql'
);

describe('unified ChatOps Slack backfill contract', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');

  it('adopts only legacy incidents with a concrete Slack channel', () => {
    expect(migration).toContain('incident."slackChannelId" IS NOT NULL');
    expect(migration).toContain('\'SLACK\'::"WarRoomProvider"');
  });

  it('preserves existing neutral authority and can be rerun safely', () => {
    expect(migration).toContain('ON CONFLICT ("incidentId", "provider", "generation") DO NOTHING');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"Incident"/i);
    expect(migration).not.toMatch(/DROP\s+COLUMN/i);
  });

  it('preserves archived state and records migration provenance', () => {
    expect(migration).toContain('incident."warRoomArchivedAt" IS NOT NULL');
    expect(migration).toContain('\'ARCHIVED\'::"WarRoomState"');
    expect(migration).toContain("'unified-chatops-slack-backfill'");
  });
});
