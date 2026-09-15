import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// ── Contract string checks (fast, no DB) ──
describe('close reconciliation & archive isolation contracts (source)', () => {
  it('engine threads reconciliationOnly through WAR_ROOM_PROVISION (queue) -> provisionWarRoom -> adapter', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    const queue = readFileSync('src/lib/jobs/queue.ts', 'utf8');
    const provider = readFileSync('src/lib/war-room/provider.ts', 'utf8');
    expect(engine).toContain('provisionWarRoom(');
    expect(engine).toContain('reconciliationOnly');
    expect(engine).toContain("if (!opts?.reconciliationOnly && room?.state === 'CLOSING') return");
    expect(engine).toContain('adapter.provision(warRoomId, provisioningToken, opts)');
    expect(queue).toContain('reconciliationOnly');
    expect(queue).toContain('provisionWarRoom(');
    expect(provider).toContain('provision(warRoomId: string, provisioningToken: string, opts?: { reconciliationOnly');
  });

  it('Slack reconciliationOnly is marker-only (AMBIGUOUS|CLOSING) and never POSTs', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    expect(slack).toContain('reconciliationOnly');
    expect(slack).toContain("if (reconciliationOnly) {");
    expect(slack).toContain("if (!['AMBIGUOUS', 'CLOSING'].includes(room.state)) return");
    expect(slack).toContain("if (!['PROVISIONING', 'AMBIGUOUS'].includes(room.state)) return");
    expect(slack).toContain('reconciliationOnly: marker-only, never POST');
    expect(slack).toContain('No Slack channel was found by marker/planned name during reconciliation window');
    // Must return before reaching conversations.create
    const reconStart = slack.indexOf('if (reconciliationOnly) {', slack.indexOf('reconciliationOnly: marker-only'));
    const postCreate = slack.indexOf("slackApiCall('conversations.create'", reconStart);
    // There is a reconciliationOnly return before the create
    const reconReturn = slack.indexOf('return;', reconStart);
    expect(reconReturn).toBeGreaterThan(reconStart);
    expect(reconReturn).toBeLessThan(postCreate);
  });

  it('Teams reconciliationOnly is marker-only (AMBIGUOUS|CLOSING) and never POSTs', () => {
    const teams = readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
    expect(teams).toContain('reconciliationOnly');
    expect(teams).toContain("if (reconciliationOnly) {");
    expect(teams).toContain("if (!['AMBIGUOUS', 'CLOSING'].includes(room.state)) return");
    expect(teams).toContain("if (!['PROVISIONING', 'AMBIGUOUS'].includes(room.state)) return");
    expect(teams).toContain('No Teams channel was found by marker during the reconciliation window');
    expect(teams).toContain('Reconciling CLOSING Teams channel-create by marker only');
    // reconciliationOnly block must precede the durable create gate
    const reconIdx = teams.indexOf("if (reconciliationOnly) {");
    const gateIdx = teams.indexOf('// createAttemptedAt is the durable one-way gate');
    expect(reconIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(reconIdx);
  });

  it('CLOSING reconciliation window-exhausted clears provisioningToken and queues terminal close (Slack+Teams)', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    const teams = readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
    expect(slack).toContain('CREATE_RECONCILIATION_EXHAUSTED');
    expect(slack).toContain('provisioningToken: null');
    expect(slack).toContain('ensureTerminalCloseJobsAfterClosingAdoption');
    expect(slack).toContain('closeWarRoomNeutral');
    expect(teams).toContain('CREATE_RECONCILIATION_EXHAUSTED');
    expect(teams).toContain('provisioningToken: null');
    expect(teams).toContain('ensureTerminalCloseJobsAfterClosingAdoption');
    expect(teams).toContain('closeWarRoomNeutral');
  });

  it('found→adopt CLOSING queues terminal projection+close (both providers)', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    const teams = readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
    expect(slack).toContain("if (adoption === 'CLOSING')");
    expect(slack).toContain('ensureTerminalCloseJobsAfterClosingAdoption');
    expect(teams).toContain("if (adoption === 'CLOSING')");
    expect(teams).toContain('ensureTerminalCloseJobsAfterClosingAdoption');
  });

  it('ARCHIVE deliveries are provider-scoped (closeProviderWarRoomsNeutral)', () => {
    const slackAdapter = readFileSync('src/lib/war-room/providers/slack/adapter.ts', 'utf8');
    const teamsAdapter = readFileSync('src/lib/war-room/providers/microsoft-teams/adapter.ts', 'utf8');
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    expect(engine).toContain('closeProviderWarRoomsNeutral');
    expect(engine).toContain('providerFilter');
    expect(slackAdapter).toContain("closeProviderWarRoomsNeutral(event.incidentId, 'SLACK')");
    expect(teamsAdapter).toContain("closeProviderWarRoomsNeutral(event.incidentId, 'MICROSOFT_TEAMS')");
    // Adapters must not call cross-provider global close at runtime (comment mentioning the outbox helper is allowed)
    // So check that no adapter directly invokes closeIncidentWarRoomsNeutral at runtime
    const slackHasRuntimeGlobalClose = /await\s+closeIncidentWarRoomsNeutral\s*\(/.test(slackAdapter);
    const teamsHasRuntimeGlobalClose = /await\s+closeIncidentWarRoomsNeutral\s*\(/.test(teamsAdapter);
    expect(slackHasRuntimeGlobalClose).toBe(false);
    expect(teamsHasRuntimeGlobalClose).toBe(false);
  });

  it('ensureWarRoomReconciliationJob does not swallow enqueue failures', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    expect(engine).toContain('Do NOT swallow enqueue failures');
    const start = engine.indexOf('async function ensureWarRoomReconciliationJob');
    const end = engine.indexOf('/** Repair helper', start);
    const ensureFn = engine.slice(start, end === -1 ? start + 2000 : end);
    expect(ensureFn).not.toContain('.catch(');
    expect(ensureFn).toMatch(/await prisma\.backgroundJob\.create\(\{[\s\S]*?reconciliationOnly: true/);
  });

  it('closeRequestedAt persists on AMBIGUOUS resolve and drives CLOSING adoption', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    const repo = readFileSync('src/lib/war-room/repository.ts', 'utf8');
    expect(engine).toContain('closeRequestedAt');
    expect(repo).toContain('closeRequestedAt');
    expect(repo).toContain("adoptAsClosing = resolved && current.closeRequestedAt != null && current.state === 'AMBIGUOUS'");
  });

  it('CLOSING reconciliation throws budget-neutral retry while window remains, then deterministic close', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    const teams = readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
    // Budget-neutral retry: WarRoomRetryableError with retryBudgetNeutral=true (3rd arg true)
    expect(slack).toContain('WarRoomRetryableError');
    expect(slack).toContain('Reconciling CLOSING Slack channel-create by marker/planned name');
    expect(teams).toContain('WarRoomRetryableError');
    expect(teams).toContain('Reconciling CLOSING Teams channel-create by marker only');
    // Both have remaining>0 check
    expect(slack).toContain('remaining > 0');
    expect(teams).toContain('remaining > 0');
  });

  it('queue WAR_ROOM_PROVISION threads reconciliationOnly flag to provisionWarRoom', () => {
    const queue = readFileSync('src/lib/jobs/queue.ts', 'utf8');
    expect(queue).toContain('reconciliationOnly');
    expect(queue).toContain('provisionWarRoom(');
    // Verifies queue reads rawProvision.reconciliationOnly and passes opts
    expect(queue).toContain('rawProvision.reconciliationOnly === true');
    expect(queue).toContain('reconciliationOnly ? { reconciliationOnly: true } : undefined');
  });

  it('engine closeIncidentWarRoomsNeutral provider filter is spread into where clause', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    expect(engine).toContain('providerFilter');
    expect(engine).toContain('...providerFilter');
    expect(engine).toContain("opts?: { provider?: WarRoomProviderName }");
  });

  it('Slack reconciliationOnly skips PRIVATE check and authority check (CLOSING must reconcile even when RESOLVED)', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    expect(slack).toContain("if (!reconciliationOnly && room.membershipType === 'PRIVATE')");
    expect(slack).toContain('if (!reconciliationOnly) {');
    // Authority check is inside that guard
    const guardIdx = slack.indexOf('if (!reconciliationOnly) {');
    const authorityIdx = slack.indexOf("INCIDENT_NOT_ACTIVE", guardIdx);
    expect(authorityIdx).toBeGreaterThan(guardIdx);
  });
});

