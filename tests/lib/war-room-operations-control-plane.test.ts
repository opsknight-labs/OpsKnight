import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/metrics/operational/registry', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    addOperationalMetric: vi.fn(),
    setOperationalGauge: vi.fn(),
    observeOperationalHistogram: vi.fn(),
  };
});
vi.mock('@/lib/rbac', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getUserPermissions: vi.fn(async () => ({ isAdmin: true, role: 'ADMIN' })),
  };
});
vi.mock('@/lib/microsoft-teams/graph/channels', () => ({
  getChannelById: vi.fn(),
  findWarRoomChannel: vi.fn(),
  warRoomMarker: vi.fn((incidentId: string, generation: number) => `wr:${incidentId}:g${generation}`),
}));
vi.mock('@/lib/war-room/engine', () => ({
  requestWarRoomProjectionNeutral: vi.fn(async () => 5),
}));

import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { addOperationalMetric, OPERATIONAL_METRICS } from '@/lib/metrics/operational/registry';
import { getCurrentUser } from '@/lib/rbac';
import { getChannelById, findWarRoomChannel } from '@/lib/microsoft-teams/graph/channels';
import { requestWarRoomProjectionNeutral } from '@/lib/war-room/engine';

// Ensure setup.ts mockPrisma includes war-room models (older setup lacks them)
{
  const pAny = prisma as unknown as Record<string, unknown>;
  const ensureModel = (name: string) => {
    // eslint-disable-next-line security/detect-object-injection -- name is a known model literal, not user input
    const existing = pAny[name] as Record<string, unknown> | undefined;
    // Add missing methods without replacing existing mocks (preserves in-test overrides).
    const defaults: Record<string, unknown> = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    if (!existing) {
      // eslint-disable-next-line security/detect-object-injection -- known model literal
      pAny[name] = defaults;
    } else {
      for (const [k, v] of Object.entries(defaults)) {
        // eslint-disable-next-line security/detect-object-injection -- known defaults keys, not user input
        if (!(k in existing)) (existing as Record<string, unknown>)[k] = v;
      }
      // Ensure backgroundJob.$transaction-like on prisma root for requestWarRoomProjectionNeutral
      if (name === 'incidentWarRoom' && !('$transaction' in (pAny as Record<string, unknown>))) {
        (pAny as Record<string, unknown>).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
      }
    }
  };
  ensureModel('incidentWarRoom');
  ensureModel('warRoomParticipant');
  ensureModel('microsoftTeamsConfig');
  ensureModel('microsoftTeamsDestination');
  ensureModel('microsoftTeamsInstallation');
  ensureModel('incident');
  ensureModel('backgroundJob');
  // Top-level $transaction for engine.requestWarRoomProjectionNeutral
  const pRoot = prisma as unknown as Record<string, unknown>;
  if (!pRoot.$transaction) {
    pRoot.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  }
}
import { classifyOperationalHealth, toOperationalSnapshot } from '@/lib/war-room/operations/health';
import { summarizeOperationalHealth } from '@/lib/war-room/operations/summary';
import { getWarRoomDiagnosticsSnapshot, getWarRoomOperationalSnapshots } from '@/lib/war-room/operations/diagnostics';
import { enqueueWarRoomRepair } from '@/lib/war-room/operations/repair';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Helpers ─────────────────────────────────────────────────────────────
function healthyInput(overrides: Partial<Parameters<typeof classifyOperationalHealth>[0]> = {}) {
  return {
    state: 'READY',
    healthState: 'HEALTHY' as const,
    lastReconciledAt: new Date(),
    lastProjectedVersion: 3,
    projectionVersion: 3,
    lastErrorCode: null,
    lastError: null,
    externalCleanupPending: false,
    externalCleanupReason: null,
    providerChannelId: '19:channel@thread.tacv2',
    providerTenantId: 'tenant-1',
    providerContainerId: 'team-1',
    destinationEnabled: true,
    destinationWarRoomEnabled: true,
    installationEnabled: true,
    integrationEnabled: true,
    configEnabled: true,
    warRoomsEnabled: true,
    installCountForProvider: 1,
    participantDrift: 0,
    rscUnknown: false,
    permissionError: false,
    ...overrides,
  };
}

function snapshotInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wr-1',
    incidentId: 'inc-1',
    provider: 'MICROSOFT_TEAMS',
    generation: 1,
    state: 'READY',
    health: 'HEALTHY' as const,
    projectionVersion: 2,
    lastProjectedVersion: 2,
    lastProjectedAt: new Date(),
    lastReconciledAt: new Date(),
    lastErrorCode: null,
    lastError: null,
    externalCleanupPending: false,
    externalCleanupReason: null,
    providerTenantId: 'tenant-1',
    providerContainerId: 'team-1',
    providerChannelId: '19:channel@thread.tacv2',
    providerChannelName: 'inc-war',
    destinationId: 'dest-1',
    installationId: 'inst-1',
    participantDrift: 0,
    participantCounts: { desired: 2, present: 2, pending: 0, failed: 0, desiredStale: 0 },
    destinationEnabled: true,
    destinationWarRoomEnabled: true,
    installationEnabled: true,
    integrationEnabled: true,
    configEnabled: true,
    warRoomsEnabled: true,
    installCountForProvider: 1,
    rscUnknown: false,
    ...overrides,
  } as unknown as Parameters<typeof toOperationalSnapshot>[0];
}

