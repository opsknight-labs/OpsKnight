import 'server-only';

import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  getRequestActorContext,
  type AuthenticatedRequestActorContext,
} from '@/lib/request-actor-context';
import { resolveAccessContext, type AccessContext } from '@/lib/access-context';
import { logger } from '@/lib/logger';

export type AppShellContext = {
  user: {
    id: string;
    name: string | null;
    email: string;
    role: string;
    avatarUrl: string | null;
    gender: string | null;
    timeZone: string | null;
    tokenVersion: number;
  };
  incidentCounts: {
    high: number;
    medium: number;
    low: number;
    active: number;
  };
  statusPages: Array<{
    id: string;
    name: string;
    slug: string | null;
    isDefault: boolean;
  }>;
  isStatusPageAdmin: boolean;
  accessContext: AccessContext;
  systemStatus: 'neutral' | 'ok' | 'warning' | 'danger';
  statusLabel: string;
  statusDetail: string;
  incidentCountsUnavailable?: boolean;
  accessContextUnavailable?: boolean;
};

/** Canonical actor-scoped server read model for authenticated application chrome. */
export async function getAppShellContext(
  requestContext?: AuthenticatedRequestActorContext | null
): Promise<AppShellContext | null> {
  const context = requestContext ?? (await getRequestActorContext());
  if (!context) return null;

  // Run shell dependencies independently with graceful degradation
  const [urgencyResult, statusPagesResult, accessContextResult] = await Promise.allSettled([
    prisma.incident.groupBy({
      by: ['urgency'],
      where: {
        AND: [incidentReadWhere(context.actor), { status: { in: activeIncidentStatuses() } }],
      },
      _count: { _all: true },
    }),
    prisma.statusPage.findMany({
      where: { enabled: true },
      select: { id: true, name: true, slug: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
    resolveAccessContext(context.actor),
  ]);

  let statusPages: AppShellContext['statusPages'] = [];
  if (statusPagesResult.status === 'fulfilled') {
    statusPages = statusPagesResult.value;
  } else {
    logger.warn('[App Shell] Failed to load status pages, degrading to empty list', {
      error: statusPagesResult.reason,
    });
  }

  let accessContext: AccessContext = {
    mode: 'NONE',
    canOperate: false,
    teamCount: 0,
    serviceCount: 0,
    incidentCount: 0,
  };
  let accessContextUnavailable = false;
  if (accessContextResult.status === 'fulfilled') {
    accessContext = accessContextResult.value;
  } else {
    accessContextUnavailable = true;
    logger.warn('[App Shell] Failed to resolve access context, degrading to default mode', {
      error: accessContextResult.reason,
    });
  }

  let high = 0;
  let medium = 0;
  let low = 0;
  let incidentCountsUnavailable = false;

  if (urgencyResult.status === 'fulfilled') {
    for (const entry of urgencyResult.value) {
      if (entry.urgency === 'HIGH') high = entry._count._all;
      else if (entry.urgency === 'MEDIUM') medium = entry._count._all;
      else if (entry.urgency === 'LOW') low = entry._count._all;
    }
  } else {
    incidentCountsUnavailable = true;
    logger.warn('[App Shell] Failed to load incident counts, degrading to unavailable', {
      error: urgencyResult.reason,
    });
  }

  const active = high + medium + low;
  let systemStatus: AppShellContext['systemStatus'] = 'ok';
  let statusLabel = 'Green Corridor';
  let statusDetail = 'All systems fully operational';

  if (incidentCountsUnavailable || accessContextUnavailable) {
    systemStatus = 'neutral';
    statusLabel = accessContextUnavailable ? 'Scope Unavailable' : 'Metrics Unavailable';
    statusDetail = accessContextUnavailable
      ? 'Operational scope temporarily unavailable'
      : 'Operational status temporarily unavailable';
  } else if (accessContext.mode === 'NONE') {
    systemStatus = 'neutral';
    statusLabel = 'No operational scope';
    statusDetail = 'Join a team or receive an incident assignment to see operational status';
  } else if (accessContext.mode === 'SCOPED') {
    statusLabel = 'Your scope is clear';
    statusDetail = 'No active incidents in your operational scope';
  }

  if (
    !incidentCountsUnavailable &&
    !accessContextUnavailable &&
    accessContext.mode !== 'NONE' &&
    high > 0
  ) {
    systemStatus = 'danger';
    statusLabel = 'Red Alert';
    statusDetail = `${high} critical incident${high === 1 ? '' : 's'} active`;
  } else if (
    !incidentCountsUnavailable &&
    !accessContextUnavailable &&
    accessContext.mode !== 'NONE' &&
    medium > 0
  ) {
    systemStatus = 'warning';
    statusLabel = 'Yellow Alert';
    statusDetail = `${medium} warning sign${medium === 1 ? '' : 's'} detected`;
  } else if (
    !incidentCountsUnavailable &&
    !accessContextUnavailable &&
    accessContext.mode !== 'NONE' &&
    low > 0
  ) {
    statusLabel = 'Systems Normal';
    statusDetail = `${low} low urgency item${low === 1 ? '' : 's'}`;
  }

  return {
    user: {
      id: context.user.id,
      name: context.user.name,
      email: context.user.email,
      role: context.user.role,
      avatarUrl: context.user.avatarUrl,
      gender: context.user.gender,
      timeZone: context.user.timeZone,
      tokenVersion: context.user.tokenVersion,
    },
    incidentCounts: { high, medium, low, active },
    statusPages,
    isStatusPageAdmin: hasCapability(context.actor.role, CAPABILITIES.ADMIN_MANAGE),
    accessContext,
    systemStatus,
    statusLabel,
    statusDetail,
    incidentCountsUnavailable,
    accessContextUnavailable,
  };
}
