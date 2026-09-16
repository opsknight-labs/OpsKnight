/**
 * Canonical Incident War Room Provider Policy Resolver (Phase 5A)
 *
 * Implements the 4-layer configuration hierarchy:
 * 1. Global War Rooms enabled & Default Provider Set
 * 2. Provider Integration connectivity & capabilities
 * 3. Service-level provider selection (Inherit, Slack, Teams, Both, Disabled)
 * 4. Destination & Incident-level capability resolution
 *
 * Strict invariant: NO SILENT FALLBACK.
 * If a desired provider is disconnected, it is reported as unavailable rather than
 * silently substituting another provider.
 */

import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type {
  WarRoomProviderName,
  WarRoomProviderSet,
  IncidentMeetingProvider,
  ServiceWarRoomPolicy,
  GlobalWarRoomPolicy,
} from './types';

export const GLOBAL_WAR_ROOM_POLICY_KEY = 'war_room_global_default_providers';
export const GLOBAL_MEETING_POLICY_KEY = 'meeting_global_default_provider';
export const SERVICE_WAR_ROOM_POLICY_PREFIX = 'service_war_room_policy:';

export const ALL_WAR_ROOM_PROVIDERS: WarRoomProviderSet = ['SLACK', 'MICROSOFT_TEAMS'];
export const ALL_MEETING_PROVIDERS: IncidentMeetingProvider[] = [
  'MICROSOFT_TEAMS',
  'ZOOM',
  'GOOGLE_MEET',
  'JITSI',
  'NONE',
];

/**
 * Resolve effective meeting provider deterministically.
 * Pure function with no side effects.
 *
 * Strict invariant: NO SILENT FALLBACK.
 * If Microsoft Teams Meeting is configured but unavailable, report error rather than
 * substituting another provider.
 */
export function resolveEffectiveMeetingProvider(params: {
  globalMeetingProvider: IncidentMeetingProvider;
  serviceMeetingProvider: IncidentMeetingProvider | null;
  isTeamsMeetingAvailable: boolean;
  globalWarRoomsEnabled: boolean;
  serviceWarRoomsEnabled: boolean;
}): {
  effectiveProvider: IncidentMeetingProvider;
  desiredProvider: IncidentMeetingProvider;
  isUnavailable: boolean;
  unavailableReason?: string;
  isDisabled: boolean;
  isInherited: boolean;
} {
  const {
    globalMeetingProvider,
    serviceMeetingProvider,
    isTeamsMeetingAvailable,
    globalWarRoomsEnabled,
    serviceWarRoomsEnabled,
  } = params;

  const isInherited = serviceMeetingProvider === null || serviceMeetingProvider === undefined;
  const desiredProvider: IncidentMeetingProvider = isInherited
    ? globalMeetingProvider
    : serviceMeetingProvider;

  if (!globalWarRoomsEnabled || !serviceWarRoomsEnabled || desiredProvider === 'NONE') {
    return {
      effectiveProvider: 'NONE',
      desiredProvider,
      isUnavailable: false,
      isDisabled: true,
      isInherited,
    };
  }

  if (desiredProvider === 'MICROSOFT_TEAMS') {
    if (!isTeamsMeetingAvailable) {
      return {
        effectiveProvider: 'NONE',
        desiredProvider,
        isUnavailable: true,
        unavailableReason:
          'Microsoft Teams online meetings are not configured or lack Microsoft Graph permissions.',
        isDisabled: false,
        isInherited,
      };
    }
    return {
      effectiveProvider: 'MICROSOFT_TEAMS',
      desiredProvider,
      isUnavailable: false,
      isDisabled: false,
      isInherited,
    };
  }

  // JITSI, ZOOM, GOOGLE_MEET are self-contained or link-based
  return {
    effectiveProvider: desiredProvider,
    desiredProvider,
    isUnavailable: false,
    isDisabled: false,
    isInherited,
  };
}

/**
 * Resolve effective war room providers deterministically.
 * Pure function with no side effects.
 */
export function resolveEffectiveWarRoomProviders(params: {
  globalProviders: WarRoomProviderSet;
  serviceProviders: WarRoomProviderSet | null; // null = inherit global default
  availableProviders: WarRoomProviderSet; // only connected & capable integrations
  globalWarRoomsEnabled: boolean;
  serviceWarRoomsEnabled: boolean;
}): {
  effectiveProviders: WarRoomProviderSet;
  desiredProviders: WarRoomProviderSet;
  unavailableDesiredProviders: WarRoomProviderSet;
  isDisabled: boolean;
  isInherited: boolean;
} {
  const {
    globalProviders,
    serviceProviders,
    availableProviders,
    globalWarRoomsEnabled,
    serviceWarRoomsEnabled,
  } = params;

  const isInherited = serviceProviders === null;
  const desiredProviders: WarRoomProviderSet = isInherited
    ? [...globalProviders]
    : [...serviceProviders];

  // If globally disabled, service disabled, or desired set is empty -> completely disabled
  if (!globalWarRoomsEnabled || !serviceWarRoomsEnabled || desiredProviders.length === 0) {
    return {
      effectiveProviders: [],
      desiredProviders,
      unavailableDesiredProviders: [],
      isDisabled: true,
      isInherited,
    };
  }

  // Intersect desired providers with actually available integrations
  const effectiveProviders = desiredProviders.filter(p => availableProviders.includes(p));
  const unavailableDesiredProviders = desiredProviders.filter(p => !availableProviders.includes(p));

  return {
    effectiveProviders,
    desiredProviders,
    unavailableDesiredProviders,
    isDisabled: false,
    isInherited,
  };
}