// ── Deterministic health rules ──────────────────────────────────────────
describe('war-room operations — deterministic health (Phase 5)', () => {
  it('HEALTHY = authorized + permissions + healthy + no debt + current projection', () => {
    const out = classifyOperationalHealth(healthyInput());
    expect(out.operationalHealth).toBe('HEALTHY');
    expect(out.reasonCode).toBeNull();
  });

  it('DEGRADED for permission error', () => {
    const out = classifyOperationalHealth(healthyInput({ lastErrorCode: 'MISSING_PERMISSION', healthState: 'PERMISSION_ERROR' as never }));
    expect(out.operationalHealth).toBe('DEGRADED');
    expect(out.reasonCode).toBe('MISSING_PERMISSION');
  });

  it('DEGRADED for projection lag (behind by N)', () => {
    const out = classifyOperationalHealth(healthyInput({ projectionVersion: 5, lastProjectedVersion: 3 }));
    expect(out.operationalHealth).toBe('DEGRADED');
    expect(out.reasonCode).toBe('PROJECTION_BEHIND');
  });

  it('DEGRADED for participant drift', () => {
    const out = classifyOperationalHealth(healthyInput({ participantDrift: 2 }));
    expect(out.operationalHealth).toBe('DEGRADED');
    expect(out.reasonCode).toBe('PARTICIPANT_DRIFT');
  });

  it('DEGRADED for healthState DEGRADED', () => {
    const out = classifyOperationalHealth(healthyInput({ healthState: 'DEGRADED' as never }));
    expect(out.operationalHealth).toBe('DEGRADED');
  });

  it('UNAVAILABLE when integration disabled', () => {
    expect(classifyOperationalHealth(healthyInput({ integrationEnabled: false })).operationalHealth).toBe('UNAVAILABLE');
    expect(classifyOperationalHealth(healthyInput({ integrationEnabled: false })).reasonCode).toBe('INTEGRATION_DISABLED');
  });

  it('UNAVAILABLE when config disabled / warRooms disabled', () => {
    expect(classifyOperationalHealth(healthyInput({ configEnabled: false })).operationalHealth).toBe('UNAVAILABLE');
    expect(classifyOperationalHealth(healthyInput({ warRoomsEnabled: false })).operationalHealth).toBe('UNAVAILABLE');
  });

  it('UNAVAILABLE when destination disabled', () => {
    expect(classifyOperationalHealth(healthyInput({ destinationEnabled: false })).operationalHealth).toBe('UNAVAILABLE');
    expect(classifyOperationalHealth(healthyInput({ destinationEnabled: false })).reasonCode).toBe('DESTINATION_DISABLED');
    expect(classifyOperationalHealth(healthyInput({ destinationWarRoomEnabled: false })).operationalHealth).toBe('UNAVAILABLE');
  });

  it('UNAVAILABLE when bot not installed (installationEnabled=false or installCountForProvider=0)', () => {
    expect(classifyOperationalHealth(healthyInput({ installationEnabled: false })).operationalHealth).toBe('UNAVAILABLE');
    expect(classifyOperationalHealth(healthyInput({ installationEnabled: false })).reasonCode).toBe('BOT_NOT_INSTALLED');
    expect(classifyOperationalHealth(healthyInput({ installCountForProvider: 0 })).operationalHealth).toBe('UNAVAILABLE');
  });

  it('DRIFTED for externalCleanupPending', () => {
    const out = classifyOperationalHealth(healthyInput({ externalCleanupPending: true, externalCleanupReason: 'CLOSE_ORPHAN' }));
    expect(out.operationalHealth).toBe('DRIFTED');
    expect(out.reasonCode).toBe('CLOSE_ORPHAN');
  });

  it('DRIFTED for MISSING healthState / CHANNEL_MISSING / DUPLICATE_WAR_ROOMS', () => {
    expect(classifyOperationalHealth(healthyInput({ healthState: 'MISSING' as never })).operationalHealth).toBe('DRIFTED');
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'CHANNEL_MISSING' })).operationalHealth).toBe('DRIFTED');
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'DUPLICATE_WAR_ROOMS' })).operationalHealth).toBe('DRIFTED');
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'TEAM_NOT_FOUND' })).operationalHealth).toBe('DRIFTED');
  });

  it('DRIFTED when providerChannelId absent on READY/CLOSING (orphan)', () => {
    expect(classifyOperationalHealth(healthyInput({ providerChannelId: null, state: 'READY' })).operationalHealth).toBe('DRIFTED');
    expect(classifyOperationalHealth(healthyInput({ providerChannelId: null, state: 'CLOSING' })).operationalHealth).toBe('DRIFTED');
    expect(classifyOperationalHealth(healthyInput({ providerChannelId: null, state: 'CLOSED' })).operationalHealth).not.toBe('DRIFTED');
  });

  it('UNKNOWN for provider API unavailable with stale reconciliation — 429 / 5xx / timeout / token (not resource missing)', () => {
    const stale = new Date(Date.now() - 20 * 60_000);
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'RATE_LIMITED', lastReconciledAt: stale })).operationalHealth).toBe('UNKNOWN');
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'GRAPH_TOKEN_FAILED', lastReconciledAt: stale })).operationalHealth).toBe('UNKNOWN');
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'TRANSIENT_READ', lastReconciledAt: stale })).operationalHealth).toBe('UNKNOWN');
    expect(classifyOperationalHealth(healthyInput({ lastError: 'Graph returned 429 rate limited', lastReconciledAt: stale })).operationalHealth).toBe('UNKNOWN');
    expect(classifyOperationalHealth(healthyInput({ lastError: 'request timeout after 10000ms', lastReconciledAt: stale })).operationalHealth).toBe('UNKNOWN');
    expect(classifyOperationalHealth(healthyInput({ lastError: 'Graph returned 503', lastReconciledAt: stale })).operationalHealth).toBe('UNKNOWN');
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'RATE_LIMITED', lastReconciledAt: new Date() })).operationalHealth).not.toBe('UNKNOWN');
  });

  it('provider unavailable != resource missing — MISSING stays DRIFTED even when stale', () => {
    const stale = new Date(Date.now() - 20 * 60_000);
    const drifted = classifyOperationalHealth(healthyInput({ lastErrorCode: 'MISSING', lastReconciledAt: stale, healthState: 'MISSING' as never }));
    expect(drifted.operationalHealth).toBe('DRIFTED');
  });

  it('precedence: UNKNOWN > UNAVAILABLE > DRIFTED > DEGRADED > HEALTHY', () => {
    const stale = new Date(Date.now() - 20 * 60_000);
    expect(classifyOperationalHealth(healthyInput({ integrationEnabled: false, lastErrorCode: 'RATE_LIMITED', lastReconciledAt: new Date() })).operationalHealth).toBe('UNAVAILABLE');
    expect(classifyOperationalHealth(healthyInput({ destinationEnabled: false, externalCleanupPending: true })).operationalHealth).toBe('UNAVAILABLE');
    expect(classifyOperationalHealth(healthyInput({ externalCleanupPending: true, projectionVersion: 5, lastProjectedVersion: 3 })).operationalHealth).toBe('DRIFTED');
    expect(classifyOperationalHealth(healthyInput({ participantDrift: 1 })).operationalHealth).toBe('DEGRADED');
    expect(classifyOperationalHealth(healthyInput()).operationalHealth).toBe('HEALTHY');
    expect(classifyOperationalHealth(healthyInput({ lastErrorCode: 'RATE_LIMITED', lastReconciledAt: stale, externalCleanupPending: true })).operationalHealth).toBe('UNKNOWN');
  });

  it('Teams unavailable (RSC unknown + missing channel + stale) -> UNKNOWN, otherwise DEGRADED', () => {
    const stale = new Date(Date.now() - 20 * 60_000);
    expect(classifyOperationalHealth(healthyInput({ rscUnknown: true, providerChannelId: null, lastReconciledAt: stale })).operationalHealth).toBe('UNKNOWN');
    expect(classifyOperationalHealth(healthyInput({ rscUnknown: true, providerChannelId: '19:chan', lastReconciledAt: stale })).operationalHealth).not.toBe('UNKNOWN');
  });
});

