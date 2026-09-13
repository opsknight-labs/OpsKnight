import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Microsoft Teams war-room lifecycle contract', () => {
  it('requests Teams rooms through the outbox and never performs Graph I/O in incident actions', () => {
    const effects = readFileSync('src/lib/event-side-effects.ts', 'utf8');
    const actions = readFileSync('src/app/(app)/incidents/actions.ts', 'utf8');
    expect(effects).toContain("import('./war-room/microsoft-teams')");
    expect(effects).toContain('requestMicrosoftTeamsWarRoom(payload.incidentId, { manual: false, allowNewGeneration: false })');
    expect(effects).toContain('requestMicrosoftTeamsWarRoom(payload.incidentId, { manual: false, allowNewGeneration: true })');
    expect(effects).toContain('settleMicrosoftTeamsWarRoomsOnIncidentResolve(payload.incidentId)');
    expect(actions).not.toContain('requestMicrosoftTeamsWarRoom(');
    expect(actions).not.toContain('createChannel(');
  });

  it('requires an explicit lifecycle intent before creating another Teams generation', () => {
    const teams = readFileSync('src/lib/war-room/microsoft-teams.ts', 'utf8');
    expect(teams).toContain('reopen: intent.allowNewGeneration');
    expect(teams).toContain("currentIncident = await prisma.incident.findUnique");
    expect(teams).toContain("state: 'AMBIGUOUS', provisioningToken: null");
  });
});
