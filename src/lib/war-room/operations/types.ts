import type { WarRoomHealthState, WarRoomProvider, WarRoomState } from '@prisma/client';

// Provider-neutral operational health — deterministic classification
// HEALTHY requires: authorized + permissions + healthy + no debt + current projection.
// DEGRADED: recoverable permission/throughput or lag.
// UNAVAILABLE: integration disabled or bot not installed (no provider call possible).
// DRIFTED: external resource identity drift / missing / duplicate / externalCleanupPending.
// UNKNOWN: provider API unavailable — transport/5xx/429/timeout/token — not resource missing.
export type OperationalHealth = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'DRIFTED' | 'UNKNOWN';

export type WarRoomProviderName = WarRoomProvider;

export type WarRoomOperationalSnapshot = {
  warRoomId: string;
  incidentId: string;
  provider: WarRoomProviderName;
  generation: number;
  state: WarRoomState;
  healthState: WarRoomHealthState;
  operationalHealth: OperationalHealth;
  healthReasonCode: string | null;
  healthReasonMessage: string | null;
  projectionVersion: number;
  lastProjectedVersion: number;
  projectionLag: number;
  projectionBehind: boolean;
  participantDrift: number;
  participantCounts: {
    desired: number;
    present: number;
    pending: number;
    failed: number;
    desiredStale: number;
  };
  externalCleanupPending: boolean;
  externalCleanupReason: string | null;
  lastReconciledAt: string | null;
  lastProjectedAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  providerChannelId: string | null;
  providerChannelName: string | null;
  destinationId: string | null;
  installationId: string | null;
};

export type WarRoomDiagnosticsSnapshot = WarRoomOperationalSnapshot & {
  incidentTitle: string | null;
  incidentStatus: string | null;
  destination: {
    id: string | null;
    enabled: boolean | null;
    warRoomEnabled: boolean | null;
    teamId: string | null;
    channelId: string | null;
    teamName: string | null;
    channelName: string | null;
  } | null;
  provisioning: {
    provisioningToken: string | null;
    provisioningStartedAt: string | null;
    createAttemptedAt: string | null;
    plannedExternalName: string | null;
    commandMessageId: string | null;
    commandConversationId: string | null;
  };
  closing: {
    closeRequestedAt: string | null;
    closedAt: string | null;
    archivedAt: string | null;
  } | null;
  cleanup: {
    externalCleanupPending: boolean;
    externalCleanupReason: string | null;
    externalCleanupLastAttemptAt: string | null;
    externalCleanupCompletedAt: string | null;
  };
  participants: Array<{
    id: string;
    userId: string | null;
    providerUserId: string | null;
    source: string;
    state: string;
    lastSyncAt: string | null;
    lastErrorCode: string | null;
  }>;
  // No secrets/tokens — never include clientSecret, botToken, lease tokens.
};

export type WarRoomRepairAction =
  | 'TEST_CONNECTION'
  | 'RECONCILE'
  | 'RETRY_PROJECTION'
  | 'RETRY_PARTICIPANT_SYNC'
  | 'RETRY_EXTERNAL_CLEANUP'
  | 'REFRESH_PERMISSIONS';

export type WarRoomRepairRequest = {
  warRoomId: string;
  action: WarRoomRepairAction;
  actorId: string;
  actorEmail?: string | null;
  reason?: string | null;
};

export type WarRoomRepairResult = {
  accepted: boolean;
  jobId?: string | null;
  jobType?: string | null;
  reasonCode?: string | null;
  message?: string | null;
};

export type IntegrationHealthSummary = {
  provider: WarRoomProviderName;
  operationalHealth: OperationalHealth;
  healthyRooms: number;
  degradedRooms: number;
  driftedRooms: number;
  unavailableRooms: number;
  unknownRooms: number;
  totalRooms: number;
  externalCleanupPending: number;
};

// Metrics labels — never include incidentId / userId / channelId / tenantId
export const WAR_ROOM_METRIC_LABEL_ALLOWLIST = [
  'provider',
  'state',
  'health',
  'result',
  'action',
  'reason',
] as const;

export type WarRoomMetricLabel = (typeof WAR_ROOM_METRIC_LABEL_ALLOWLIST)[number];