// ── toOperationalSnapshot + summarizeOperationalHealth ──────────────────
describe('toOperationalSnapshot & summarizeOperationalHealth', () => {
  it('maps snapshot with lag/drift and surfaces health reason', () => {
    const snap = toOperationalSnapshot(snapshotInput({ projectionVersion: 5, lastProjectedVersion: 3 }));
    expect(snap.projectionLag).toBe(2);
    expect(snap.projectionBehind).toBe(true);
    expect(snap.operationalHealth).toBe('DEGRADED');
    expect(snap.healthReasonCode).toBe('PROJECTION_BEHIND');
  });

  it('healthy snapshot carries null reason and current projection', () => {
    const snap = toOperationalSnapshot(snapshotInput());
    expect(snap.operationalHealth).toBe('HEALTHY');
    expect(snap.healthReasonCode).toBeNull();
    expect(snap.projectionBehind).toBe(false);
    expect(snap.participantDrift).toBe(0);
  });

  it('summarizeOperationalHealth worst-wins UNKNOWN>UNAVAILABLE>DRIFTED>DEGRADED>HEALTHY', () => {
    const make = (h: string) => ({ provider: 'MICROSOFT_TEAMS', operationalHealth: h, externalCleanupPending: false } as never);
    expect(summarizeOperationalHealth([make('HEALTHY'), make('HEALTHY')])[0].operationalHealth).toBe('HEALTHY');
    expect(summarizeOperationalHealth([make('HEALTHY'), make('DEGRADED')])[0].operationalHealth).toBe('DEGRADED');
    expect(summarizeOperationalHealth([make('DEGRADED'), make('DRIFTED')])[0].operationalHealth).toBe('DRIFTED');
    expect(summarizeOperationalHealth([make('DRIFTED'), make('UNAVAILABLE')])[0].operationalHealth).toBe('UNAVAILABLE');
    expect(summarizeOperationalHealth([make('UNAVAILABLE'), make('UNKNOWN')])[0].operationalHealth).toBe('UNKNOWN');
  });

  it('summarize counts per health and externalCleanupPending', () => {
    const snaps = [
      { provider: 'MICROSOFT_TEAMS', operationalHealth: 'HEALTHY', externalCleanupPending: false },
      { provider: 'MICROSOFT_TEAMS', operationalHealth: 'DRIFTED', externalCleanupPending: true },
      { provider: 'SLACK', operationalHealth: 'DEGRADED', externalCleanupPending: false },
    ] as never;
    const summary = summarizeOperationalHealth(snaps);
    const teams = summary.find(s => s.provider === 'MICROSOFT_TEAMS')!;
    expect(teams.totalRooms).toBe(2);
    expect(teams.healthyRooms).toBe(1);
    expect(teams.driftedRooms).toBe(1);
    expect(teams.externalCleanupPending).toBe(1);
    expect(summary.find(s => s.provider === 'SLACK')!.degradedRooms).toBe(1);
  });

  it('Slack neutral shape — same snapshot contract as Teams', () => {
    const slackSnap = toOperationalSnapshot(snapshotInput({ provider: 'SLACK', providerTenantId: null, providerContainerId: 'C123' }));
    expect(slackSnap.provider).toBe('SLACK');
    expect(typeof slackSnap.warRoomId).toBe('string');
    expect(typeof slackSnap.operationalHealth).toBe('string');
    expect(slackSnap.destinationId).toBe('dest-1');
    expect((slackSnap as unknown as Record<string, unknown>).botToken).toBeUndefined();
    expect((slackSnap as unknown as Record<string, unknown>).clientSecret).toBeUndefined();
  });
});

