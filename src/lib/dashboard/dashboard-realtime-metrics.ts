import 'server-only';

import type { Prisma } from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { actorMetricReadScope, incidentReadWhere } from '@/lib/authorization-filters';
import { buildIncidentWhere } from '@/lib/dashboard-utils';
import { getCachedOrFetch } from '@/lib/realtime-cache';
import prisma from '@/lib/prisma';

export type DashboardRealtimeMetricFilters = {
  service?: string;
  assignee?: string;
  urgency?: string;
  search?: string;
};

export type DashboardRealtimeMetrics = {
  open: number;
  acknowledged: number;
  active: number;
  snoozed: number;
  suppressed: number;
  unassigned: number;
  highUrgency: number;
};

export async function getDashboardRealtimeMetrics(
  actor: AuthorizationActor,
  filters: DashboardRealtimeMetricFilters,
  generation: string | null
): Promise<DashboardRealtimeMetrics> {
  const authorizationScope = actorMetricReadScope(actor).authorizationScope;
  const scopeKey = authorizationScope
    ? `user:${authorizationScope.actorId}:${[...authorizationScope.teamIds].sort().join(',')}`
    : 'global';
  const filterKey = JSON.stringify({
    service: filters.service,
    assignee: filters.assignee,
    urgency: filters.urgency,
    search: filters.search,
  });
  const key = `dashboard:filtered-metrics:${scopeKey}:${filterKey}:g:${generation ?? 'initial'}`;
  const result = await getCachedOrFetch(key, async () => {
    const selected = buildIncidentWhere(
      {
        service: filters.service,
        assignee: filters.assignee,
        urgency: filters.urgency,
        search: filters.search,
      },
      { includeStatus: false, dateFilter: {} }
    );
    const scope: Prisma.IncidentWhereInput = { AND: [incidentReadWhere(actor), selected] };
    const [groups, unassigned] = await Promise.all([
      prisma.incident.groupBy({
        by: ['status', 'urgency'],
        where: scope,
        _count: { _all: true },
      }),
      prisma.incident.count({
        where: { AND: [scope, { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, assigneeId: null }] },
      }),
    ]);
    const count = (status: string) =>
      groups
        .filter(group => group.status === status)
        .reduce((sum, group) => sum + group._count._all, 0);
    const open = count('OPEN');
    const acknowledged = count('ACKNOWLEDGED');
    return {
      open,
      acknowledged,
      active: open + acknowledged,
      snoozed: count('SNOOZED'),
      suppressed: count('SUPPRESSED'),
      unassigned,
      highUrgency: groups
        .filter(
          group =>
            (group.status === 'OPEN' || group.status === 'ACKNOWLEDGED') && group.urgency === 'HIGH'
        )
        .reduce((sum, group) => sum + group._count._all, 0),
    };
  });
  return result.data;
}
