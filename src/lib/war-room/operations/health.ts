import 'server-only';

import type { WarRoomHealthState } from '@prisma/client';
import type { OperationalHealth, WarRoomOperationalSnapshot } from './types';

/**
 * Deterministic operational health classifier — provider-neutral.
 *
 * Precedence (highest wins):
 *  1. UNKNOWN — provider API unavailable (429/5xx/timeout/auth/token) with stale reconciliation.
 *  2. UNAVAILABLE — integration disabled, bot not installed, or destination revoked.
 *  3. DRIFTED — external resource drift (MISSING/DUPLICATE/channel identity absent/when CLOSING orphan) or externalCleanupPending debt.
 *  4. DEGRADED — permission errors, projection lag, participant drift, or healthState DEGRADED/PERMISSION_ERROR without DRIFTED signal.
 *  5. HEALTHY — authorized + permissions + healthy + no debt + current projection + participants in sync.
 *
 * Provider API unavailable ≠ resource missing (transport/timeout never collapses to MISSING).
 */

export type HealthInput = {
  state: string;
  healthState: WarRoomHealthState;
  lastReconciledAt: Date | null;
  lastProjectedVersion: number;
  projectionVersion: number;
  lastErrorCode: string | null;
  lastError: string | null;
  externalCleanupPending: boolean;
  externalCleanupReason: string | null;
  providerChannelId: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  destinationEnabled: boolean | null;
  destinationWarRoomEnabled: boolean | null;
  installationEnabled: boolean | null;
  integrationEnabled: boolean | null;
  configEnabled: boolean | null;
  warRoomsEnabled: boolean | null;
  installCountForProvider: number | null;
  participantDrift: number | null;
  rscUnknown?: boolean | null;
  permissionError?: boolean;
};

const UNKNOWN_HINT_CODES = new Set([
  'RATE_LIMITED',
  'GRAPH_TOKEN_FAILED',
  'TRANSIENT_READ',
  'AMBIGUOUS_CREATE',
  'DRIFT_RATE_LIMITED',
  'DRIFT_TRANSIENT_READ',
  'DRIFT_GRAPH_TOKEN_FAILED',
]);

const RECONCILIATION_STALE_MS = 10 * 60_000;

function isUnknownHint(code: string | null, message: string | null): boolean {
  const c = (code ?? '').toUpperCase();
  if (UNKNOWN_HINT_CODES.has(c)) return true;
  if (c.startsWith('RECONCILIATION_') && /RATE_LIMITED|TRANSIENT_READ|GRAPH_TOKEN_FAILED|TRANSIENT|TIMEOUT/i.test(c)) return true;
  const m = (message ?? '').toLowerCase();
  if (/rate.?limited|transient|timeout|graph token|graph returned|429|5\d{2}/i.test(m)) return true;
  return false;
}

function isPermissionHint(code: string | null): boolean {
  const c = (code ?? '').toUpperCase();
  return c === 'MISSING_PERMISSION' || c === 'PERMISSION_ERROR' || c.startsWith('DRIFT_MISSING_PERMISSION') || c.includes('CONSENT_REQUIRED') || c === 'WAR_ROOM_AUTHORITY_REVOKED' || c === 'WAR_ROOM_CAPABILITY_UNAVAILABLE';
}

function isDriftHint(input: HealthInput): boolean {
  const c = (input.lastErrorCode ?? '').toUpperCase();
  if (input.externalCleanupPending) return true;
  if (input.healthState === 'MISSING') return true;
  if (c === 'MISSING' || c === 'CHANNEL_MISSING' || c === 'DUPLICATE_WAR_ROOMS' || c === 'TEAM_NOT_FOUND' || c === 'CHANNEL_NOT_FOUND') return true;
  if (!input.providerChannelId && ['READY', 'CLOSING'].includes(input.state)) return true;
  return false;
}

export function classifyOperationalHealth(input: HealthInput): {
  operationalHealth: OperationalHealth;
  reasonCode: string | null;
  reasonMessage: string | null;
} {
  const stale = !input.lastReconciledAt || Date.now() - input.lastReconciledAt.getTime() > RECONCILIATION_STALE_MS;
  const unknownHint = isUnknownHint(input.lastErrorCode, input.lastError);

  // UNKNOWN: provider unavailable and we cannot verify resource state. Requires stale + hint, or explicit unknown RSC.
  if ((stale && unknownHint) || (input.rscUnknown && !input.providerChannelId && stale)) {
    return {
      operationalHealth: 'UNKNOWN',
      reasonCode: input.lastErrorCode ?? 'PROVIDER_UNAVAILABLE',
      reasonMessage: input.lastError ?? 'Provider API is temporarily unavailable; resource state could not be verified.',
    };
  }

  // UNAVAILABLE: integration surface disabled — no provider call possible
  if (input.integrationEnabled === false || input.configEnabled === false || input.warRoomsEnabled === false) {
    return {
      operationalHealth: 'UNAVAILABLE',
      reasonCode: 'INTEGRATION_DISABLED',
      reasonMessage: 'ChatOps integration is disabled; war-room operations are unavailable.',
    };
  }
  if (input.destinationEnabled === false || input.destinationWarRoomEnabled === false) {
    return {
      operationalHealth: 'UNAVAILABLE',
      reasonCode: 'DESTINATION_DISABLED',
      reasonMessage: 'War-room destination is disabled.',
    };
  }
  if (input.installationEnabled === false || input.installCountForProvider === 0) {
    return {
      operationalHealth: 'UNAVAILABLE',
      reasonCode: 'BOT_NOT_INSTALLED',
      reasonMessage: 'ChatOps app is not installed to the target team.',
    };
  }

  // DRIFTED: external identity drift — resource missing/duplicate/orphan or cleanup debt
  if (isDriftHint(input)) {
    return {
      operationalHealth: 'DRIFTED',
      reasonCode: input.lastErrorCode ?? (input.externalCleanupPending ? input.externalCleanupReason ?? 'EXTERNAL_CLEANUP_PENDING' : 'RESOURCE_DRIFT'),
      reasonMessage: input.lastError ?? (input.externalCleanupPending ? 'External cleanup is pending; provider resource may have drifted.' : 'External resource identity has drifted from the local record.'),
    };
  }

  // DEGRADED: permissions, lag, participant drift, or health DEGRADED
  const lag = (input.projectionVersion ?? 0) - (input.lastProjectedVersion ?? 0);
  const hasLag = lag > 0;
  const hasParticipantDrift = (input.participantDrift ?? 0) > 0;
  const permission = input.permissionError || isPermissionHint(input.lastErrorCode) || input.healthState === 'PERMISSION_ERROR';
  if (permission || input.healthState === 'DEGRADED' || hasLag || hasParticipantDrift) {
    const code =
      permission ? input.lastErrorCode ?? 'PERMISSION_ERROR' :
      hasLag ? 'PROJECTION_BEHIND' :
      hasParticipantDrift ? 'PARTICIPANT_DRIFT' :
      input.lastErrorCode ?? 'DEGRADED';
    const message =
      permission ? input.lastError ?? 'Permissions or authorization need attention.' :
      hasLag ? `Projection is behind by ${lag} version(s).` :
      hasParticipantDrift ? `Participant sync drift: ${input.participantDrift} pending/failed.` :
      input.lastError ?? 'War-room health is degraded.';
    return { operationalHealth: 'DEGRADED', reasonCode: code, reasonMessage: message };
  }

  // HEALTHY
  return { operationalHealth: 'HEALTHY', reasonCode: null, reasonMessage: null };
}