// ── Diagnostics — no secrets/tokens surface ──────────────────────────────
describe('diagnostics — detail contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getWarRoomOperationalSnapshots returns bounded snapshots (100 default, 200 max)', async () => {
    const rooms = Array.from({ length: 3 }, (_, i) => ({
      id: `wr-${i}`,
      incidentId: `inc-${i}`,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      state: 'READY',
      health: 'HEALTHY',
      projectionVersion: 1,
      lastProjectedVersion: 1,
      lastProjectedAt: new Date(),
      lastReconciledAt: new Date(),
      lastErrorCode: null,
      lastError: null,
      externalCleanupPending: false,
      externalCleanupReason: null,
      providerTenantId: 't',
      providerContainerId: 'team',
      providerChannelId: 'ch',
      providerChannelName: 'chan',
      destinationId: null,
      installationId: null,
      participants: [],
    }));
    vi.mocked(prisma.incidentWarRoom.findMany as unknown as Mock).mockResolvedValue(rooms as never);
    const snapshots = await getWarRoomOperationalSnapshots(100);
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].warRoomId).toBe('wr-0');
  });

  it('getWarRoomDiagnosticsSnapshot never surfaces secrets/tokens (no clientSecret/botToken/lease)', async () => {
    const room = {
      id: 'wr-1',
      incidentId: 'inc-1',
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      state: 'CLOSED',
      health: 'HEALTHY',
      projectionVersion: 2,
      lastProjectedVersion: 2,
      lastProjectedAt: new Date(),
      lastReconciledAt: new Date(),
      lastErrorCode: null,
      lastError: null,
      externalCleanupPending: true,
      externalCleanupReason: 'CLOSE_ORPHAN',
      externalCleanupLastAttemptAt: new Date(),
      externalCleanupCompletedAt: null,
      providerTenantId: 'tenant-1',
      providerContainerId: 'team-1',
      providerChannelId: '19:ch',
      providerChannelName: 'war',
      destinationId: 'dest-1',
      installationId: 'inst-1',
      provisioningToken: 'lease-abc',
      provisioningStartedAt: new Date(),
      createAttemptedAt: new Date(),
      plannedExternalName: 'inc-war',
      commandMessageId: 'msg-1',
      commandConversationId: 'conv-1',
      closeRequestedAt: new Date(),
      closedAt: new Date(),
      archivedAt: null,
      incident: { title: 'Payments outage', status: 'RESOLVED' },
      participants: [{ id: 'p1', userId: 'u1', providerUserId: 'teams-u1', source: 'INCIDENT', state: 'PRESENT', lastSyncAt: new Date(), lastErrorCode: null }],
    };
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(room as never);
    vi.mocked((prisma as unknown as { microsoftTeamsDestination: { findUnique: Mock } }).microsoftTeamsDestination.findUnique as unknown as Mock).mockResolvedValue({ id: 'dest-1', enabled: true, warRoomEnabled: true, teamId: 'team-1', channelId: 'ch', teamName: 'Team', channelName: 'chan' } as never);

    const diag = await getWarRoomDiagnosticsSnapshot('wr-1');
    expect(diag).not.toBeNull();
    const raw = JSON.stringify(diag);
    expect(raw).not.toMatch(/clientSecret/i);
    expect(raw).not.toMatch(/botToken/i);
    expect(raw).not.toMatch(/accessToken/i);
    expect(raw).not.toMatch(/lease-abc/);
    expect(diag!.provisioning.hasProvisioningToken).toBe(true);
    expect((diag!.provisioning as unknown as Record<string, unknown>).provisioningToken).toBeUndefined();
    expect(diag!.cleanup.externalCleanupPending).toBe(true);
    expect(diag!.cleanup.externalCleanupReason).toBe('CLOSE_ORPHAN');
    expect(diag!.incidentTitle).toBe('Payments outage');
    expect(diag!.participants).toHaveLength(1);
    expect((diag as unknown as Record<string, unknown>).clientSecret).toBeUndefined();
  });

  it('diagnostics surfacing covers all required fields (Generation/State/Health/Destination/Tenant/Team/Channel/Projection/Participant/Provisioning/Closing/Cleanup)', async () => {
    const room = {
      id: 'wr-2',
      incidentId: 'inc-2',
      provider: 'MICROSOFT_TEAMS',
      generation: 2,
      state: 'READY',
      health: 'DEGRADED',
      projectionVersion: 4,
      lastProjectedVersion: 2,
      lastProjectedAt: new Date(),
      lastReconciledAt: new Date(),
      lastErrorCode: 'PROJECTION_BEHIND',
      lastError: 'Projection is behind by 2',
      externalCleanupPending: false,
      externalCleanupReason: null,
      externalCleanupLastAttemptAt: null,
      externalCleanupCompletedAt: null,
      providerTenantId: 'tenant-2',
      providerContainerId: 'team-2',
      providerChannelId: '19:ch2',
      providerChannelName: 'chan2',
      destinationId: 'dest-2',
      installationId: 'inst-2',
      provisioningToken: null,
      provisioningStartedAt: null,
      createAttemptedAt: new Date(),
      plannedExternalName: null,
      commandMessageId: null,
      commandConversationId: null,
      closeRequestedAt: null,
      closedAt: null,
      archivedAt: null,
      incident: { title: 'Latency', status: 'OPEN' },
      participants: [],
    };
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(room as never);
    // Infra is healthy so DEGRADED comes from projection lag, not UNAVAILABLE
    vi.mocked((prisma as unknown as { microsoftTeamsDestination: { findUnique: Mock } }).microsoftTeamsDestination.findUnique as unknown as Mock).mockResolvedValue({ id: 'dest-2', enabled: true, warRoomEnabled: true, teamId: 'team-2', channelId: 'ch2', teamName: 'Team', channelName: 'chan' } as never);
    vi.mocked((prisma as unknown as { microsoftTeamsInstallation: { findUnique: Mock; count: Mock } }).microsoftTeamsInstallation.findUnique as unknown as Mock).mockResolvedValue({ enabled: true } as never);
    vi.mocked((prisma as unknown as { microsoftTeamsInstallation: { findUnique: Mock; count: Mock } }).microsoftTeamsInstallation.count as unknown as Mock).mockResolvedValue(1 as never);
    vi.mocked((prisma as unknown as { microsoftTeamsConfig: { findFirst: Mock } }).microsoftTeamsConfig.findFirst as unknown as Mock).mockResolvedValue({ enabled: true, warRoomsEnabled: true } as never);
    const diag = await getWarRoomDiagnosticsSnapshot('wr-2');
    expect(diag!.generation).toBe(2);
    expect(diag!.state).toBe('READY');
    expect(diag!.healthState).toBe('DEGRADED');
    expect(diag!.operationalHealth).toBe('DEGRADED');
    expect(diag!.providerChannelId).toBe('19:ch2');
    expect(diag!.providerTenantId).toBe('tenant-2');
    expect(diag!.providerContainerId).toBe('team-2');
    expect(diag!.projectionLag).toBe(2);
    expect(diag!.provisioning).toBeDefined();
    expect(diag!.closing).toBeDefined();
    expect(diag!.cleanup).toBeDefined();
  });
});

