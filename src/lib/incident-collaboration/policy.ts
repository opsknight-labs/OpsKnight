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
  ServiceWarRoomPolicy,
  GlobalWarRoomPolicy,
} from './types';

export const GLOBAL_WAR_ROOM_POLICY_KEY = 'war_room_global_default_providers';
export const SERVICE_WAR_ROOM_POLICY_PREFIX = 'service_war_room_policy:';

export const ALL_WAR_ROOM_PROVIDERS: WarRoomProviderSet = ['SLACK', 'MICROSOFT_TEAMS'];

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
  const [chatOpsConfig, defaultProvidersRow] = await Promise.all([
    prisma.chatOpsConfig
      .findUnique({
        where: { id: 'default' },
        select: { enabled: true },
      })
      .catch(() => null),
    prisma.systemConfig
      .findUnique({
        where: { key: GLOBAL_WAR_ROOM_POLICY_KEY },
        select: { value: true },
      })
      .catch(() => null),
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

  return {
    enabled: Boolean(chatOpsConfig?.enabled),
    defaultProviders,
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
 * Fetch service-level war room provider policy.
 */
export async function getServiceWarRoomPolicy(serviceId: string): Promise<ServiceWarRoomPolicy> {
  const [service, configRow] = await Promise.all([
    prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        autoCreateWarRoom: true,
        microsoftTeamsWarRoomAutoCreate: true,
      },
    }),
    prisma.systemConfig
      .findUnique({
        where: { key: `${SERVICE_WAR_ROOM_POLICY_PREFIX}${serviceId}` },
        select: { value: true },
      })
      .catch(() => null),
  ]);

  let serviceProviders: WarRoomProviderSet | null = null;
  let warRoomsEnabled = true;
  let autoCreate = Boolean(service?.autoCreateWarRoom ?? true);

  if (configRow?.value && typeof configRow.value === 'object' && !Array.isArray(configRow.value)) {
    const val = configRow.value as Record<string, unknown>;
    if (val.serviceProviders === null) {
      serviceProviders = null;
    } else if (Array.isArray(val.serviceProviders)) {
      serviceProviders = (val.serviceProviders as string[]).filter((p): p is WarRoomProviderName =>
        ALL_WAR_ROOM_PROVIDERS.includes(p as WarRoomProviderName)
      );
    }
    if (typeof val.warRoomsEnabled === 'boolean') {
      warRoomsEnabled = val.warRoomsEnabled;
    }
    if (typeof val.autoCreate === 'boolean') {
      autoCreate = val.autoCreate;
    }
  }

  return {
    serviceProviders,
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
    warRoomsEnabled: policy.warRoomsEnabled ?? current.warRoomsEnabled,
    autoCreate: policy.autoCreate ?? current.autoCreate,
  };

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

  // Keep Prisma Service boolean fields synchronized for backward-compatibility
  const isSlackEnabled =
    updated.warRoomsEnabled &&
    (updated.serviceProviders === null || updated.serviceProviders.includes('SLACK'));
  const isTeamsEnabled =
    updated.warRoomsEnabled &&
    (updated.serviceProviders === null || updated.serviceProviders.includes('MICROSOFT_TEAMS'));

  await client.service
    .update({
      where: { id: serviceId },
      data: {
        autoCreateWarRoom: updated.autoCreate && isSlackEnabled,
        microsoftTeamsWarRoomAutoCreate: updated.autoCreate && isTeamsEnabled,
      },
    })
    .catch(() => null);
}