export function toOperationalSnapshot(input: {
  id: string;
  incidentId: string;
  provider: string;
  generation: number;
  state: string;
  health: WarRoomHealthState;
  projectionVersion: number;
  lastProjectedVersion: number;
  lastProjectedAt: Date | null;
  lastReconciledAt: Date | null;
  lastErrorCode: string | null;
  lastError: string | null;
  externalCleanupPending: boolean;
  externalCleanupReason: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  providerChannelId: string | null;
  providerChannelName: string | null;
  destinationId: string | null;
  installationId: string | null;
  participantDrift?: number;
  participantCounts?: WarRoomOperationalSnapshot['participantCounts'];
  destinationEnabled?: boolean | null;
  destinationWarRoomEnabled?: boolean | null;
  installationEnabled?: boolean | null;
  integrationEnabled?: boolean | null;
  configEnabled?: boolean | null;
  warRoomsEnabled?: boolean | null;
  installCountForProvider?: number | null;
  rscUnknown?: boolean | null;
}): WarRoomOperationalSnapshot {
  const participantDrift = input.participantDrift ?? (input.participantCounts
    ? (input.participantCounts!.pending + input.participantCounts!.failed + (input.participantCounts?.desiredStale ?? 0))
    : 0);
  const classified = classifyOperationalHealth({
    state: input.state,
    healthState: input.health,
    lastReconciledAt: input.lastReconciledAt,
    lastProjectedVersion: input.lastProjectedVersion,
    projectionVersion: input.projectionVersion,
    lastErrorCode: input.lastErrorCode,
    lastError: input.lastError,
    externalCleanupPending: input.externalCleanupPending,
    externalCleanupReason: input.externalCleanupReason,
    providerChannelId: input.providerChannelId,
    providerTenantId: input.providerTenantId,
    providerContainerId: input.providerContainerId,
    destinationEnabled: input.destinationEnabled ?? null,
    destinationWarRoomEnabled: input.destinationWarRoomEnabled ?? null,
    installationEnabled: input.installationEnabled ?? null,
    integrationEnabled: input.integrationEnabled ?? null,
    configEnabled: input.configEnabled ?? null,
    warRoomsEnabled: input.warRoomsEnabled ?? null,
    installCountForProvider: input.installCountForProvider ?? null,
    participantDrift,
    rscUnknown: input.rscUnknown ?? null,
    permissionError: input.health === 'PERMISSION_ERROR',
  });
  const lag = input.projectionVersion - input.lastProjectedVersion;
  return {
    warRoomId: input.id,
    incidentId: input.incidentId,
    provider: input.provider as WarRoomOperationalSnapshot['provider'],
    generation: input.generation,
    state: input.state as WarRoomOperationalSnapshot['state'],
    healthState: input.health,
    operationalHealth: classified.operationalHealth,
    healthReasonCode: classified.reasonCode,
    healthReasonMessage: classified.reasonMessage,
    projectionVersion: input.projectionVersion,
    lastProjectedVersion: input.lastProjectedVersion,
    projectionLag: Math.max(0, lag),
    projectionBehind: lag > 0,
    participantDrift,
    participantCounts: input.participantCounts ?? { desired: 0, present: 0, pending: 0, failed: 0, desiredStale: 0 },
    externalCleanupPending: input.externalCleanupPending,
    externalCleanupReason: input.externalCleanupReason,
    lastReconciledAt: input.lastReconciledAt?.toISOString() ?? null,
    lastProjectedAt: input.lastProjectedAt?.toISOString() ?? null,
    lastErrorCode: input.lastErrorCode,
    lastError: input.lastError,
    providerTenantId: input.providerTenantId,
    providerContainerId: input.providerContainerId,
    providerChannelId: input.providerChannelId,
    providerChannelName: input.providerChannelName,
    destinationId: input.destinationId,
    installationId: input.installationId,
  };
}