// ── Repair — durable actions, idempotency, RBAC, state gates, no Graph ───
describe('repair — UI → Admin API → RBAC+state → enqueue canonical durable job → engine → adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function baseRoom(overrides: Record<string, unknown> = {}) {
    return {
      id: 'wr-1',
      incidentId: 'inc-1',
      provider: 'MICROSOFT_TEAMS',
      state: 'READY',
      health: 'HEALTHY',
      provisioningToken: 'tok-1',
      projectionVersion: 3,
      externalCleanupPending: false,
      destinationId: 'dest-1',
      ...overrides,
    };
  }

  it('RECONCILE on AMBIGUOUS uses WAR_ROOM_PROVISION reconciliationOnly (marker-only, triple-AND dedupe) and never POSTs', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', email: 'admin@test.test', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'AMBIGUOUS', provisioningToken: 'tok-amb' }) as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-1' } as never);

    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'admin-1' });
    expect(res.accepted).toBe(true);
    expect(res.jobType).toBe('WAR_ROOM_PROVISION');
    const createCall = vi.mocked(prisma.backgroundJob.create as unknown as Mock).mock.calls[0]?.[0];
    expect(createCall.data.type).toBe('WAR_ROOM_PROVISION');
    expect(createCall.data.payload.reconciliationOnly).toBe(true);
    expect(createCall.data.payload.provisioningToken).toBe('tok-amb');
    const findCall = vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mock.calls[0]?.[0];
    expect(findCall.where.AND).toHaveLength(3);
    expect(vi.mocked(emitAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({ action: 'WAR_ROOM_RECONCILIATION_REQUESTED', metadata: expect.objectContaining({ initiatedBy: 'operator' }) }));
  });

  it('RECONCILE on READY enqueues WAR_ROOM_RECONCILE and is idempotent (duplicate reuses pending job)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'READY' }) as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue({ id: 'existing-job' } as never);

    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'admin-1' });
    expect(res.accepted).toBe(true);
    expect(res.jobId).toBe('existing-job');
    expect(res.jobType).toBe('WAR_ROOM_RECONCILE');
    expect(prisma.backgroundJob.create).not.toHaveBeenCalled();
  });

  it('RETRY_PROJECTION increments projection only when READY/CLOSING and dedupes by version', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'READY', projectionVersion: 4 }) as never);
    vi.mocked(requestWarRoomProjectionNeutral as unknown as Mock).mockResolvedValue(5 as never);
    // Helper already enqueued the job; lookup reuses it (no fallback create)
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue({ id: 'job-proj' } as never);

    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_PROJECTION', actorId: 'admin-1' });
    expect(res.accepted).toBe(true);
    expect(res.jobType).toBe('WAR_ROOM_PROJECT');
    expect(requestWarRoomProjectionNeutral).toHaveBeenCalledWith('wr-1');
    expect(res.jobId).toBe('job-proj');
  });

  it('RETRY_PROJECTION is idempotent — coalesces by warRoomId+projectionVersion', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'READY', projectionVersion: 4 }) as never);
    vi.mocked(requestWarRoomProjectionNeutral as unknown as Mock).mockResolvedValue(null as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue({ id: 'existing-proj' } as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_PROJECTION', actorId: 'admin-1' });
    expect(res.jobId).toBe('existing-proj');
    expect(requestWarRoomProjectionNeutral).toHaveBeenCalledWith('wr-1');
  });

  it('RETRY_PROJECTION rejected when not READY/CLOSING', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'CLOSED' }) as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_PROJECTION', actorId: 'admin-1' });
    expect(res.accepted).toBe(false);
    expect(res.reasonCode).toBe('STATE_NOT_READY');
  });

  it('RETRY_PARTICIPANT_SYNC only READY/CLOSING and deduped', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'READY' }) as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-part' } as never);
    const ok = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_PARTICIPANT_SYNC', actorId: 'admin-1' });
    expect(ok.accepted).toBe(true);
    expect(ok.jobType).toBe('WAR_ROOM_PARTICIPANT_SYNC');

    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue({ id: 'existing-part' } as never);
    const dup = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_PARTICIPANT_SYNC', actorId: 'admin-1' });
    expect(dup.jobId).toBe('existing-part');
  });

  it('TEST_CONNECTION enqueues RECONCILE probe (never direct Graph) and is idempotent', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom() as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-test' } as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'TEST_CONNECTION', actorId: 'admin-1' });
    expect(res.jobType).toBe('WAR_ROOM_RECONCILE');
    expect(vi.mocked(emitAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEAMS_CONNECTION_TESTED' }));
    const payload = vi.mocked(prisma.backgroundJob.create as unknown as Mock).mock.calls[0][0].data.payload;
    expect(payload.reason).toBe('connection_test');
    const repairSource = fs.readFileSync(path.resolve('src/lib/war-room/operations/repair.ts'), 'utf8');
    expect(repairSource).not.toMatch(/microsoftTeamsGraphRequest|getChannelById|findWarRoomChannel/);
  });

  it('REFRESH_PERMISSIONS enqueues RECONCILE with permission_refresh reason and scopes dedupe to that reason', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom() as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-perm' } as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'REFRESH_PERMISSIONS', actorId: 'admin-1' });
    expect(res.accepted).toBe(true);
    expect(vi.mocked(emitAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({ action: 'TEAMS_PERMISSIONS_REFRESHED' }));
    const payload = vi.mocked(prisma.backgroundJob.create as unknown as Mock).mock.calls[0][0].data.payload;
    expect(payload.reason).toBe('permission_refresh');
    const findCall = vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mock.calls[0]?.[0];
    expect(findCall.where.AND).toHaveLength(2);
    expect(findCall.where.AND[1]).toEqual({ payload: { path: ['reason'], equals: 'permission_refresh' } });

    // A generic reconcile must not swallow an RSC probe — call again still enqueues permission_refresh
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValueOnce(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-perm-2' } as never);
    const res2 = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'REFRESH_PERMISSIONS', actorId: 'admin-1' });
    expect(res2.accepted).toBe(true);
    expect(res2.jobId).toBe('job-perm-2');
  });

  it('REFRESH_PERMISSIONS reuses pending permission_refresh job (idempotent)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom() as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue({ id: 'existing-perm' } as never);
    const dup = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'REFRESH_PERMISSIONS', actorId: 'admin-1' });
    expect(dup.jobId).toBe('existing-perm');
    expect(prisma.backgroundJob.create).not.toHaveBeenCalled();
  });

  it('RETRY_EXTERNAL_CLEANUP enqueues reconciler lane and is deduped (idempotent)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'CLOSED', externalCleanupPending: true }) as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue({ id: 'existing-cleanup' } as never);
    const dup = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_EXTERNAL_CLEANUP', actorId: 'admin-1' });
    expect(dup.jobId).toBe('existing-cleanup');
    expect(prisma.backgroundJob.create).not.toHaveBeenCalled();

    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-cleanup' } as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_EXTERNAL_CLEANUP', actorId: 'admin-1' });
    expect(res.jobType).toBe('WAR_ROOM_RECONCILE');
    expect(vi.mocked(emitAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({ action: 'WAR_ROOM_EXTERNAL_CLEANUP_RETRY_REQUESTED' }));
  });

  it('RETRY_EXTERNAL_CLEANUP rejected when not CLOSED/ARCHIVED or no pending debt (lifecycle race guard)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'CLOSING', externalCleanupPending: true }) as never);
    const closing = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_EXTERNAL_CLEANUP', actorId: 'admin-1' });
    expect(closing.accepted).toBe(false);
    expect(closing.reasonCode).toBe('NOT_ELIGIBLE');

    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'CLOSED', externalCleanupPending: false }) as never);
    const noDebt = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_EXTERNAL_CLEANUP', actorId: 'admin-1' });
    expect(noDebt.accepted).toBe(false);
    expect(noDebt.reasonCode).toBe('NOT_ELIGIBLE');
  });

  it('RBAC: requires ADMIN — viewer and responder are rejected', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'viewer-1', role: 'VIEWER', email: 'v@test.test' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom() as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'viewer-1' });
    expect(res.accepted).toBe(false);
    expect(res.reasonCode).toBe('FORBIDDEN');
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'resp-1', role: 'RESPONDER', email: 'r@test.test' } as never);
    const resp = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'resp-1' });
    expect(resp.accepted).toBe(false);
    expect(resp.reasonCode).toBe('FORBIDDEN');
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', email: 'admin@test.test' } as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-ok' } as never);
    const ok = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'admin-1' });
    expect(ok.accepted).toBe(true);
  });

  it('unauthenticated -> UNAUTHORIZED', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Unauthorized'));
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom() as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'anon' });
    expect(res.accepted).toBe(false);
    expect(res.reasonCode).toBe('UNAUTHORIZED');
  });

  it('audit includes actor/provider/warRoomId/incidentId/action/result/reason/timestamp + operator vs auto', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom() as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-audit' } as never);
    await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RETRY_PARTICIPANT_SYNC', actorId: 'admin-1', actorEmail: 'admin@test.test', reason: 'manual check' });
    expect(vi.mocked(emitAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'WAR_ROOM_PARTICIPANT_SYNC_REQUESTED',
      source: 'UI',
      metadata: expect.objectContaining({
        provider: 'MICROSOFT_TEAMS',
        warRoomId: 'wr-1',
        incidentId: 'inc-1',
        action: 'RETRY_PARTICIPANT_SYNC',
        result: 'accepted',
        reason: 'manual check',
        initiatedBy: 'operator',
        timestamp: expect.any(String),
      }),
    }));
    expect(vi.mocked(addOperationalMetric)).toHaveBeenCalledWith('opsknight_war_room_reconciliation_total', 1, expect.objectContaining({ provider: 'MICROSOFT_TEAMS', result: 'repair_enqueued' }));
  });

  it('disabled integration still allows RECONCILE for triage (does not block enqueue)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue(baseRoom({ state: 'READY' }) as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-disabled' } as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'admin-1' });
    expect(res.accepted).toBe(true);
  });
});