// ── Behavioral: provisionWarRoom fencing (isolated via dynamic import) ──
describe('provisionWarRoom CLOSING fencing (behavioral)', () => {
  it('reconciliationOnly bypasses CLOSING fence and calls adapter.provision', async () => {
    vi.resetModules();
    const provisionMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/prisma', () => ({
      default: {
        incidentWarRoom: { findUnique: vi.fn().mockResolvedValue({ state: 'CLOSING' }) },
        backgroundJob: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      },
    }));
    vi.doMock('@/lib/war-room/registry', () => ({
      listWarRoomProviders: () => [],
      getWarRoomProvider: vi.fn(() => ({ provision: provisionMock, capabilities: {} } as never)),
    }));
    const { provisionWarRoom } = await import('@/lib/war-room/engine');
    await provisionWarRoom('room-1', 'tok-1', { reconciliationOnly: true });
    expect(provisionMock).toHaveBeenCalledWith('room-1', 'tok-1', { reconciliationOnly: true });
    vi.doUnmock('@/lib/prisma');
    vi.doUnmock('@/lib/war-room/registry');
    vi.resetModules();
  });

  it('normal provision is fenced when state is CLOSING', async () => {
    vi.resetModules();
    const provisionMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/prisma', () => ({
      default: {
        incidentWarRoom: { findUnique: vi.fn().mockResolvedValue({ state: 'CLOSING' }) },
        backgroundJob: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      },
    }));
    vi.doMock('@/lib/war-room/registry', () => ({
      listWarRoomProviders: () => [],
      getWarRoomProvider: vi.fn(() => ({ provision: provisionMock, capabilities: {} } as never)),
    }));
    const { provisionWarRoom } = await import('@/lib/war-room/engine');
    await provisionWarRoom('room-1', 'tok-1');
    expect(provisionMock).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/prisma');
    vi.doUnmock('@/lib/war-room/registry');
    vi.resetModules();
  });
});
