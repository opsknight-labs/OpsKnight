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
};

/** Canonical actor-scoped server read model for authenticated application chrome. */
export async function getAppShellContext(
  requestContext?: AuthenticatedRequestActorContext | null
): Promise<AppShellContext | null> {
  const context = requestContext ?? (await getRequestActorContext());
  if (!context) return null;

  const [urgencyCounts, statusPages, accessContext] = await Promise.all([
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

  let high = 0;
  let medium = 0;
  let low = 0;
  for (const entry of urgencyCounts) {
    if (entry.urgency === 'HIGH') high = entry._count._all;
    else if (entry.urgency === 'MEDIUM') medium = entry._count._all;
    else if (entry.urgency === 'LOW') low = entry._count._all;
  }

  const active = high + medium + low;
  let systemStatus: AppShellContext['systemStatus'] = 'ok';
  let statusLabel = 'Green Corridor';
  let statusDetail = 'All systems fully operational';

  if (accessContext.mode === 'NONE') {
    systemStatus = 'neutral';
    statusLabel = 'No operational scope';
    statusDetail = 'Join a team or receive an incident assignment to see operational status';
  } else if (accessContext.mode === 'SCOPED') {
    statusLabel = 'Your scope is clear';
    statusDetail = 'No active incidents in your operational scope';
  }

  if (accessContext.mode !== 'NONE' && high > 0) {
    systemStatus = 'danger';
    statusLabel = 'Red Alert';
    statusDetail = `${high} critical incident${high === 1 ? '' : 's'} active`;
  } else if (accessContext.mode !== 'NONE' && medium > 0) {
    systemStatus = 'warning';
    statusLabel = 'Yellow Alert';
    statusDetail = `${medium} warning sign${medium === 1 ? '' : 's'} detected`;
  } else if (accessContext.mode !== 'NONE' && low > 0) {
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
  };
}