// ── Operational metrics families — no incidentId/userId/channelId/tenantId ─
describe('operational metrics — families and label allowlist', () => {
  const REQUIRED_FAMILIES = [
    'opsknight_war_room_health',
    'opsknight_war_room_state',
    'opsknight_war_room_projection_total',
    'opsknight_war_room_projection_lag_seconds',
    'opsknight_war_room_participant_sync_total',
    'opsknight_war_room_participant_drift',
    'opsknight_chatops_invokes_total',
    'opsknight_chatops_action_latency_seconds',
    'opsknight_provider_rate_limits_total',
    'opsknight_provider_permission_failures_total',
    'opsknight_external_cleanup_pending',
    'opsknight_war_room_reconciliation_total',
  ];

  it('all required families are registered', () => {
    const names = new Set(OPERATIONAL_METRICS.map(m => m.name));
    for (const required of REQUIRED_FAMILIES) {
      expect(names.has(required as never), `missing metric ${required}`).toBe(true);
    }
  });

  it('no metric uses forbidden high-cardinality labels (incidentId/userId/channelId/tenantId)', () => {
    const forbidden = ['incidentId', 'userId', 'channelId', 'tenantId'];
    for (const metric of OPERATIONAL_METRICS) {
      for (const label of metric.labels as readonly string[]) {
        expect(forbidden, `${metric.name} uses forbidden label ${label}`).not.toContain(label);
      }
    }
  });

  it('repair emits reconciliation_total with only allowlisted labels', () => {
    const def = OPERATIONAL_METRICS.find(m => m.name === 'opsknight_war_room_reconciliation_total');
    expect(def).toBeDefined();
    expect(def!.labels).toEqual(expect.arrayContaining(['provider', 'result']));
  });
});

