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
  resolveEffectiveWarRoomProviders,
} from './policy';
import { deriveProviderCanCreate, deriveWarRoomActions } from './capabilities';
import { getProviderDeepLinkUrl } from './urls';
import { PROVIDER_PRESENTATION } from './presentation';

export type GetIncidentCollaborationInput = {
  incidentId: string;
  userId?: string;
};

export async function getIncidentCollaborationView(
  input: GetIncidentCollaborationInput
): Promise<IncidentCollaborationView> {
  const { incidentId } = input;

  const [incident, globalPolicy, globalSlackIntegration, teamsConfig, warRooms, userPermissions] =
    await Promise.all([
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
        select: { enabled: true, warRoomsEnabled: true },
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
      history: [],
      permissions: { canManageWarRooms: false },
    };
  }

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

  // Group rooms by provider
  const slackRooms = warRooms.filter(r => r.provider === 'SLACK');
  const teamsRooms = warRooms.filter(r => r.provider === 'MICROSOFT_TEAMS');

  // Integration connectivity
  const hasSlackIntegration = Boolean(
    (incident.service?.slackIntegration?.workspaceId &&
      incident.service?.slackIntegration?.enabled !== false) ||
    globalSlackIntegration?.workspaceId
  );
  const isSlackConnected = hasSlackIntegration && globalPolicy.enabled;
  const isTeamsConnected = Boolean(
    teamsConfig?.enabled && teamsConfig?.warRoomsEnabled && globalPolicy.enabled
  );

  const availableIntegrations: WarRoomProviderName[] = [];
  if (isSlackConnected) availableIntegrations.push('SLACK');
  if (isTeamsConnected) availableIntegrations.push('MICROSOFT_TEAMS');

  // Resolve 4-layer provider policy: Global Default + Service Override + Availability
  const policyResolution = resolveEffectiveWarRoomProviders({
    globalProviders: globalPolicy.defaultProviders,
    serviceProviders: servicePolicy ? servicePolicy.serviceProviders : null,
    availableProviders: availableIntegrations,
    globalWarRoomsEnabled: globalPolicy.enabled,
    serviceWarRoomsEnabled: servicePolicy ? servicePolicy.warRoomsEnabled : true,
  });

  const isSlackDesired = policyResolution.desiredProviders.includes('SLACK');
  const isTeamsDesired = policyResolution.desiredProviders.includes('MICROSOFT_TEAMS');

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

  // Build Slack Provider View
  const latestSlackRoom = slackRooms[0] ?? null;
  const isSlackActiveOrTransitional =
    latestSlackRoom &&
    ['REQUESTED', 'PROVISIONING', 'AMBIGUOUS', 'READY', 'CLOSING'].includes(latestSlackRoom.state);

  const currentSlackRoom = isSlackActiveOrTransitional
    ? mapRoomToView(latestSlackRoom, slackAvailability)
    : null;

  const historicalSlackRooms = latestSlackRoom
    ? (isSlackActiveOrTransitional ? slackRooms.slice(1) : slackRooms).map(mapRoomToHistoryItem)
    : [];

  const slackCanCreate =
    isSlackDesired &&
    deriveProviderCanCreate({
      availability: slackAvailability,
      incidentStatus: incident.status,
      canManage: canManageWarRooms,
      latestRoomState: latestSlackRoom
        ? (latestSlackRoom.state as WarRoomPresentationLifecycle)
        : null,
    });

  // Strict visibility rule for Slack:
  // 1. If desired for service: visible if canCreate OR active room OR historical room exists
  // 2. If NOT desired for service: visible ONLY if an existing or historical room exists
  const isSlackVisible =
    (isSlackDesired &&
      (slackCanCreate || currentSlackRoom !== null || historicalSlackRooms.length > 0)) ||
    slackRooms.length > 0;

  const slackProviderView: IncidentWarRoomProviderView = {
    provider: 'SLACK',
    displayName: PROVIDER_PRESENTATION.SLACK.displayName,
    subtitle: PROVIDER_PRESENTATION.SLACK.subtitle,
    availability: slackAvailability,
    visible: isSlackVisible,
    canCreate: slackCanCreate,
    enabledForService: isSlackDesired,
    destinationAvailable: slackDestinationAvailable,
    unavailableReason: slackUnavailableReason,
    currentRoom: currentSlackRoom,
    historyCount: historicalSlackRooms.length,
    history: historicalSlackRooms,
    supportedOptions: {
      supportsPrivateRooms: false,
    },
  };

  // Build Teams Provider View
  const latestTeamsRoom = teamsRooms[0] ?? null;
  const isTeamsActiveOrTransitional =
    latestTeamsRoom &&
    ['REQUESTED', 'PROVISIONING', 'AMBIGUOUS', 'READY', 'CLOSING'].includes(latestTeamsRoom.state);

  const currentTeamsRoom = isTeamsActiveOrTransitional
    ? mapRoomToView(latestTeamsRoom, teamsAvailability)
    : null;

  const historicalTeamsRooms = latestTeamsRoom
    ? (isTeamsActiveOrTransitional ? teamsRooms.slice(1) : teamsRooms).map(mapRoomToHistoryItem)
    : [];

  const teamsCanCreate =
    isTeamsDesired &&
    deriveProviderCanCreate({
      availability: teamsAvailability,
      incidentStatus: incident.status,
      canManage: canManageWarRooms,
      latestRoomState: latestTeamsRoom
        ? (latestTeamsRoom.state as WarRoomPresentationLifecycle)
        : null,
    });

  // Strict visibility rule for Teams:
  // 1. If desired for service: visible if canCreate OR active room OR historical room exists
  // 2. If NOT desired for service: visible ONLY if an existing or historical room exists
  const isTeamsVisible =
    (isTeamsDesired &&
      (teamsCanCreate || currentTeamsRoom !== null || historicalTeamsRooms.length > 0)) ||
    teamsRooms.length > 0;

  const teamsProviderView: IncidentWarRoomProviderView = {
    provider: 'MICROSOFT_TEAMS',
    displayName: PROVIDER_PRESENTATION.MICROSOFT_TEAMS.displayName,
    subtitle: PROVIDER_PRESENTATION.MICROSOFT_TEAMS.subtitle,
    availability: teamsAvailability,
    visible: isTeamsVisible,
    canCreate: teamsCanCreate,
    enabledForService: isTeamsDesired,
    destinationAvailable: teamsDestinationAvailable,
    unavailableReason: teamsUnavailableReason,
    currentRoom: currentTeamsRoom,
    historyCount: historicalTeamsRooms.length,
    history: historicalTeamsRooms,
    supportedOptions: {
      supportsPrivateRooms: true,
    },
  };

  // Root visibility: visible only if AT LEAST ONE provider is visible
  const isAnyProviderVisible = isSlackVisible || isTeamsVisible;

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
    summary: {
      activeRooms,
      transitioningRooms,
      attentionRequired,
      totalHistoricalRooms: allHistory.length,
    },
    providers: [slackProviderView, teamsProviderView].filter(p => p.visible),
    history: allHistory,
    permissions: {
      canManageWarRooms,
    },
  };
}
