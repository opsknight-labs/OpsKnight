import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Microsoft Teams war-room lifecycle contract', () => {
  it('requests Teams rooms through the outbox and never performs Graph I/O in incident actions', () => {
    const effects = readFileSync('src/lib/event-side-effects.ts', 'utf8');
    const actions = readFileSync('src/app/(app)/incidents/actions.ts', 'utf8');
    expect(effects).toContain("import('./war-room/microsoft-teams')");
    expect(effects).toContain(
      'requestMicrosoftTeamsWarRoom(payload.incidentId, { manual: false, allowNewGeneration: false })'
    );
    expect(effects).toContain(
      'requestMicrosoftTeamsWarRoom(payload.incidentId, { manual: false, allowNewGeneration: true })'
    );
    expect(effects).toContain('settleMicrosoftTeamsWarRoomsOnIncidentResolve(payload.incidentId)');
    expect(actions).not.toContain('requestMicrosoftTeamsWarRoom(');
    expect(actions).not.toContain('createChannel(');
  });

  it('requires explicit generation intent and rejects creation for inactive incidents', () => {
    const teams = readFileSync('src/lib/war-room/microsoft-teams.ts', 'utf8');
    expect(teams).toContain('reopen: intent.allowNewGeneration');
    expect(teams).toContain("return { accepted: false, code: 'INCIDENT_NOT_ACTIVE' }");
    expect(teams).toContain('currentIncident = await prisma.incident.findUnique');
  });

  it('fences resolve races into marker-only reconciliation with a fresh lease', () => {
    const teams = readFileSync('src/lib/war-room/microsoft-teams.ts', 'utf8');
    expect(teams).toContain("lastErrorCode: 'INCIDENT_RESOLVED_DURING_CREATE'");
    expect(teams).toContain('const token = alreadyReconciliationOnly ? room.provisioningToken! : crypto.randomUUID()');
    expect(teams).toContain('reconciliationOnly: true');
    expect(teams).toContain('if (room.createAttemptedAt)');
    expect(teams).toContain('A prior Teams channel-create may have succeeded; reconciling by marker only.');
  });

  it('makes final external-channel adoption incident-state aware', () => {
    const repository = readFileSync('src/lib/war-room/repository.ts', 'utf8');
    expect(repository).toContain("const resolved = current.incident.status === 'RESOLVED'");
    expect(repository).toContain("state: resolved ? 'CLOSED' : 'READY'");
    expect(repository).toContain("return resolved ? 'CLOSED' : 'READY'");
  });
});