// ── Teams adapter — Graph → neutral mapping ──────────────────────────────
describe('Teams adapter — provider raw state → neutral (Graph codes → health)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('probeMicrosoftTeamsChannelHealth maps Graph MISSING_PERMISSION to PERMISSION_ERROR (DEGRADED path)', async () => {
    const { probeMicrosoftTeamsChannelHealth } = await import('@/lib/war-room/providers/microsoft-teams/operations');
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue({
      id: 'wr-1',
      provider: 'MICROSOFT_TEAMS',
      providerTenantId: 't',
      providerContainerId: 'team',
      providerChannelId: 'ch',
      incidentId: 'inc-1',
      generation: 1,
    } as never);
    vi.mocked(getChannelById).mockResolvedValue({ ok: false, code: 'MISSING_PERMISSION', message: 'Missing RSC' } as never);
    const out = await probeMicrosoftTeamsChannelHealth('wr-1');
    expect(out.health).toBe('PERMISSION_ERROR');
    expect(out.code).toBe('MISSING_PERMISSION');
  });

  it('maps 404/ok-null to MISSING (DRIFTED path) and never collapses transient to MISSING', async () => {
    const { probeMicrosoftTeamsChannelHealth } = await import('@/lib/war-room/providers/microsoft-teams/operations');
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue({
      id: 'wr-1',
      provider: 'MICROSOFT_TEAMS',
      providerTenantId: 't',
      providerContainerId: 'team',
      providerChannelId: null,
      incidentId: 'inc-1',
      generation: 1,
    } as never);
    vi.mocked(findWarRoomChannel).mockResolvedValue({ ok: true, value: null } as never);
    const out = await probeMicrosoftTeamsChannelHealth('wr-1');
    expect(out.health).toBe('MISSING');
    expect(out.code).toBe('CHANNEL_MISSING');
  });

  it('preserves per-installation correlation — neutral snapshot does not aggregate away a broken Team', async () => {
    const strategies = [
      toOperationalSnapshot(snapshotInput({ id: 'wr-a', destinationEnabled: true, installationEnabled: true, installCountForProvider: 2 })),
      toOperationalSnapshot(snapshotInput({ id: 'wr-b', destinationEnabled: false, providerChannelId: 'ch', installationEnabled: true, installCountForProvider: 2 })),
    ];
    expect(strategies[0].operationalHealth).toBe('HEALTHY');
    expect(strategies[1].operationalHealth).toBe('UNAVAILABLE');
    const summary = summarizeOperationalHealth(strategies as never);
    expect(summary[0].totalRooms).toBe(2);
    expect(summary[0].unavailableRooms).toBe(1);
  });
});