/**
 * Fetch global default war room provider policy.
 */
export async function getGlobalWarRoomPolicy(): Promise<GlobalWarRoomPolicy> {
  const [chatOpsConfig, defaultProvidersRow, defaultMeetingRow] = await Promise.all([
    prisma?.chatOpsConfig?.findUnique
      ? prisma.chatOpsConfig
          .findUnique({
            where: { id: 'default' },
            select: { enabled: true, defaultVideoBridge: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    prisma?.systemConfig?.findUnique
      ? prisma.systemConfig
          .findUnique({
            where: { key: GLOBAL_WAR_ROOM_POLICY_KEY },
            select: { value: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    prisma?.systemConfig?.findUnique
      ? prisma.systemConfig
          .findUnique({
            where: { key: GLOBAL_MEETING_POLICY_KEY },
            select: { value: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  let defaultProviders: WarRoomProviderSet = ['SLACK', 'MICROSOFT_TEAMS'];

  if (defaultProvidersRow?.value && Array.isArray(defaultProvidersRow.value)) {
    const valid = (defaultProvidersRow.value as string[]).filter((p): p is WarRoomProviderName =>
      ALL_WAR_ROOM_PROVIDERS.includes(p as WarRoomProviderName)
    );
    if (valid.length > 0) {
      defaultProviders = valid;
    }
  }

  let defaultMeetingProvider: IncidentMeetingProvider = 'JITSI';
  if (
    defaultMeetingRow?.value &&
    typeof defaultMeetingRow.value === 'string' &&
    ALL_MEETING_PROVIDERS.includes(defaultMeetingRow.value as IncidentMeetingProvider)
  ) {
    defaultMeetingProvider = defaultMeetingRow.value as IncidentMeetingProvider;
  } else if (
    chatOpsConfig?.defaultVideoBridge &&
    ALL_MEETING_PROVIDERS.includes(chatOpsConfig.defaultVideoBridge as IncidentMeetingProvider)
  ) {
    defaultMeetingProvider = chatOpsConfig.defaultVideoBridge as IncidentMeetingProvider;
  }

  return {
    enabled: Boolean(chatOpsConfig?.enabled),
    defaultProviders,
    defaultMeetingProvider,
  };
}

/**
 * Set global default war room provider set.
 */
export async function setGlobalDefaultWarRoomProviders(
  providers: WarRoomProviderSet,
  userId?: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma;
  if (!client?.systemConfig?.upsert) return;
  await client.systemConfig.upsert({
    where: { key: GLOBAL_WAR_ROOM_POLICY_KEY },
    create: {
      key: GLOBAL_WAR_ROOM_POLICY_KEY,
      value: providers,
      updatedBy: userId || null,
    },
    update: {
      value: providers,
      updatedBy: userId || null,
    },
  });
}

/**
 * Set global default meeting provider.
 */
export async function setGlobalMeetingProvider(
  meetingProvider: IncidentMeetingProvider,
  userId?: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma;
  if (!client?.systemConfig?.upsert) return;
  await client.systemConfig.upsert({
    where: { key: GLOBAL_MEETING_POLICY_KEY },
    create: {
      key: GLOBAL_MEETING_POLICY_KEY,
      value: meetingProvider,
      updatedBy: userId || null,
    },
    update: {
      value: meetingProvider,
      updatedBy: userId || null,
    },
  });

  if (client?.chatOpsConfig?.update) {
    await client.chatOpsConfig
      .update({
        where: { id: 'default' },
        data: { defaultVideoBridge: meetingProvider },
      })
      .catch(() => null);
  }
}

/**
 * Fetch service-level war room provider policy.
 */
export async function getServiceWarRoomPolicy(serviceId: string): Promise<ServiceWarRoomPolicy> {
  const [service, configRow] = await Promise.all([
    prisma?.service?.findUnique
      ? prisma.service
          .findUnique({
            where: { id: serviceId },
            select: {
              autoCreateWarRoom: true,
              microsoftTeamsWarRoomAutoCreate: true,
              warRoomVideoBridge: true,
            },
          })
          .catch(() => null)
      : Promise.resolve(null),
    prisma?.systemConfig?.findUnique
      ? prisma.systemConfig
          .findUnique({
            where: { key: `${SERVICE_WAR_ROOM_POLICY_PREFIX}${serviceId}` },
            select: { value: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // Default for services is DISABLED - enabling war rooms is on user discretion
  let serviceProviders: WarRoomProviderSet | null = [];
  let meetingProvider: IncidentMeetingProvider | null = null;
  let warRoomsEnabled = false;
  let autoCreate = false;

  if (configRow?.value && typeof configRow.value === 'object' && !Array.isArray(configRow.value)) {
    const val = configRow.value as Record<string, unknown>;
    if (val.serviceProviders === null) {
      serviceProviders = null;
    } else if (Array.isArray(val.serviceProviders)) {
      serviceProviders = (val.serviceProviders as string[]).filter((p): p is WarRoomProviderName =>
        ALL_WAR_ROOM_PROVIDERS.includes(p as WarRoomProviderName)
      );
    }
    if (val.meetingProvider === null) {
      meetingProvider = null;
    } else if (
      typeof val.meetingProvider === 'string' &&
      ALL_MEETING_PROVIDERS.includes(val.meetingProvider as IncidentMeetingProvider)
    ) {
      meetingProvider = val.meetingProvider as IncidentMeetingProvider;
    }
    if (typeof val.warRoomsEnabled === 'boolean') {
      warRoomsEnabled = val.warRoomsEnabled;
    }
    if (typeof val.autoCreate === 'boolean') {
      autoCreate = val.autoCreate;
    }
  } else if (service) {
    // Legacy migration compatibility: If existing service has autoCreate flags true,
    // prevent split-brain where background engines auto-create while UI says Disabled.
    const hasLegacySlack = service.autoCreateWarRoom;
    const hasLegacyTeams = service.microsoftTeamsWarRoomAutoCreate;

    if (hasLegacySlack || hasLegacyTeams) {
      warRoomsEnabled = true;
      autoCreate = true;
      if (hasLegacySlack && hasLegacyTeams) {
        serviceProviders = null; // Inherit global default
      } else if (hasLegacySlack) {
        serviceProviders = ['SLACK'];
      } else {
        serviceProviders = ['MICROSOFT_TEAMS'];
      }
    } else {
      warRoomsEnabled = false;
      autoCreate = false;
      serviceProviders = [];
    }

    if (
      service.warRoomVideoBridge &&
      ALL_MEETING_PROVIDERS.includes(service.warRoomVideoBridge as IncidentMeetingProvider)
    ) {
      meetingProvider = service.warRoomVideoBridge as IncidentMeetingProvider;
    }
  }

  return {
    serviceProviders,
    meetingProvider,
    warRoomsEnabled,
    autoCreate,
  };
}

/**
 * Set service-level war room provider policy.
 */
export async function setServiceWarRoomPolicy(
  serviceId: string,
  policy: {
    serviceProviders: WarRoomProviderSet | null;
    meetingProvider?: IncidentMeetingProvider | null;
    warRoomsEnabled?: boolean;
    autoCreate?: boolean;
  },
  userId?: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma;
  const current = await getServiceWarRoomPolicy(serviceId);
  const updated: ServiceWarRoomPolicy = {
    serviceProviders: policy.serviceProviders,
    meetingProvider:
      policy.meetingProvider !== undefined ? policy.meetingProvider : current.meetingProvider,
    warRoomsEnabled: policy.warRoomsEnabled ?? current.warRoomsEnabled,
    autoCreate: policy.autoCreate ?? current.autoCreate,
  };

  if (client?.systemConfig?.upsert) {
    await client.systemConfig.upsert({
      where: { key: `${SERVICE_WAR_ROOM_POLICY_PREFIX}${serviceId}` },
      create: {
        key: `${SERVICE_WAR_ROOM_POLICY_PREFIX}${serviceId}`,
        value: updated as unknown as object,
        updatedBy: userId || null,
      },
      update: {
        value: updated as unknown as object,
        updatedBy: userId || null,
      },
    });
  }

  // Keep Prisma Service boolean fields synchronized for backward-compatibility
  const isSlackEnabled =
    updated.warRoomsEnabled &&
    (updated.serviceProviders === null || updated.serviceProviders.includes('SLACK'));
  const isTeamsEnabled =
    updated.warRoomsEnabled &&
    (updated.serviceProviders === null || updated.serviceProviders.includes('MICROSOFT_TEAMS'));

  if (client?.service?.update) {
    await client.service
      .update({
        where: { id: serviceId },
        data: {
          autoCreateWarRoom: updated.autoCreate && isSlackEnabled,
          microsoftTeamsWarRoomAutoCreate: updated.autoCreate && isTeamsEnabled,
          ...(updated.meetingProvider !== undefined
            ? { warRoomVideoBridge: updated.meetingProvider }
            : {}),
        },
      })
      .catch(() => null);
  }
}
