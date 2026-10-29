import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Microsoft Teams war-room lifecycle contract', () => {
  it('requests Teams rooms through the outbox and never performs Graph I/O in incident actions', () => {
    const effects = readFileSync('src/lib/event-side-effects.ts', 'utf8');
    const actions = readFileSync('src/app/(app)/incidents/actions.ts', 'utf8');
    // Unified ChatOps: event side-effects route through the neutral engine
    // (provider-neutral War Room Engine → Provider Registry → Adapters). The
    // engine fans out TRIGGER/ENSURE/ARCHIVE to every registered provider; the
    // file must never import a provider implementation directly.
    expect(effects).toContain("import('./war-room/engine')");
    expect(effects).toContain('handleIncidentWarRoomEvent');
    expect(effects).toContain("kind: 'TRIGGER'");
    expect(effects).toContain("kind: 'ENSURE'");
    expect(effects).toContain("kind: 'ARCHIVE'");
    expect(effects).not.toContain("war-room/microsoft-teams");
    expect(effects).not.toContain("war-room/participants");
    expect(effects).not.toContain("war-room/projection");
    expect(effects).not.toContain('createChannel(');
    expect(actions).not.toContain('requestMicrosoftTeamsWarRoom(');
    expect(actions).not.toContain('handleIncidentWarRoomEvent(');
    expect(actions).not.toContain('createChannel(');
  });

  it('requires explicit generation intent and rejects creation for inactive incidents', () => {
    // Canonical implementation moved to providers/microsoft-teams/provision.ts;
    // facade at war-room/microsoft-teams.ts re-exports it — accept either path.
    const readFacadeOrCanonical = () => {
      try {
        const fac = readFileSync('src/lib/war-room/microsoft-teams.ts', 'utf8');
        if (fac.includes('export * from')) {
          return readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
        }
        return fac;
      } catch {
        return readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
      }
    };
    const teams = readFacadeOrCanonical();
    expect(teams).toContain('reopen: intent.allowNewGeneration');
    expect(teams).toContain("return { accepted: false, code: 'INCIDENT_NOT_ACTIVE' }");
    expect(teams).toContain('currentIncident = await prisma.incident.findUnique');
  });

  it('fences resolve races with predicate updates and preserves reconciliation', () => {
    const readFacadeOrCanonical = () => {
      try {
        const fac = readFileSync('src/lib/war-room/microsoft-teams.ts', 'utf8');
        if (fac.includes('export * from')) {
          return readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
        }
        return fac;
      } catch {
        return readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
      }
    };
    const teams = readFacadeOrCanonical();
    expect(teams).toContain("lastErrorCode: 'INCIDENT_RESOLVED_DURING_CREATE'");
    expect(teams).toContain('const token = alreadyReconciliationOnly ? prior.provisioningToken! : crypto.randomUUID()');
    expect(teams).toContain('reconciliationOnly: true');
    expect(teams).toContain('createAttemptedAt: { not: null }');
    expect(teams).toContain('createAttemptedAt: null');
    expect(teams).toContain('if (room.createAttemptedAt)');
    expect(teams).toContain('A prior Teams channel-create may have succeeded; reconciling by marker only.');
    const firstAttempted = teams.indexOf('createAttemptedAt: { not: null }');
    const safeFailure = teams.indexOf('createAttemptedAt: null');
    const secondAttempted = teams.indexOf('createAttemptedAt: { not: null }', firstAttempted + 1);
    expect(firstAttempted).toBeGreaterThan(-1);
    expect(safeFailure).toBeGreaterThan(firstAttempted);
    expect(secondAttempted).toBeGreaterThan(safeFailure);
  });

  it('makes final external-channel adoption incident-state aware', () => {
    const repository = readFileSync('src/lib/war-room/repository.ts', 'utf8');
    expect(repository).toContain("const resolved = current.incident.status === 'RESOLVED'");
    // Any RESOLVED channel must adopt as CLOSING (never direct CLOSED) so the
    // durable CLOSING → terminal projection → provider archive lifecycle owns it.
    expect(repository).toContain("const shouldClose = resolved");
    expect(repository).toContain("state: shouldClose ? 'CLOSING' : 'READY'");
    expect(repository).toContain("return shouldClose ? 'CLOSING' : 'READY'");
    expect(repository).toContain('Never adopt a late-created channel directly as CLOSED');
  });
});
