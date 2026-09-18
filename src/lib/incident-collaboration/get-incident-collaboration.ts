/**
 * Canonical server-side entry point for incident collaboration view generation.
 *
 * One function called by IncidentDetailScreen:
 * const collaboration = await getIncidentCollaborationView({ incidentId, userId });
 *
 * Adheres strictly to the invariant:
 * Initial incident rendering uses persisted DB state only — NEVER synchronous
 * network calls to Microsoft Graph, Slack API, or Bot Connector.
 */

import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import type {
  IncidentCollaborationView,
  IncidentMeetingReadiness,
  IncidentMeetingView,
  IncidentWarRoomHistoryItem,
  IncidentWarRoomParticipantView,
  IncidentWarRoomProviderView,
  IncidentWarRoomView,
  WarRoomPresentationHealth,
  WarRoomPresentationLifecycle,
  WarRoomProviderAvailability,
  WarRoomProviderName,
} from './types';
import {
  getGlobalWarRoomPolicy,
  getServiceWarRoomPolicy,
  resolveIncidentCollaborationPolicy,
} from './policy';
import { deriveProviderCanCreate, deriveWarRoomActions } from './capabilities';
import { getProviderDeepLinkUrl } from './urls';
import { getProviderPresentation } from './presentation';
import { getIncidentMeeting } from './meeting-store';

export type GetIncidentCollaborationInput = {
  incidentId: string;
  userId?: string;
};