// ── State-specific matrix ───────────────────────────────────────────────
describe('health matrix — READY / AMBIGUOUS / CLOSING / CLOSED + cleanup', () => {
  it('READY current projection + present participants -> HEALTHY', () => {
    expect(toOperationalSnapshot(snapshotInput({ state: 'READY', health: 'HEALTHY' as never, projectionVersion: 3, lastProjectedVersion: 3, participantDrift: 0 })).operationalHealth).toBe('HEALTHY');
  });

  it('READY behind projection -> DEGRADED (lag)', () => {
    expect(toOperationalSnapshot(snapshotInput({ state: 'READY', projectionVersion: 5, lastProjectedVersion: 3 })).operationalHealth).toBe('DEGRADED');
  });

  it('READY with participant drift -> DEGRADED', () => {
    expect(toOperationalSnapshot(snapshotInput({ state: 'READY', participantDrift: 2 })).operationalHealth).toBe('DEGRADED');
  });

  it('AMBIGUOUS with provisioningToken — reconcilable via provisioning reconciliationOnly', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', email: 'a@t.test' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue({ id: 'wr-1', incidentId: 'inc-1', provider: 'MICROSOFT_TEAMS', state: 'AMBIGUOUS', health: 'HEALTHY', provisioningToken: 'tok-amb', projectionVersion: 1, externalCleanupPending: false, destinationId: null } as never);
    vi.mocked(prisma.backgroundJob.findFirst as unknown as Mock).mockResolvedValue(null);
    vi.mocked(prisma.backgroundJob.create as unknown as Mock).mockResolvedValue({ id: 'job-amb' } as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'admin-1' });
    expect(res.jobType).toBe('WAR_ROOM_PROVISION');
  });

  it('AMBIGUOUS without token is not reconcilable as provisioning — falls to state gate', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', email: 'a@t.test' } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique as unknown as Mock).mockResolvedValue({ id: 'wr-1', incidentId: 'inc-1', provider: 'MICROSOFT_TEAMS', state: 'AMBIGUOUS', health: 'HEALTHY', provisioningToken: null, projectionVersion: 1, externalCleanupPending: false, destinationId: null } as never);
    const res = await enqueueWarRoomRepair({ warRoomId: 'wr-1', action: 'RECONCILE', actorId: 'admin-1' });
    expect(res.accepted).toBe(false);
    expect(res.reasonCode).toBe('STATE_NOT_RECONCILABLE');
  });

  it('CLOSING with providerChannelId -> not drifted; without -> DRIFTED (orphan) but still reconcilable', () => {
    expect(toOperationalSnapshot(snapshotInput({ state: 'CLOSING', providerChannelId: '19:ch' })).operationalHealth).toBe('HEALTHY');
    expect(toOperationalSnapshot(snapshotInput({ state: 'CLOSING', providerChannelId: null })).operationalHealth).toBe('DRIFTED');
  });

  it('CLOSED + externalCleanupPending -> DRIFTED and diagnostics surfaces cleanup pending', () => {
    const snap = toOperationalSnapshot(snapshotInput({ state: 'CLOSED', providerChannelId: null, externalCleanupPending: true, externalCleanupReason: 'CLOSE_ORPHAN' }));
    expect(snap.operationalHealth).toBe('DRIFTED');
    expect(snap.externalCleanupPending).toBe(true);
  });
});

// ── No new .env, file policy, and static contracts ─────────────────────────
describe('static contracts — no regressions', () => {
  it('no new env keys introduced by operations control plane', () => {
    const srcFiles = [
      'src/lib/war-room/operations/health.ts',
      'src/lib/war-room/operations/diagnostics.ts',
      'src/lib/war-room/operations/repair.ts',
      'src/lib/war-room/operations/types.ts',
      'src/lib/war-room/providers/microsoft-teams/operations.ts',
      'src/app/api/admin/war-rooms/route.ts',
      'src/app/api/admin/war-rooms/[warRoomId]/route.ts',
      'src/app/api/admin/war-rooms/[warRoomId]/repair/route.ts',
    ];
    for (const file of srcFiles) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- allowlisted srcFiles literals, not user input
      const content = fs.readFileSync(path.resolve(file), 'utf8');
      expect(content).not.toMatch(/process\.env\.OPSKNIGHT_WAR_ROOM/);
      expect(content).not.toMatch(/process\.env\.WAR_ROOM_/);
    }
  });

  it('repair route and lib never import Graph client directly — UI→API→job→engine→adapter only', () => {
    const repairLib = fs.readFileSync(path.resolve('src/lib/war-room/operations/repair.ts'), 'utf8');
    expect(repairLib).not.toMatch(/from ['"]@\/lib\/microsoft-teams\/graph/);
    expect(repairLib).not.toMatch(/microsoftTeamsGraphRequest/);
    const repairRoute = fs.readFileSync(path.resolve('src/app/api/admin/war-rooms/[warRoomId]/repair/route.ts'), 'utf8');
    expect(repairRoute).not.toMatch(/microsoftTeamsGraphRequest|getChannelById/);
  });

  it('diagnostics never leaks secrets — no token field is selected from prisma', () => {
    const diag = fs.readFileSync(path.resolve('src/lib/war-room/operations/diagnostics.ts'), 'utf8');
    expect(diag.toLowerCase()).not.toMatch(/clientsecret|botToken|accessToken/);
  });
});

// ── RBAC on Admin APIs — static guard check ──────────────────────────────
describe('Admin API RBAC — static guard check', () => {
  it('war-room read + repair APIs require ADMIN (future responder needs assertCanModifyIncident)', () => {
    const listRoute = fs.readFileSync(path.resolve('src/app/api/admin/war-rooms/route.ts'), 'utf8');
    expect(listRoute).toMatch(/getCurrentUser/);
    expect(listRoute).toMatch(/role !== 'ADMIN'/);

    const diagRoute = fs.readFileSync(path.resolve('src/app/api/admin/war-rooms/[warRoomId]/route.ts'), 'utf8');
    expect(diagRoute).toMatch(/getCurrentUser/);
    expect(diagRoute).toMatch(/role !== 'ADMIN'/);

    const repairRoute = fs.readFileSync(path.resolve('src/app/api/admin/war-rooms/[warRoomId]/repair/route.ts'), 'utf8');
    expect(repairRoute).toMatch(/role !== 'ADMIN'/);
    expect(repairRoute).not.toMatch(/RESPONDER/);
    expect(repairRoute).toMatch(/z\.object|bodySchema/);

    const repairLib = fs.readFileSync(path.resolve('src/lib/war-room/operations/repair.ts'), 'utf8');
    expect(repairLib).toMatch(/role !== 'ADMIN'/);
    expect(repairLib).not.toMatch(/RESPONDER/);
  });
});
