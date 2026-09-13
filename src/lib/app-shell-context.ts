import 'server-only';

import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { activeIncidentStatuses } from '@/lib/incident-status';

export type AppShellContext = {
  user: {
    id: string;
    name: string | null;
    email: string;
    role: string;
    avatarUrl: string | null;
    gender: string | null;
    timeZone: string | null;
  };
  incidentCounts: {
    high: number;
    medium: number;
    low: number;
    active: number;
  };
  systemStatus: 'ok' | 'warning' | 'danger';
  statusLabel: string;
  statusDetail: string;
};

/**
 * Canonical server read model for authenticated application chrome.
 * Both desktop and mobile presentations must consume the same actor-filtered
 * incident status semantics instead of independently issuing unscoped counts.
 */
export async function getAppShellContext(email: string): Promise<AppShellContext | null> {
  const [user, actor] = await Promise.all([
    prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        gender: true,
        timeZone: true,
      },
    }),
    getCurrentAuthorizationActor(),
  ]);

  if (!user) return null;

  const urgencyCounts = await prisma.incident.groupBy({
    by: ['urgency'],
    where: {
      AND: [incidentReadWhere(actor), { status: { in: activeIncidentStatuses() } }],
    },
    _count: { _all: true },
  });

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

  if (high > 0) {
    systemStatus = 'danger';
    statusLabel = 'Red Alert';
    statusDetail = `${high} critical incident${high === 1 ? '' : 's'} active`;
  } else if (medium > 0) {
    systemStatus = 'warning';
    statusLabel = 'Yellow Alert';
    statusDetail = `${medium} warning sign${medium === 1 ? '' : 's'} detected`;
  } else if (low > 0) {
    statusLabel = 'Systems Normal';
    statusDetail = `${low} low urgency item${low === 1 ? '' : 's'}`;
  }

  return {
    user,
    incidentCounts: { high, medium, low, active },
    systemStatus,
    statusLabel,
    statusDetail,
  };
}
