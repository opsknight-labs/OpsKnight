/**
 * Server-side capability and permissible actions derivation for Incident Collaboration.
 *
 * Enforces business rules and RBAC fencing so React components never make
 * autonomous authorization or state-machine decisions.
 */

import type {
  IncidentWarRoomActions,
  WarRoomPresentationLifecycle,
  WarRoomProviderAvailability,
} from './types';

export function deriveWarRoomActions(options: {
  state: WarRoomPresentationLifecycle;
  channelUrl: string | null;
  incidentStatus: string;
  canManage: boolean;
  externalCleanupPending?: boolean;
}): IncidentWarRoomActions {
  const { state, channelUrl, incidentStatus, canManage, externalCleanupPending } = options;
  const isIncidentActive = ['OPEN', 'ACKNOWLEDGED'].includes(incidentStatus);

  const canOpen = Boolean(channelUrl && ['READY', 'CLOSED', 'ARCHIVED'].includes(state));
  const canClose = Boolean(canManage && isIncidentActive && ['READY', 'AMBIGUOUS'].includes(state));
  const canReconcile = Boolean(canManage && ['READY', 'AMBIGUOUS'].includes(state));
  const canSyncParticipants = Boolean(canManage && isIncidentActive && state === 'READY');
  const canRefreshProjection = Boolean(canManage && state === 'READY');
  const canRetryCleanup = Boolean(canManage && externalCleanupPending);
  const canCreateReplacementProjection = Boolean(canManage && state === 'AMBIGUOUS');

  return {
    canOpen,
    canCreate: false, // Per-room cannot create; provider owns canCreate
    canClose,
    canReconcile,
    canSyncParticipants,
    canRefreshProjection,
    canRetryCleanup,
    canCreateReplacementProjection,
  };
}

export function deriveProviderCanCreate(options: {
  availability: WarRoomProviderAvailability;
  incidentStatus: string;
  canManage: boolean;
  latestRoomState?: WarRoomPresentationLifecycle | null;
}): boolean {
  const { availability, incidentStatus, canManage, latestRoomState } = options;

  if (availability !== 'AVAILABLE') return false;
  if (!canManage) return false;
  if (!['OPEN', 'ACKNOWLEDGED'].includes(incidentStatus)) return false;

  // Prevent duplicate creation: if a room is active or transitional, new creation is forbidden.
  if (
    latestRoomState &&
    ['REQUESTED', 'PROVISIONING', 'AMBIGUOUS', 'READY', 'CLOSING'].includes(latestRoomState)
  ) {
    return false;
  }

  return true;
}
