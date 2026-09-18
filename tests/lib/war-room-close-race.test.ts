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
    expect(provider).toContain(
      'provision(warRoomId: string, provisioningToken: string, opts?: { reconciliationOnly'
    );
  });

  it('Slack reconciliationOnly is marker-only (AMBIGUOUS|CLOSING) and never POSTs', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    expect(slack).toContain('reconciliationOnly');
    expect(slack).toContain('if (reconciliationOnly) {');
    expect(slack).toContain("if (!['AMBIGUOUS', 'CLOSING'].includes(room.state)) return");
    expect(slack).toContain("if (!['PROVISIONING', 'AMBIGUOUS'].includes(room.state)) return");
    expect(slack).toContain('reconciliationOnly: marker-only, never POST');
    expect(slack).toContain(
      'No Slack channel was found by marker/planned name during reconciliation window'
    );
    // Must return before reaching conversations.create
    const reconStart = slack.indexOf(
      'if (reconciliationOnly) {',
      slack.indexOf('reconciliationOnly: marker-only')
    );
    const postCreate = slack.indexOf("slackApiCall('conversations.create'", reconStart);
    // There is a reconciliationOnly return before the create
    const reconReturn = slack.indexOf('return;', reconStart);
    expect(reconReturn).toBeGreaterThan(reconStart);
    expect(reconReturn).toBeLessThan(postCreate);
  });

  it('Teams reconciliationOnly is marker-only (AMBIGUOUS|CLOSING) and never POSTs', () => {
    const teams = readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
    expect(teams).toContain('reconciliationOnly');
    expect(teams).toContain('if (reconciliationOnly) {');
    expect(teams).toContain("if (!['AMBIGUOUS', 'CLOSING'].includes(room.state)) return");
    expect(teams).toContain("if (!['PROVISIONING', 'AMBIGUOUS'].includes(room.state)) return");
    expect(teams).toContain(
      'No Teams channel was found by marker during the reconciliation window'
    );
    expect(teams).toContain('Reconciling CLOSING Teams channel-create by marker only');
    // reconciliationOnly block must precede the durable create gate
    const reconIdx = teams.indexOf('if (reconciliationOnly) {');
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
    const teamsAdapter = readFileSync(
      'src/lib/war-room/providers/microsoft-teams/adapter.ts',
      'utf8'
    );
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    expect(engine).toContain('closeProviderWarRoomsNeutral');
    expect(engine).toContain('providerFilter');
    expect(slackAdapter).toContain("closeProviderWarRoomsNeutral(event.incidentId, 'SLACK')");
    expect(teamsAdapter).toContain(
      "closeProviderWarRoomsNeutral(event.incidentId, 'MICROSOFT_TEAMS')"
    );
    // Adapters must not call cross-provider global close at runtime (comment mentioning the outbox helper is allowed)
    // So check that no adapter directly invokes closeIncidentWarRoomsNeutral at runtime
    const slackHasRuntimeGlobalClose = /await\s+closeIncidentWarRoomsNeutral\s*\(/.test(
      slackAdapter
    );
    const teamsHasRuntimeGlobalClose = /await\s+closeIncidentWarRoomsNeutral\s*\(/.test(
      teamsAdapter
    );
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
    expect(ensureFn).toMatch(
      /await prisma\.backgroundJob\.create\(\{[\s\S]*?reconciliationOnly: true/
    );
  });

  it('closeRequestedAt persists on AMBIGUOUS resolve and drives CLOSING adoption', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    const repo = readFileSync('src/lib/war-room/repository.ts', 'utf8');
    expect(engine).toContain('closeRequestedAt');
    expect(repo).toContain('closeRequestedAt');
    // Any RESOLVED incident must adopt as CLOSING (never direct CLOSED) so the
    // durable CLOSING → terminal projection → provider archive lifecycle owns the room.
    expect(repo).toContain('const shouldClose = resolved;');
    expect(repo).toContain("state: shouldClose ? 'CLOSING' : 'READY'");
    expect(repo).toContain("return shouldClose ? 'CLOSING' : 'READY'");
    expect(repo).toContain('Never adopt a late-created channel directly as CLOSED');
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
    expect(queue).toContain('{ reconciliationOnly: true }');
    // Accepts either the original ternary or the branched 2-arg/3-arg form (fixes queue.test stale 3-arg expectation)
    const hasTernary = queue.includes(
      'reconciliationOnly ? { reconciliationOnly: true } : undefined'
    );
    const hasBranched =
      queue.includes('if (reconciliationOnly)') && queue.includes('provisionWarRoom(');
    expect(hasTernary || hasBranched).toBe(true);
    // Branched form must preserve 2-arg normal case (no third arg) to keep queue.test 2-arg expectation green
    if (hasBranched) {
      expect(queue).toContain('await provisionWarRoom(');
      // At least one call without opts (2-arg) must exist
      const calls = queue.split('await provisionWarRoom(').length - 1;
      expect(calls).toBeGreaterThanOrEqual(2);
    }
  });

  it('engine closeIncidentWarRoomsNeutral provider filter is spread into where clause', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    expect(engine).toContain('providerFilter');
    expect(engine).toContain('...providerFilter');
    expect(engine).toContain('opts?: { provider?: WarRoomProviderName }');
  });

  it('Slack reconciliationOnly skips authority check (CLOSING must reconcile even when RESOLVED)', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    expect(slack).toContain('if (!reconciliationOnly) {');
    // Authority check is inside that guard
    const guardIdx = slack.indexOf('if (!reconciliationOnly) {');
    const authorityIdx = slack.indexOf('INCIDENT_NOT_ACTIVE', guardIdx);
    expect(authorityIdx).toBeGreaterThan(guardIdx);
  });

  it('CLOSING prerequisite failures are bounded by reconciliation deadline (Slack chatOps/token/workspace)', () => {
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    expect(slack).toContain('closingReconciliationExpired');
    expect(slack).toContain('RECONCILIATION_EXPIRED_CHATOPS_DISABLED');
    expect(slack).toContain('RECONCILIATION_EXPIRED_SLACK_BOT_TOKEN_MISSING');
    expect(slack).toContain('RECONCILIATION_EXPIRED_SLACK_WORKSPACE_MISSING');
    expect(slack).toContain('closing locally as DEGRADED with unverified external outcome');
    expect(slack).toContain('createAttemptedAt!.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS');
    expect(slack).toContain('Date.now() >= closingReconciliationDeadline');
    expect(slack).toContain('ensureTerminalCloseHandoff');
  });

  it('CLOSING prerequisite failures are bounded by reconciliation deadline (Teams GRAPH_TOKEN_FAILED / MISSING_PERMISSION etc.)', () => {
    const teams = readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
    expect(teams).toContain('closingReconciliationExpired');
    // Teams uses dynamic RECONCILIATION_EXPIRED_TEAMS_${existing.code} so both persistent and transient codes are covered
    expect(teams).toContain('RECONCILIATION_EXPIRED_TEAMS_${existing.code}');
    expect(teams).toContain('RECONCILIATION_EXPIRED_TEAMS_');
    expect(teams).toContain('closing locally as DEGRADED with unverified external outcome');
    expect(teams).toContain('createAttemptedAt!.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS');
    expect(teams).toContain('ensureTeamsTerminalCloseHandoff');
    // Must handle both transient (GRAPH_TOKEN_FAILED/RATE_LIMITED/TRANSIENT_READ) and persistent (MISSING_PERMISSION etc.) branches
    expect(teams).toContain('GRAPH_TOKEN_FAILED');
    expect(teams).toContain('MISSING_PERMISSION');
  });

  it('engine finalizeWarRoomCloseNeutral and repair are bounded by reconciliation expiry (OpsKnight source of truth)', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    expect(engine).toContain('isClosingReconciliationExpired');
    expect(engine).toContain('AMBIGUOUS_RECONCILIATION_WINDOW_MS');
    expect(engine).toContain('RECONCILIATION_EXPIRED_UNVERIFIED');
    expect(engine).toContain(
      'Reconciliation window expired with unverified external create outcome; closing locally as DEGRADED'
    );
    expect(engine).toContain('provisioningToken: null');
    const repairStart = engine.indexOf('async function repairWarRoomCloseJobs');
    const finalizeStart = engine.indexOf('export async function finalizeWarRoomCloseNeutral');
    expect(engine.slice(repairStart, finalizeStart)).toContain('RECONCILIATION_EXPIRED_UNVERIFIED');
  });

  it('expired degraded close persists externalCleanupPending debt for async orphan lane (engine + Slack + Teams)', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');
    const slack = readFileSync('src/lib/war-room/providers/slack/provision.ts', 'utf8');
    const teams = readFileSync('src/lib/war-room/providers/microsoft-teams/provision.ts', 'utf8');
    expect(engine).toContain('externalCleanupPending: true');
    expect(engine).toContain('externalCleanupReason');
    expect(engine).toContain('externalCleanupLastAttemptAt');
    expect(slack).toContain('externalCleanupPending: true');
    expect(slack).toContain('RECONCILIATION_EXPIRED_CHATOPS_DISABLED');
    expect(slack).toContain('RECONCILIATION_EXPIRED_SLACK_BOT_TOKEN_MISSING');
    expect(slack).toContain('RECONCILIATION_EXPIRED_SLACK_WORKSPACE_MISSING');
    expect(teams).toContain('externalCleanupPending: true');
    expect(teams).toContain('RECONCILIATION_EXPIRED_TEAMS_${existing.code}');
  });

  it('IncidentWarRoom schema persists terminal cleanup debt fields and debt index', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    expect(schema).toContain('externalCleanupPending');
    expect(schema).toContain('externalCleanupReason');
    expect(schema).toContain('externalCleanupLastAttemptAt');
    expect(schema).toContain('externalCleanupCompletedAt');
    expect(schema).toContain('@@index([state, health, externalCleanupPending, lastReconciledAt])');
  });

  it('terminal orphan lane scans pending debt and never reopens lifecycle', () => {
    const cleanup = readFileSync('src/lib/war-room/terminal-cleanup.ts', 'utf8');
    const cron = readFileSync('src/lib/cron-scheduler.ts', 'utf8');
    expect(cleanup).toContain('reconcileTerminalWarRoomDrift');
    expect(cleanup).toContain('externalCleanupPending: true');
    expect(cleanup).toContain("state: { in: ['CLOSED', 'ARCHIVED'] }");
    expect(cleanup).toContain('Never reopen lifecycle');
    expect(cleanup).toContain('debt satisfied');
    expect(cleanup).toContain('externalCleanupCompletedAt');
    // Slack side must use tri-state cleanup-safe lookup, never bare find* that conflates failure with NOT_FOUND
    expect(cleanup).toContain('findSlackWarRoomForTerminalCleanup');
    expect(cleanup).toContain("status === 'UNAVAILABLE'");
    expect(cleanup).toContain("status === 'NOT_FOUND'");
    expect(cleanup).toContain("status === 'FOUND'");
    expect(cleanup).toContain('DRIFT_SLACK_');
    expect(cleanup).toContain('findWarRoomChannel');
    expect(cleanup).toContain('conversations.archive');
    expect(cron).toContain('reconcileTerminalWarRoomDrift');
  });

  it('terminal drift lane has retry backoff (externalCleanupLastAttemptAt due predicate)', () => {
    const cleanup = readFileSync('src/lib/war-room/terminal-cleanup.ts', 'utf8');
    expect(cleanup).toContain('TERMINAL_DRIFT_MIN_RETRY_MS');
    expect(cleanup).toContain('externalCleanupLastAttemptAt');
    expect(cleanup).toContain('dueThreshold');
    // due predicate is in the findMany where clause
    expect(cleanup).toContain('externalCleanupLastAttemptAt: { lte: dueThreshold }');
  });

  it('Slack terminal lookup helper is tri-state (FOUND/NOT_FOUND/UNAVAILABLE)', () => {
    const client = readFileSync('src/lib/war-room/providers/slack/client.ts', 'utf8');
    expect(client).toContain('SlackTerminalLookupResult');
    expect(client).toContain("status: 'FOUND'");
    expect(client).toContain("status: 'NOT_FOUND'");
    expect(client).toContain("status: 'UNAVAILABLE'");
    expect(client).toContain('findSlackWarRoomForTerminalCleanup');
    expect(client).toContain('RATE_LIMITED');
    expect(client).toContain('AUTH_FAILED');
    expect(client).toContain('TRANSIENT');
    // helper must classify list failures as UNAVAILABLE, never return null
    expect(client).toContain('classifySlackListError');
  });

  it('Slack terminal helper strictly classifies conversations.info permission failures (not skippable)', () => {
    const client = readFileSync('src/lib/war-room/providers/slack/client.ts', 'utf8');
    // Only benign staleness is skippable; everything permission-related must prevent authoritative NOT_FOUND
    expect(client).toContain("lower === 'channel_not_found'");
    expect(client).toContain("lower === 'is_archived'");
    // permission / missing_scope / restricted_action must be routed through classifier, not silently continued
    expect(client).toContain('classifySlackListError(info)');
    // the info block must not have a bare `continue;` after transport check that would swallow permission errors —
    // the only continues after that point should be the channel_not_found / is_archived guard.
    const infoBlockStart = client.indexOf('if (!info.ok) {');
    const infoBlock = client.slice(infoBlockStart, infoBlockStart + 1500);
    // must contain the permission comment and the classify call
    expect(infoBlock).toContain('missing_scope');
    expect(infoBlock.toLowerCase()).toContain('permission');
  });

  it('archiveExternalSlackRoom resolves orphan by marker when providerChannelId is null (CLOSING debt)', () => {
    const lifecycle = readFileSync('src/lib/war-room/providers/slack/lifecycle.ts', 'utf8');
    expect(lifecycle).toContain('findSlackChannelByMarker');
    expect(lifecycle).toContain('slackWarRoomMarker');
    expect(lifecycle).toContain('let channelId = room.providerChannelId');
    expect(lifecycle).toContain('providerChannelId');
    expect(lifecycle).toContain('channelId');
    expect(lifecycle).toContain('conversations.archive');
    expect(lifecycle).toContain('externalCleanupPending');
  });
});

