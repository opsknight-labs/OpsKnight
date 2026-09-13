import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Microsoft Teams war-room collaboration contract', () => {
  it('keeps projection, health, and participant-sync state provider-neutral', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const migration = readFileSync(
      'prisma/migrations/20260916110000_microsoft_teams_phase3_collaboration_projection/migration.sql',
      'utf8'
    );

    expect(schema).toContain('enum WarRoomHealthState');
    expect(schema).toContain('projectionVersion     Int                   @default(0)');
    expect(schema).toContain('lastProjectedAt       DateTime?');
    expect(schema).toContain('lastReconciledAt      DateTime?');
    expect(schema).toContain('lastSyncAt       DateTime?');
    expect(schema).toContain('lastErrorCode    String?');
    const participantState = schema.match(/enum WarRoomParticipantState \{([\s\S]*?)\n\}/)?.[1];
    expect(participantState).toContain('PENDING');
    expect(participantState).toContain('PROCESSING');
    expect(migration).toContain("ADD VALUE 'PENDING'");
    expect(migration).toContain('CREATE TYPE "WarRoomHealthState"');
  });
});
