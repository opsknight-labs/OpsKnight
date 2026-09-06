import 'server-only';

import type { IncidentStatus, IncidentUrgency, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { actorMetricReadScope, incidentReadWhere } from '@/lib/authorization-filters';
import {
  buildIncidentOrderBy,
  buildIncidentWhere,
  buildRetainedDateFilter,
  type DashboardFilters,
} from '@/lib/dashboard-utils';
import { getCachedDashboardMetrics } from '@/lib/realtime-cache';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { getRetentionPolicy } from '@/lib/retention-policy';
import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import type { IncidentListItem } from '@/types/incident-list';
import { getWidgetRealtimeProjection } from '@/lib/widget-data-provider';

const PREVIEW_LIMIT = 20;
const RECENT_LIMIT = 15;
const FOCUS_LIMIT = 5;

const incidentSelect = {
  id: true,
  title: true,
  status: true,
  urgency: true,
  priority: true,
  createdAt: true,
  assigneeId: true,
  teamId: true,
  escalationStatus: true,
  currentEscalationStep: true,
  nextEscalationAt: true,
  service: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  assignee: {
    select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
  },
} satisfies Prisma.IncidentSelect;

export type DashboardOperationalSnapshot = {
  open: number;
  acknowledged: number;
  active: number;
  snoozed: number;
  suppressed: number;
  unassigned: number;
  critical: number;
  resolvedInRange: number;
  totalInRange: number;
  previewIncidents: IncidentListItem[];
  recentIncidents: IncidentListItem[];
  criticalFocus: Array<{ id: string; title: string; status: string; urgency: string; priority: string | null; createdAt: Date }>;
  myQueue: Array<{ id: string; title: string; status: string; urgency: string; priority: string | null; createdAt: Date }>;
  myQueueCount: number;
  currentShifts: Awaited<ReturnType<typeof getActiveOnCallShifts>>;
  slaBreachAlerts: Awaited<ReturnType<typeof getWidgetRealtimeProjection>>['slaBreachAlerts'];
  serviceLoads: Array<{ serviceId: string; activeCount: number; criticalCount: number }>;
  retentionDays: number;
  isClipped: boolean;
  effectiveStart: Date;
  effectiveEnd: Date;
  asOf: string;
};

export async function getDashboardOperationalSnapshot(
  actor: AuthorizationActor,
  filters: DashboardFilters,
  sortBy?: string,
  sortOrder: 'asc' | 'desc' = 'desc'
): Promise<DashboardOperationalSnapshot> {
  const startedAt = Date.now();
  const dateFilter = await buildRetainedDateFilter(filters.range, filters.customStart, filters.customEnd);
  const access = incidentReadWhere(actor);
  const selected = buildIncidentWhere(filters, { dateFilter: dateFilter.where });
  const periodWhere: Prisma.IncidentWhereInput = { AND: [access, selected] };
  const currentFilter = {
    serviceId: filters.service,
    assigneeId: filters.assignee === '' ? null : filters.assignee,
    urgency: filters.urgency as 'HIGH' | 'MEDIUM' | 'LOW' | undefined,
  };
  const currentScope = buildIncidentWhere(filters, {
    includeStatus: false,
    dateFilter: {},
  });
  delete currentScope.createdAt;
  const currentWhere: Prisma.IncidentWhereInput = { AND: [access, currentScope] };
  const [
    currentMetrics,
    preview,
    recent,
    totalInRange,
    resolvedInRange,
    criticalFocus,
    myQueue,
    myQueueCount,
    currentShifts,
    widgetProjection,
    serviceGroups,
    retention,
  ] = await Promise.all([
    getCachedDashboardMetrics(actor.id, actor.role, [...actor.teamIds], undefined, null, currentFilter),
    prisma.incident.findMany({ where: periodWhere, select: incidentSelect, orderBy: buildIncidentOrderBy(sortBy, sortOrder), take: PREVIEW_LIMIT }),
    prisma.incident.findMany({ where: periodWhere, select: incidentSelect, orderBy: { createdAt: 'desc' }, take: RECENT_LIMIT }),
    prisma.incident.count({ where: periodWhere }),
    prisma.incident.count({ where: { AND: [periodWhere, { status: 'RESOLVED' }] } }),
    prisma.incident.findMany({
      where: { AND: [currentWhere, { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, OR: [{ urgency: 'HIGH' }, { priority: 'P1' }] }] },
      select: { id: true, title: true, status: true, urgency: true, priority: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: FOCUS_LIMIT,
    }),
    prisma.incident.findMany({
      where: { AND: [currentWhere, { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, assigneeId: actor.id }] },
      select: { id: true, title: true, status: true, urgency: true, priority: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: FOCUS_LIMIT,
    }),
    prisma.incident.count({ where: { AND: [currentWhere, { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, assigneeId: actor.id }] } }),
    getActiveOnCallShifts(new Date()),
    getWidgetRealtimeProjection({ ...currentFilter, ...actorMetricReadScope(actor) }),
    prisma.incident.groupBy({
      by: ['serviceId', 'urgency'],
      where: { AND: [currentWhere, { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }] },
      _count: { _all: true },
    }),
    getRetentionPolicy(),
  ]);
  if (!currentMetrics) throw new Error('Operational dashboard projection unavailable');
  const metrics = currentMetrics.data;
  observeOperationalHistogram('opsknight_dashboard_shell_duration_seconds', (Date.now() - startedAt) / 1000);
  const toListItem = (incident: (typeof preview)[number]): IncidentListItem => ({
    ...incident,
    status: incident.status as IncidentStatus,
    urgency: incident.urgency as IncidentUrgency,
  });
  return {
    open: metrics.open,
    acknowledged: metrics.acknowledged,
    active: metrics.active,
    snoozed: metrics.snoozed,
    suppressed: metrics.suppressed,
    unassigned: metrics.unassigned,
    critical: metrics.critical,
    resolvedInRange,
    totalInRange,
    previewIncidents: preview.map(toListItem),
    recentIncidents: recent.map(toListItem),
    criticalFocus,
    myQueue,
    myQueueCount,
    currentShifts,
    slaBreachAlerts: widgetProjection.slaBreachAlerts,
    serviceLoads: [...new Set(serviceGroups.map(group => group.serviceId))].map(serviceId => ({
      serviceId,
      activeCount: serviceGroups
        .filter(group => group.serviceId === serviceId)
        .reduce((sum, group) => sum + group._count._all, 0),
      criticalCount: serviceGroups
        .filter(group => group.serviceId === serviceId && group.urgency === 'HIGH')
        .reduce((sum, group) => sum + group._count._all, 0),
    })),
    retentionDays: retention.incidentRetentionDays,
    isClipped: dateFilter.window.isClipped,
    effectiveStart: dateFilter.window.start,
    effectiveEnd: dateFilter.window.end,
    asOf: new Date().toISOString(),
  };
}
