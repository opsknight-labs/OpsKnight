import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Microsoft Teams war-room collaboration contract', () => {
  it('keeps projection, health, and participant-sync state provider-neutral', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const enumsMigration = readFileSync(
      'prisma/migrations/20260916110000_microsoft_teams_phase3_collaboration_enums/migration.sql',
      'utf8'
    );
    const stateMigration = readFileSync(
      'prisma/migrations/20260916110100_microsoft_teams_phase3_collaboration_state/migration.sql',
      'utf8'
    );
    const allMigrations = `${enumsMigration}\n${stateMigration}`;

    expect(schema).toContain('enum WarRoomHealthState');
    expect(schema).toContain('projectionVersion     Int                   @default(0)');
    expect(schema).toContain('lastProjectedAt       DateTime?');
    expect(schema).toContain('lastReconciledAt      DateTime?');
    expect(schema).toContain('lastSyncAt       DateTime?');
    expect(schema).toContain('lastErrorCode    String?');
    const participantState = schema.match(/enum WarRoomParticipantState \{([\s\S]*?)\n\}/)?.[1];
    expect(participantState).toContain('PENDING');
    expect(participantState).toContain('PROCESSING');
    expect(enumsMigration).toContain("ADD VALUE 'PENDING'");
    expect(enumsMigration).toContain("ADD VALUE 'WAR_ROOM_PARTICIPANT_SYNC'");
    // Enum mutation must be isolated from other DDL for Postgres transaction safety.
    expect(enumsMigration).not.toContain('CREATE TYPE "WarRoomHealthState"');
    expect(enumsMigration).not.toContain('CREATE INDEX');
    expect(stateMigration).toContain('CREATE TYPE "WarRoomHealthState"');
    expect(allMigrations).toContain('CREATE TYPE "WarRoomHealthState"');
  });

  it('keeps the Teams app manifest version aligned with the collaboration capabilities', async () => {
    const { MICROSOFT_TEAMS_MANIFEST_VERSION } = await import('@/lib/microsoft-teams/app-manifest');
    expect(MICROSOFT_TEAMS_MANIFEST_VERSION).toBe('1.3.0');
  });
});