export async function getIncidentCollaborationView(
  input: GetIncidentCollaborationInput
): Promise<IncidentCollaborationView> {
  const { incidentId } = input;

  const [
    incident,
    globalPolicy,
    globalSlackIntegration,
    teamsConfig,
    warRooms,
    userPermissions,
    persistedMeeting,
  ] = await Promise.all([
    prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: {
          include: {
            slackIntegration: {
              select: { id: true, enabled: true, workspaceId: true },
            },
          },
        },
      },
    }),
    getGlobalWarRoomPolicy(),
    prisma.slackIntegration.findFirst({
      where: { enabled: true, services: { none: {} } },
      select: { id: true, workspaceId: true, enabled: true },
    }),
    prisma.microsoftTeamsConfig.findUnique({
      where: { id: 'default' },
      select: { enabled: true, warRoomsEnabled: true, defaultMeetingOrganizerUpn: true },
    }),
    prisma.incidentWarRoom.findMany({
      where: { incidentId },
      orderBy: [{ generation: 'desc' }, { createdAt: 'desc' }],
      include: {
        participants: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
        },
      },
    }),
    getUserPermissions(),
    getIncidentMeeting(incidentId),
  ]);

  if (!incident) {
    return {
      visible: false,
      incidentId,
      incidentStatus: 'RESOLVED',
      summary: {
        activeRooms: 0,
        transitioningRooms: 0,
        attentionRequired: 0,
        totalHistoricalRooms: 0,
      },
      providers: [],
      meeting: null,
      history: [],
      permissions: { canManageWarRooms: false, canManageMeeting: false },
    };
  }

  const incidentStatus = incident.status;

  // Fetch service policy if incident has a service
  const servicePolicy = incident.serviceId
    ? await getServiceWarRoomPolicy(incident.serviceId)
    : null;

  // Look up destination for Teams
  const teamsDestination = await prisma.microsoftTeamsDestination.findFirst({
    where: {
      serviceId: incident.serviceId,
      enabled: true,
      warRoomEnabled: true,
      installation: { is: { enabled: true } },
    },
    select: {
      id: true,
      enabled: true,
      warRoomEnabled: true,
      tenantId: true,
      teamId: true,
    },
  });

  const canManageWarRooms = Boolean(userPermissions?.isResponderOrAbove);

  // Integration connectivity
  const hasSlackIntegration = Boolean(
    (incident.service?.slackIntegration?.workspaceId &&
      incident.service?.slackIntegration?.enabled !== false) ||
    globalSlackIntegration?.workspaceId
  );
  const isSlackConnected = Boolean(hasSlackIntegration && globalPolicy.enabled);
  const isTeamsIntegrationEnabled = Boolean(teamsConfig?.enabled);
  const isTeamsChatConnected = Boolean(
    teamsConfig?.enabled && teamsConfig?.warRoomsEnabled && globalPolicy.enabled
  );

  const availableIntegrations: WarRoomProviderName[] = [];
  if (isSlackConnected) availableIntegrations.push('SLACK');
  if (isTeamsChatConnected) availableIntegrations.push('MICROSOFT_TEAMS');

  // Resolve canonical 4-layer collaboration policy
  const canonicalPolicy = resolveIncidentCollaborationPolicy({
    incident: {
      urgency: incident.urgency,
      priority: incident.priority,
      visibility: incident.visibility,
    },
    globalPolicy,
    servicePolicy,
    availableIntegrations,
    isTeamsMeetingAvailable: isTeamsIntegrationEnabled,
  });

  const isSlackDesired = canonicalPolicy.desiredProviders.includes('SLACK');
  const isTeamsDesired = canonicalPolicy.desiredProviders.includes('MICROSOFT_TEAMS');

  // Destination validation
  const slackDestinationAvailable = hasSlackIntegration;
  const teamsDestinationAvailable = Boolean(
    teamsDestination && teamsDestination.enabled && teamsDestination.warRoomEnabled
  );

  // Derive Slack availability & reason
  let slackAvailability: WarRoomProviderAvailability = 'NOT_CONFIGURED';
  let slackUnavailableReason: string | null = null;

  if (!isSlackDesired) {
    slackAvailability = 'DISABLED';
    slackUnavailableReason = 'Slack war rooms are not enabled for this service.';
  } else if (!hasSlackIntegration) {
    slackAvailability = 'NOT_CONFIGURED';
    slackUnavailableReason = 'No Slack workspace installed for this service or organization.';
  } else if (!globalPolicy.enabled) {
    slackAvailability = 'DISABLED';
    slackUnavailableReason = 'War Rooms are disabled in system settings.';
  } else if (!slackDestinationAvailable) {
    slackAvailability = 'NOT_CONFIGURED';
    slackUnavailableReason = 'No Slack channel or destination mapped for this service.';
  } else {
    slackAvailability = 'AVAILABLE';
  }

  // Derive Teams availability & reason
  let teamsAvailability: WarRoomProviderAvailability = 'NOT_CONFIGURED';
  let teamsUnavailableReason: string | null = null;

  if (!isTeamsDesired) {
    teamsAvailability = 'DISABLED';
    teamsUnavailableReason = 'Microsoft Teams war rooms are not enabled for this service.';
  } else if (!teamsConfig || !teamsConfig.enabled || !teamsConfig.warRoomsEnabled) {
    teamsAvailability = teamsConfig && !teamsConfig.enabled ? 'DISABLED' : 'NOT_CONFIGURED';
    teamsUnavailableReason = 'Microsoft Teams war rooms are not enabled in settings.';
  } else if (!teamsDestinationAvailable) {
    teamsAvailability = 'NOT_CONFIGURED';
    teamsUnavailableReason = 'No active Teams destination is mapped for this service.';
  } else {
    teamsAvailability = 'AVAILABLE';
  }

  // Helper to map DB room to IncidentWarRoomView
  function mapRoomToView(
    room: (typeof warRooms)[number],
    providerAvailability: WarRoomProviderAvailability
  ): IncidentWarRoomView {
    const state = room.state as WarRoomPresentationLifecycle;
    const health = room.health as WarRoomPresentationHealth;

    const participantsList: IncidentWarRoomParticipantView[] = room.participants.map(p => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.name || 'Unknown responder',
      email: p.user?.email || null,
      avatarUrl: p.user?.avatarUrl || null,
      source: p.source,
      state: p.state as IncidentWarRoomParticipantView['state'],
      lastError: p.lastError,
      addedAt: p.addedAt ? p.addedAt.toISOString() : null,
    }));

    const synced = participantsList.filter(p => p.state === 'PRESENT').length;
    const pending = participantsList.filter(p =>
      ['DESIRED', 'PROCESSING', 'PENDING'].includes(p.state)
    ).length;
    const attentionRequired = participantsList.filter(
      p => p.lastError || p.state === 'SKIPPED'
    ).length;

    // Actions depend on provider availability: if provider is now DISABLED, mutation actions are restricted
    const actions = deriveWarRoomActions({
      state,
      channelUrl: room.providerChannelUrl,
      incidentStatus: incident?.status || 'OPEN',
      canManage: canManageWarRooms && providerAvailability === 'AVAILABLE',
      externalCleanupPending: room.externalCleanupPending,
      archiveOnResolve: canonicalPolicy.archiveOnResolve,
    });

    // Even if provider is disabled, Open link remains valid if channel exists
    if (room.providerChannelUrl && ['READY', 'CLOSED', 'ARCHIVED'].includes(state)) {
      actions.canOpen = true;
    }

    return {
      id: room.id,
      provider: room.provider as IncidentWarRoomView['provider'],
      generation: room.generation,
      state,
      health,
      channelId: room.providerChannelId,
      channelName: room.providerChannelName,
      channelUrl: room.providerChannelUrl,
      deepLinkUrl: getProviderDeepLinkUrl(room.provider as IncidentWarRoomView['provider'], {
        channelUrl: room.providerChannelUrl,
        channelId: room.providerChannelId,
        tenantId: room.providerTenantId,
      }),
      membershipType: (room.membershipType as 'STANDARD' | 'PRIVATE') || null,
      createdAt: room.createdAt.toISOString(),
      readyAt: room.readyAt ? room.readyAt.toISOString() : null,
      closedAt: room.closedAt ? room.closedAt.toISOString() : null,
      archivedAt: room.archivedAt ? room.archivedAt.toISOString() : null,
      lastError: room.lastError,
      lastErrorCode: room.lastErrorCode,
      lastReconciledAt: room.lastReconciledAt ? room.lastReconciledAt.toISOString() : null,
      actions,
      participants: {
        synced,
        pending,
        attentionRequired,
        total: participantsList.length,
        items: participantsList,
      },
    };
  }

  function mapRoomToHistoryItem(room: (typeof warRooms)[number]): IncidentWarRoomHistoryItem {
    return {
      id: room.id,
      provider: room.provider as IncidentWarRoomHistoryItem['provider'],
      generation: room.generation,
      state: room.state as WarRoomPresentationLifecycle,
      health: room.health as WarRoomPresentationHealth,
      channelName: room.providerChannelName,
      channelUrl: room.providerChannelUrl,
      deepLinkUrl: getProviderDeepLinkUrl(room.provider as IncidentWarRoomHistoryItem['provider'], {
        channelUrl: room.providerChannelUrl,
        channelId: room.providerChannelId,
        tenantId: room.providerTenantId,
      }),
      membershipType: (room.membershipType as 'STANDARD' | 'PRIVATE') || null,
      closedAt: room.closedAt ? room.closedAt.toISOString() : null,
      archivedAt: room.archivedAt ? room.archivedAt.toISOString() : null,
      createdAt: room.createdAt.toISOString(),
    };
  }

  // Derive provider views via generic provider-neutral pattern
  function buildProviderView(provider: WarRoomProviderName): IncidentWarRoomProviderView {
    const isSlack = provider === 'SLACK';
    const isTeams = provider === 'MICROSOFT_TEAMS';
    const presentation = getProviderPresentation(provider);
    const rooms = warRooms.filter(r => r.provider === provider);
    const availability = isSlack
      ? slackAvailability
      : isTeams
        ? teamsAvailability
        : ('NOT_CONFIGURED' as WarRoomProviderAvailability);
    const unavailableReason = isSlack
      ? slackUnavailableReason
      : isTeams
        ? teamsUnavailableReason
        : 'Provider not configured';
    const enabledForService = isSlack ? isSlackDesired : isTeams ? isTeamsDesired : false;
    const destinationAvailable = isSlack
      ? slackDestinationAvailable
      : isTeams
        ? teamsDestinationAvailable
        : false;

    const latestRoom = rooms[0] ?? null;
    const isActiveOrTransitional =
      latestRoom &&
      ['REQUESTED', 'PROVISIONING', 'AMBIGUOUS', 'READY', 'CLOSING'].includes(latestRoom.state);

    const currentRoom = isActiveOrTransitional ? mapRoomToView(latestRoom, availability) : null;
    const history = latestRoom
      ? (isActiveOrTransitional ? rooms.slice(1) : rooms).map(mapRoomToHistoryItem)
      : [];

    const canCreate =
      enabledForService &&
      deriveProviderCanCreate({
        availability,
        incidentStatus,
        canManage: canManageWarRooms,
        latestRoomState: latestRoom ? (latestRoom.state as WarRoomPresentationLifecycle) : null,
      });

    const visible =
      (enabledForService && (canCreate || currentRoom !== null || history.length > 0)) ||
      rooms.length > 0;

    return {
      provider,
      displayName: presentation.displayName,
      subtitle: presentation.subtitle,
      availability,
      visible,
      canCreate,
      enabledForService,
      destinationAvailable,
      unavailableReason,
      currentRoom,
      historyCount: history.length,
      history,
      supportedOptions: {
        supportsPrivateRooms: isTeams || isSlack,
      },
    };
  }

  const SUPPORTED_WAR_ROOM_PROVIDERS: WarRoomProviderName[] = ['SLACK', 'MICROSOFT_TEAMS'];
  const providerViews = SUPPORTED_WAR_ROOM_PROVIDERS.map(buildProviderView);
  const slackProviderView = providerViews.find(p => p.provider === 'SLACK')!;
  const teamsProviderView = providerViews.find(p => p.provider === 'MICROSOFT_TEAMS')!;
  const currentSlackRoom = slackProviderView.currentRoom;
  const currentTeamsRoom = teamsProviderView.currentRoom;
  const isSlackVisible = slackProviderView.visible;
  const isTeamsVisible = teamsProviderView.visible;
  const historicalSlackRooms = slackProviderView.history;
  const historicalTeamsRooms = teamsProviderView.history;

  // Meeting resolution from canonical policy
  const canManageMeeting = canManageWarRooms;
  const meetingResolution = canonicalPolicy.meeting;

  let meeting: IncidentMeetingView | null = persistedMeeting;

  if (!meeting && meetingResolution.effectiveProvider !== 'NONE' && !meetingResolution.isDisabled) {
    const customTemplate = incident.service?.warRoomCustomBridgeUrl || null;
    const provider = meetingResolution.effectiveProvider;
    let isAvailable = !meetingResolution.isUnavailable;
    let readiness: IncidentMeetingReadiness = 'READY';
    let reason: string | null = meetingResolution.unavailableReason || null;

    if (provider === 'MICROSOFT_TEAMS') {
      if (!isTeamsIntegrationEnabled) {
        isAvailable = false;
        readiness = 'UNAVAILABLE';
        reason = 'Microsoft Teams integration is not enabled in settings.';
      } else if (!teamsConfig?.defaultMeetingOrganizerUpn?.trim()) {
        isAvailable = false;
        readiness = 'ORGANIZER_REQUIRED';
        reason = 'Teams meeting organizer UPN is required in ChatOps settings.';
      } else {
        // Configured with organizer UPN from DB; authorization is verified when provisioning
        isAvailable = true;
        readiness = 'CONFIGURED';
        reason = null;
      }
    } else if (provider === 'ZOOM' || provider === 'GOOGLE_MEET') {
      const { resolveGlobalCustomBridgeTemplate } = await import('./meeting-registry');
      const globalTemplate = await resolveGlobalCustomBridgeTemplate().catch(() => null);
      const hasTemplate = Boolean(customTemplate?.trim() || globalTemplate?.trim());
      if (!hasTemplate) {
        isAvailable = false;
        readiness = 'UNAVAILABLE';
        reason = `${provider === 'ZOOM' ? 'Zoom' : 'Google Meet'} bridge template is not configured.`;
      } else {
        isAvailable = true;
        readiness = 'READY';
      }
    } else if (provider === 'JITSI') {
      isAvailable = true;
      readiness = 'READY';
    }

    const canProvision = canManageMeeting && incident.status !== 'RESOLVED' && isAvailable;
    const isTeams = provider === 'MICROSOFT_TEAMS';

    meeting = {
      id: `pending_meet_${incident.id}`,
      incidentId: incident.id,
      generation: 1,
      provider,
      state: 'REQUESTED',
      health: isAvailable ? 'HEALTHY' : 'UNAVAILABLE',
      externalId: `opsknight:${incident.id}:1`,
      joinUrl: '',
      providerMeetingId: null,
      organizerEmail: isTeams ? teamsConfig?.defaultMeetingOrganizerUpn?.trim() || null : null,
      createdAt: incident.createdAt.toISOString(),
      lastErrorCode: !isAvailable ? readiness : null,
      lastErrorMessage: reason,
      readiness,
      actions: {
        canJoin: false,
        canRetry: false,
        canClose: false,
        canProvision,
        supportsExternalClose: isTeams,
        closeLabel: isTeams ? 'End Meeting' : 'Detach Bridge',
      },
    };
  } else if (meeting) {
    const isTeams = meeting.provider === 'MICROSOFT_TEAMS';
    meeting = {
      ...meeting,
      actions: {
        canJoin: meeting.state === 'READY' && Boolean(meeting.joinUrl),
        canRetry: meeting.state === 'FAILED' && canManageMeeting && incident.status !== 'RESOLVED',
        canClose:
          (meeting.state === 'READY' || meeting.state === 'PROVISIONING') &&
          canManageMeeting &&
          (incident.status !== 'RESOLVED' || !canonicalPolicy.archiveOnResolve),
        canProvision:
          canManageMeeting && incident.status !== 'RESOLVED' && meeting.state === 'CLOSED',
        supportsExternalClose: isTeams,
        closeLabel: isTeams ? 'End Meeting' : 'Detach Bridge',
      },
    };
  }

  // Root visibility: visible only if AT LEAST ONE provider is visible or meeting is active
  const isAnyProviderVisible = isSlackVisible || isTeamsVisible || Boolean(meeting);

  // Active rooms summary
  const activeRooms = [currentSlackRoom, currentTeamsRoom].filter(
    r => r && r.state === 'READY'
  ).length;

  const transitioningRooms = [currentSlackRoom, currentTeamsRoom].filter(
    r => r && ['REQUESTED', 'PROVISIONING', 'AMBIGUOUS', 'CLOSING'].includes(r.state)
  ).length;

  const attentionRequired = [currentSlackRoom, currentTeamsRoom].filter(
    r => r && (r.health !== 'HEALTHY' || r.participants.attentionRequired > 0)
  ).length;

  const allHistory = [...historicalSlackRooms, ...historicalTeamsRooms].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    visible: isAnyProviderVisible,
    incidentId: incident.id,
    incidentStatus: incident.status,
    incidentVisibility: incident.visibility,
    privacyRequirement: canonicalPolicy.privacyRequirement,
    summary: {
      activeRooms,
      transitioningRooms,
      attentionRequired,
      totalHistoricalRooms: allHistory.length,
    },
    providers: providerViews.filter(p => p.visible),
    meeting,
    history: allHistory,
    permissions: {
      canManageWarRooms,
      canManageMeeting,
    },
  };
}
