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
  WarRoomProviderName,
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

/**
 * Authoritative Server-Side Collaboration Capabilities Resolver.
 * MUST be invoked at mutation time by POST /war-rooms and POST /meeting
 * to guarantee that requests cannot bypass service-level policies.
 */
export async function getIncidentCollaborationCapabilities(params: {
  incidentId: string;
  userId?: string;
}): Promise<{
  canManageWarRooms: boolean;
  canManageMeeting: boolean;
  incidentStatus: string;
  providers: Array<{
    provider: WarRoomProviderName;
    canCreate: boolean;
    availability: WarRoomProviderAvailability;
    reason?: string | null;
  }>;
  meeting: {
    effectiveProvider: string;
    desiredProvider: string;
    canProvision: boolean;
    canClose: boolean;
    canRetry: boolean;
    isUnavailable: boolean;
    unavailableReason?: string;
  };
}> {
  const { getIncidentCollaborationView } = await import('./get-incident-collaboration');
  const view = await getIncidentCollaborationView({
    incidentId: params.incidentId,
    userId: params.userId,
  });

  return {
    canManageWarRooms: view.permissions.canManageWarRooms,
    canManageMeeting: view.permissions.canManageMeeting,
    incidentStatus: view.incidentStatus,
    providers: view.providers.map(p => ({
      provider: p.provider,
      canCreate: p.canCreate,
      availability: p.availability,
      reason: p.unavailableReason,
    })),
    meeting: {
      effectiveProvider: view.meeting?.provider || 'NONE',
      desiredProvider: view.meeting?.provider || 'NONE',
      canProvision:
        view.permissions.canManageMeeting && ['OPEN', 'ACKNOWLEDGED'].includes(view.incidentStatus),
      canClose: Boolean(view.meeting?.actions.canClose),
      canRetry: Boolean(view.meeting?.actions.canRetry),
      isUnavailable: view.meeting?.health === 'UNAVAILABLE',
      unavailableReason: view.meeting?.lastErrorMessage || undefined,
    },
  };
}