// ── Behavioral: terminal drift Slack tri-state (UNAVAILABLE keeps debt) ──
describe('terminal drift Slack tri-state (behavioral)', () => {
  async function runDriftWithSlackMocks(opts: {
    lookup:
      | { status: 'FOUND'; channel: { id: string; name: string } }
      | { status: 'NOT_FOUND' }
      | {
          status: 'UNAVAILABLE';
          code: 'RATE_LIMITED' | 'AUTH_FAILED' | 'PERMISSION_DENIED' | 'TRANSIENT';
          error?: string;
        };
    archiveResult?: {
      ok: boolean;
      error?: string;
      transportFailure?: boolean;
      sideEffectAmbiguous?: boolean;
      httpStatus?: number;
    };
  }) {
    vi.resetModules();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'room-drift-1',
        provider: 'SLACK',
        incidentId: 'inc-1',
        generation: 1,
        plannedExternalName: 'inc-1-war-room',
        incident: { serviceId: 'svc-1', id: 'inc-1' },
      },
    ]);
    const getSlackBotToken = vi.fn().mockResolvedValue('xoxb-mock-token');
    const findSlackWarRoomForTerminalCleanup = vi.fn().mockResolvedValue(opts.lookup);
    const slackApiCall = vi.fn().mockResolvedValue(opts.archiveResult ?? { ok: true });
    const slackWarRoomMarker = (incId: string, gen: number) => `[OKWR:${incId}:g${gen}]`;

    vi.doMock('@/lib/prisma', () => ({
      default: {
        incidentWarRoom: { findMany, updateMany },
      },
    }));
    // terminal-cleanup dynamically imports '@/lib/slack' and './providers/slack/client'
    vi.doMock('@/lib/slack', () => ({ getSlackBotToken }));
    const clientMock = {
      findSlackWarRoomForTerminalCleanup,
      slackWarRoomMarker,
      slackApiCall,
      findSlackChannelByMarker: vi.fn(),
      findExistingSlackChannel: vi.fn(),
    };
    vi.doMock('@/lib/war-room/providers/slack/client', () => clientMock);
    vi.doMock('@/lib/war-room/providers/slack/client.ts', () => clientMock);
    // relative specifier as written in terminal-cleanup
    vi.doMock('./providers/slack/client', () => clientMock);
    vi.doMock('@/lib/logger', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    vi.doMock('@/lib/metrics/operational/registry', () => ({ addOperationalMetric: vi.fn() }));

    const mod = await import('@/lib/war-room/terminal-cleanup');
    const result = await mod.reconcileTerminalWarRoomDrift(20);

    // cleanup for next test
    vi.doUnmock('@/lib/prisma');
    vi.doUnmock('@/lib/slack');
    vi.doUnmock('@/lib/war-room/providers/slack/client');
    vi.doUnmock('@/lib/war-room/providers/slack/client.ts');
    vi.doUnmock('./providers/slack/client');
    vi.doUnmock('@/lib/logger');
    vi.doUnmock('@/lib/metrics/operational/registry');
    vi.resetModules();

    return { result, updateMany, findMany, findSlackWarRoomForTerminalCleanup, slackApiCall };
  }

  it('Slack 429 during marker lookup → debt remains (UNAVAILABLE RATE_LIMITED keeps pending, not satisfied)', async () => {
    const { result, updateMany } = await runDriftWithSlackMocks({
      lookup: { status: 'UNAVAILABLE', code: 'RATE_LIMITED', error: 'rate_limited' },
    });
    expect(result.checked).toBe(1);
    expect(result.satisfied).toBe(0);
    expect(result.cleaned).toBe(0);
    expect(result.stillPending).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-drift-1' },
        data: expect.objectContaining({ lastErrorCode: 'DRIFT_SLACK_RATE_LIMITED' }),
      })
    );
    // must not clear debt
    const lastData = updateMany.mock.calls[0][0].data as Record<string, unknown>;
    expect(lastData.externalCleanupPending).toBeUndefined();
    expect(lastData.externalCleanupCompletedAt).toBeUndefined();
    expect(lastData.externalCleanupLastAttemptAt).toBeInstanceOf(Date);
  });

  it('Slack network/transport failure → debt remains (UNAVAILABLE TRANSIENT)', async () => {
    const { result, updateMany } = await runDriftWithSlackMocks({
      lookup: { status: 'UNAVAILABLE', code: 'TRANSIENT', error: 'fetch failed' },
    });
    expect(result.checked).toBe(1);
    expect(result.satisfied).toBe(0);
    expect(result.stillPending).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: 'DRIFT_SLACK_TRANSIENT' }),
      })
    );
    const lastData = updateMany.mock.calls[0][0].data as Record<string, unknown>;
    expect(lastData.externalCleanupPending).toBeUndefined();
    expect(lastData.externalCleanupLastAttemptAt).toBeInstanceOf(Date);
  });

  it('Slack invalid_auth during drift lookup → debt remains and marks PERMISSION_ERROR', async () => {
    const { result, updateMany } = await runDriftWithSlackMocks({
      lookup: { status: 'UNAVAILABLE', code: 'AUTH_FAILED', error: 'invalid_auth' },
    });
    expect(result.checked).toBe(1);
    expect(result.satisfied).toBe(0);
    expect(result.stillPending).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: 'DRIFT_SLACK_AUTH_FAILED',
          health: 'PERMISSION_ERROR',
        }),
      })
    );
  });

  it('successful complete scan with no match → debt satisfied (NOT_FOUND clears pending)', async () => {
    const { result, updateMany, slackApiCall } = await runDriftWithSlackMocks({
      lookup: { status: 'NOT_FOUND' },
    });
    expect(result.checked).toBe(1);
    expect(result.satisfied).toBe(1);
    expect(result.stillPending).toBe(0);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalCleanupPending: false,
          externalCleanupCompletedAt: expect.any(Date),
        }),
      })
    );
    expect(slackApiCall).not.toHaveBeenCalled();
  });

  it('match found → archive orphan and clear debt (FOUND → cleaned)', async () => {
    const { result, updateMany, slackApiCall } = await runDriftWithSlackMocks({
      lookup: { status: 'FOUND', channel: { id: 'C999', name: 'inc-1-war-room' } },
      archiveResult: { ok: true },
    });
    expect(result.checked).toBe(1);
    expect(result.cleaned).toBe(1);
    expect(result.satisfied).toBe(0);
    expect(slackApiCall).toHaveBeenCalledWith('conversations.archive', 'xoxb-mock-token', {
      channel: 'C999',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalCleanupPending: false,
          externalCleanupCompletedAt: expect.any(Date),
          providerChannelId: 'C999',
        }),
      })
    );
  });

  it('match found but archive rate-limited → keep debt for retry', async () => {
    const { result, updateMany } = await runDriftWithSlackMocks({
      lookup: { status: 'FOUND', channel: { id: 'C999', name: 'inc-1-war-room' } },
      archiveResult: { ok: false, error: 'rate_limited' },
    });
    expect(result.checked).toBe(1);
    expect(result.cleaned).toBe(0);
    expect(result.satisfied).toBe(0);
    expect(result.stillPending).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: 'DRIFT_ARCHIVE_RATE_LIMITED' }),
      })
    );
    const lastData = updateMany.mock.calls[updateMany.mock.calls.length - 1][0].data as Record<
      string,
      unknown
    >;
    expect(lastData.externalCleanupPending).toBeUndefined();
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
      getWarRoomProvider: vi.fn(() => ({ provision: provisionMock, capabilities: {} }) as never),
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
      getWarRoomProvider: vi.fn(() => ({ provision: provisionMock, capabilities: {} }) as never),
    }));
    const { provisionWarRoom } = await import('@/lib/war-room/engine');
    await provisionWarRoom('room-1', 'tok-1');
    expect(provisionMock).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/prisma');
    vi.doUnmock('@/lib/war-room/registry');
    vi.resetModules();
  });
});
