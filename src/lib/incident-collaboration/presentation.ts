/**
 * Presentation rules and semantic styling metadata for Incident Collaboration.
 */

import type {
  WarRoomBadgeTone,
  WarRoomPresentationHealth,
  WarRoomPresentationLifecycle,
  WarRoomProviderName,
} from './types';

export type LifecyclePresentation = {
  label: string;
  tone: WarRoomBadgeTone;
  description: string;
};

export type HealthPresentation = {
  label: string;
  tone: WarRoomBadgeTone;
  description: string;
};

export const LIFECYCLE_PRESENTATION: Record<WarRoomPresentationLifecycle, LifecyclePresentation> = {
  REQUESTED: {
    label: 'Queued',
    tone: 'neutral',
    description: 'War room creation is queued.',
  },
  PROVISIONING: {
    label: 'Creating…',
    tone: 'info',
    description: 'Setting up external channel and resources.',
  },
  AMBIGUOUS: {
    label: 'Confirming creation…',
    tone: 'warning',
    description: 'Awaiting confirmation of channel identity.',
  },
  READY: {
    label: 'Active',
    tone: 'success',
    description: 'War room is active and open for responders.',
  },
  CLOSING: {
    label: 'Closing…',
    tone: 'warning',
    description: 'Cleaning up and closing war room channel.',
  },
  CLOSED: {
    label: 'Closed',
    tone: 'neutral',
    description: 'War room is closed.',
  },
  ARCHIVED: {
    label: 'Archived',
    tone: 'neutral',
    description: 'War room channel has been archived.',
  },
  FAILED: {
    label: 'Creation failed',
    tone: 'destructive',
    description: 'Unable to complete war room creation.',
  },
};

export const HEALTH_PRESENTATION: Record<WarRoomPresentationHealth, HealthPresentation> = {
  HEALTHY: {
    label: 'Healthy',
    tone: 'success',
    description: 'External channel and projection are fully in sync.',
  },
  DEGRADED: {
    label: 'Needs attention',
    tone: 'warning',
    description: 'Some participants or message sync operations failed.',
  },
  MISSING: {
    label: 'Room unavailable',
    tone: 'destructive',
    description: 'External channel cannot be located on the provider.',
  },
  PERMISSION_ERROR: {
    label: 'Permissions required',
    tone: 'destructive',
    description: 'Provider permissions need attention to complete operations.',
  },
};

export const PROVIDER_PRESENTATION: Record<
  WarRoomProviderName,
  {
    displayName: string;
    subtitle: string;
    createActionLabel: string;
    openActionLabel: string;
  }
> = {
  SLACK: {
    displayName: 'Slack',
    subtitle: 'Fast incident channel',
    createActionLabel: 'Create Slack channel',
    openActionLabel: 'Open in Slack',
  },
  MICROSOFT_TEAMS: {
    displayName: 'Microsoft Teams',
    subtitle: 'Incident collaboration channel',
    createActionLabel: 'Create Teams channel',
    openActionLabel: 'Open in Teams',
  },
};

export function getLifecyclePresentation(
  state: WarRoomPresentationLifecycle
): LifecyclePresentation {
  switch (state) {
    case 'REQUESTED':
      return LIFECYCLE_PRESENTATION.REQUESTED;
    case 'PROVISIONING':
      return LIFECYCLE_PRESENTATION.PROVISIONING;
    case 'AMBIGUOUS':
      return LIFECYCLE_PRESENTATION.AMBIGUOUS;
    case 'READY':
      return LIFECYCLE_PRESENTATION.READY;
    case 'CLOSING':
      return LIFECYCLE_PRESENTATION.CLOSING;
    case 'CLOSED':
      return LIFECYCLE_PRESENTATION.CLOSED;
    case 'ARCHIVED':
      return LIFECYCLE_PRESENTATION.ARCHIVED;
    case 'FAILED':
      return LIFECYCLE_PRESENTATION.FAILED;
    default:
      return {
        label: state,
        tone: 'neutral',
        description: '',
      };
  }
}

export function getHealthPresentation(health: WarRoomPresentationHealth): HealthPresentation {
  switch (health) {
    case 'HEALTHY':
      return HEALTH_PRESENTATION.HEALTHY;
    case 'DEGRADED':
      return HEALTH_PRESENTATION.DEGRADED;
    case 'MISSING':
      return HEALTH_PRESENTATION.MISSING;
    case 'PERMISSION_ERROR':
      return HEALTH_PRESENTATION.PERMISSION_ERROR;
    default:
      return {
        label: health,
        tone: 'neutral',
        description: '',
      };
  }
}

export function toUserFacingWarRoomError(
  error: unknown,
  fallback = 'War-room operation failed'
): { title: string; description?: string } {
  if (!error) return { title: fallback };

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof (error as Record<string, unknown>)?.message === 'string'
          ? String((error as Record<string, unknown>).message)
          : fallback;

  if (message.includes('CREATE_ALREADY_IN_PROGRESS') || message.includes('already in progress')) {
    return {
      title: 'Creation in progress',
      description: 'A war room is already being created for this incident.',
    };
  }

  if (message.includes('INCIDENT_NOT_ACTIVE') || message.includes('INCIDENT_CLOSED')) {
    return {
      title: 'Incident is resolved',
      description: 'War rooms cannot be created for resolved incidents. Reopen the incident first.',
    };
  }

  if (message.includes('PERMISSION_REQUIRED') || message.includes('MISSING_PERMISSION')) {
    return {
      title: 'Permissions required',
      description: 'Integration permissions need attention before performing this action.',
    };
  }

  if (message.includes('PROVIDER_UNAVAILABLE') || message.includes('DESTINATION_UNAVAILABLE')) {
    return {
      title: 'Provider unavailable',
      description: 'The collaboration provider is not currently reachable or configured.',
    };
  }

  if (message.includes('STALE_GENERATION')) {
    return {
      title: 'Outdated state',
      description: 'The requested operation was targeting an older generation. Please refresh.',
    };
  }

  return { title: message || fallback };
}
