import prisma from '@/lib/prisma';
import { calculateSLAMetrics, type SLAMetricsFilter } from '@/lib/sla-server';
import type { SLAMetrics as SLAServerMetrics } from '@/lib/sla';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import type { Prisma } from '@prisma/client';
import { compileIncidentMetricFilter } from '@/lib/metrics/domain/filter';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { resolveSlaTarget } from '@/lib/metrics/domain/sla-target';
import { effectiveElapsedMs } from '@/lib/metrics/domain/sla-clock';

/**
 * Centralized Widget Data Provider
 * Single source of truth: Delegates ALL metric calculations to sla-server
 * This provider only handles data transformation and context-specific filtering
 */

export interface ActiveIncidentData {
  id: string;
  title: string;
  status: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  createdAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  serviceId: string;
  serviceName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  slaAckDeadline: Date | null;
  slaResolveDeadline: Date | null;
}

export interface OnCallStatus {
  isOnCall: boolean;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  assignedIncidents: number;
}

export interface SLAMetrics {
  mtta: number | null; // minutes
  mttr: number | null; // minutes
  ackCompliance: number | null; // percentage
  resolveCompliance: number | null; // percentage
  trendMtta: 'up' | 'down' | 'stable';
  trendMttr: 'up' | 'down' | 'stable';
}

export interface ServiceHealthData {
  id: string;
  name: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE' | 'MAINTENANCE';
  activeIncidents: number;
  criticalIncidents: number;
}

export interface ActivityEvent {
  id: string;
  message: string;
  timestamp: Date;
  incidentId: string;
}

export interface WorkloadData {
  userId: string;
  userName: string;
  activeIncidents: number;
  criticalIncidents: number;
  isOnCall: boolean;
  isOverloaded: boolean;
}

export interface WidgetDataContext {
  activeIncidents: ActiveIncidentData[];
  slaBreachAlerts: ActiveIncidentData[]; // Incidents close to SLA breach
  userOnCall: OnCallStatus;
  slaMetrics: SLAMetrics;
  serviceHealth: ServiceHealthData[];
  recentActivity: ActivityEvent[];
  teamWorkload: WorkloadData[];
  lastUpdated: Date;
}

export type WidgetRealtimeProjection = Pick<
  WidgetDataContext,
  'activeIncidents' | 'slaBreachAlerts' | 'lastUpdated'
>;

// Threshold for overload detection (configurable)
const OVERLOAD_THRESHOLD = 5;

// SLA breach alert windows (in milliseconds)
const ACK_BREACH_ALERT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RESOLVE_BREACH_ALERT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Lightweight realtime projection. Historical SLA rates and trends belong to
 * the page/snapshot path; an SSE heartbeat must never recompute them.
 */
export async function getWidgetRealtimeProjection(
  filters: SLAMetricsFilter = {}
): Promise<WidgetRealtimeProjection> {
  const now = new Date();
  const where = compileIncidentMetricFilter({ ...filters, status: undefined }).prisma;
  const incidents = await prisma.incident.findMany({
    where: { AND: [where, { status: { in: activeIncidentStatuses() } }] },
    orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      urgency: true,
      createdAt: true,
      acknowledgedAt: true,
      serviceId: true,
      assigneeId: true,
      priority: true,
      slaAckTargetMs: true,
      slaResolveTargetMs: true,
      slaPauses: { select: { startedAt: true, endedAt: true } },
      service: {
        select: { name: true, targetAckMinutes: true, targetResolveMinutes: true },
      },
    },
  });
  const activeIncidents: ActiveIncidentData[] = incidents.map(incident => {
    const target = resolveSlaTarget({
      incidentTargets: {
        ackTargetMs: incident.slaAckTargetMs,
        resolveTargetMs: incident.slaResolveTargetMs,
      },
      priority: incident.priority,
      serviceTargets: {
        ackMinutes: incident.service.targetAckMinutes,
        resolveMinutes: incident.service.targetResolveMinutes,
      },
    });
    const elapsed = effectiveElapsedMs({
      startedAt: incident.createdAt,
      evaluationAt: now,
      pauses: incident.slaPauses,
    });
    return {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      urgency: incident.urgency,
      createdAt: incident.createdAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: null,
      serviceId: incident.serviceId,
      serviceName: incident.service.name,
      assigneeId: incident.assigneeId,
      assigneeName: null,
      slaAckDeadline: incident.acknowledgedAt
        ? null
        : new Date(now.getTime() + Math.max(0, target.ackTargetMs - elapsed)),
      slaResolveDeadline: new Date(now.getTime() + Math.max(0, target.resolveTargetMs - elapsed)),
    };
  });
  const slaBreachAlerts = activeIncidents.filter(incident => {
    const ackRemaining = incident.slaAckDeadline
      ? incident.slaAckDeadline.getTime() - now.getTime()
      : Number.POSITIVE_INFINITY;
    const resolveRemaining = incident.slaResolveDeadline
      ? incident.slaResolveDeadline.getTime() - now.getTime()
      : Number.POSITIVE_INFINITY;
    return (
      ackRemaining <= ACK_BREACH_ALERT_WINDOW_MS ||
      resolveRemaining <= RESOLVE_BREACH_ALERT_WINDOW_MS
    );
  });
  return { activeIncidents, slaBreachAlerts, lastUpdated: now };
}

export function buildWidgetActivityIncidentWhere(
  filters: SLAMetricsFilter
): Prisma.IncidentWhereInput | undefined {
  const activityScope: Prisma.IncidentWhereInput[] = [];
  if (filters.serviceId) {
    activityScope.push({
      serviceId: Array.isArray(filters.serviceId) ? { in: filters.serviceId } : filters.serviceId,
    });
  }
  if (filters.teamId) {
    const teamIds = Array.isArray(filters.teamId) ? filters.teamId : [filters.teamId];
    activityScope.push(
      filters.useOrScope
        ? {
            OR: [{ teamId: { in: teamIds } }, { service: { teamId: { in: teamIds } } }],
          }
        : { service: { teamId: { in: teamIds } } }
    );
  }
  return activityScope.length === 0
    ? undefined
    : activityScope.length === 1
      ? activityScope[0]
      : { AND: activityScope };
}

/**
 * Determines trend direction based on current and previous values
 * Lower is better for response times, so 'down' is positive
 */
function determineTrend(current: number | null, previous: number | null): 'up' | 'down' | 'stable' {
  if (current === null || previous === null) return 'stable';
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 'stable';
  if (previous === 0 && current === 0) return 'stable';
  if (previous === 0) return current > 0 ? 'up' : 'stable';

  const threshold = 0.05; // 5% change threshold for stability
  const change = (current - previous) / previous;

  if (Math.abs(change) < threshold) return 'stable';
  return change < 0 ? 'down' : 'up';
}

/**
 * Get all widget data using sla-server as the single source of truth
 * This function delegates all metric calculations to calculateSLAMetrics
 */
export async function getWidgetData(
  userId: string,
  _userRole: string,
  filters: SLAMetricsFilter = {},
  providedSlaMetrics?: any
): Promise<WidgetDataContext> {
  const now = new Date();

  const metricsFilters: SLAMetricsFilter = {
    ...filters,
    includeIncidents: true,
    includeActiveIncidents: true,
    incidentLimit: 100,
  };

  if (!metricsFilters.startDate && !metricsFilters.includeAllTime && !metricsFilters.windowDays) {
    metricsFilters.windowDays = 7;
  }

  // Single source of truth: Get ALL metrics from sla-server (or use pre-resolved metrics)
  const slaMetricsRaw: SLAServerMetrics =
    providedSlaMetrics || (await calculateSLAMetrics(metricsFilters));

  // Transform sla-server data to widget format
  // Active incidents from recentIncidents that aren't resolved
  const activeIncidentsData: ActiveIncidentData[] = (
    slaMetricsRaw.activeIncidentSummaries || []
  ).map(inc => {
    const slaAckDeadline = inc.slaAckDeadline ? new Date(inc.slaAckDeadline) : null;
    const slaResolveDeadline = new Date(inc.slaResolveDeadline);

    return {
      id: inc.id,
      title: inc.title,
      status: inc.status,
      urgency: inc.urgency as 'HIGH' | 'MEDIUM' | 'LOW',
      createdAt: new Date(inc.createdAt),
      acknowledgedAt: inc.acknowledgedAt ? new Date(inc.acknowledgedAt) : null,
      resolvedAt: null,
      serviceId: inc.serviceId,
      serviceName: inc.serviceName,
      assigneeId: inc.assigneeId,
      assigneeName: null,
      slaAckDeadline,
      slaResolveDeadline,
    };
  });

  // Identify SLA breach alerts using calculated deadlines
  // SAFETY: Explicitly filter out resolved incidents to prevent false alerts
  const slaBreachAlerts = activeIncidentsData.filter(inc => {
    if (inc.status === 'RESOLVED' || inc.resolvedAt) return false;

    const nowMs = now.getTime();

    // Check ACK breach alert (imminent or already breached)
    if (inc.slaAckDeadline && inc.status === 'OPEN' && !inc.acknowledgedAt) {
      const timeToAckBreach = inc.slaAckDeadline.getTime() - nowMs;
      if (timeToAckBreach <= ACK_BREACH_ALERT_WINDOW_MS) {
        return true;
      }
    }

    // Check Resolve breach alert (imminent or already breached)
    if (inc.slaResolveDeadline && !inc.resolvedAt) {
      const timeToResolveBreach = inc.slaResolveDeadline.getTime() - nowMs;
      if (timeToResolveBreach <= RESOLVE_BREACH_ALERT_WINDOW_MS) {
        return true;
      }
    }

    return false;
  });

  // Query dynamic on-call shifts for user's active status
  const activeShifts = await getActiveOnCallShifts(now);
  const userOnCallShift = activeShifts.find(s => s.userId === userId);

  const userAssignedCount = activeIncidentsData.filter(i => i.assigneeId === userId).length;

  const userOnCall: OnCallStatus = userOnCallShift
    ? {
        isOnCall: true,
        shiftStart: userOnCallShift.start,
        shiftEnd: userOnCallShift.end,
        assignedIncidents: userAssignedCount,
      }
    : {
        isOnCall: false,
        shiftStart: null,
        shiftEnd: null,
        assignedIncidents: userAssignedCount,
      };

  // SLA metrics directly from sla-server (single source of truth)
  const currentMtta = slaMetricsRaw.mttd;
  const prevMtta = slaMetricsRaw.previousPeriod?.mtta ?? null;
  const currentMttr = slaMetricsRaw.mttr;
  const prevMttr = slaMetricsRaw.previousPeriod?.mttr ?? null;

  const slaMetrics: SLAMetrics = {
    mtta: currentMtta,
    mttr: currentMttr,
    ackCompliance: slaMetricsRaw.ackCompliance ?? null,
    resolveCompliance: slaMetricsRaw.resolveCompliance ?? null,
    trendMtta: determineTrend(currentMtta, prevMtta),
    trendMttr: determineTrend(currentMttr, prevMttr),
  };

  // Service health directly from sla-server serviceMetrics (single source of truth)
  const serviceHealth: ServiceHealthData[] = slaMetricsRaw.serviceMetrics.map(service => ({
    id: service.id,
    name: service.name,
    status: service.dynamicStatus as
      | 'OPERATIONAL'
      | 'DEGRADED'
      | 'PARTIAL_OUTAGE'
      | 'MAJOR_OUTAGE'
      | 'MAINTENANCE',
    activeIncidents: service.activeCount ?? 0,
    criticalIncidents: service.criticalCount ?? 0,
  }));

  // Recent activity from IncidentEvents (minimal query, sla-server doesn't include this)
  const activityIncidentWhere = buildWidgetActivityIncidentWhere(filters);
  const recentIncidentEvents = await prisma.incidentEvent.findMany({
    ...(activityIncidentWhere ? { where: { incident: activityIncidentWhere } } : {}),
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      message: true,
      createdAt: true,
      incidentId: true,
    },
  });

  const recentActivity: ActivityEvent[] = recentIncidentEvents.map(event => ({
    id: event.id,
    message: event.message,
    timestamp: event.createdAt,
    incidentId: event.incidentId,
  }));

  // Team workload from sla-server assigneeLoad (single source of truth)
  // Note: onCallLoad has different structure (id, name, hoursMs, incidentCount)
  const teamWorkload: WorkloadData[] = slaMetricsRaw.assigneeLoad.map(assignee => {
    // Check if user is in onCallLoad (means they have on-call hours)
    const onCallEntry = slaMetricsRaw.onCallLoad?.find(oc => oc.id === assignee.id);
    const isOnCall = (onCallEntry?.hoursMs ?? 0) > 0;

    // Get critical count from active incidents
    const criticalCount = activeIncidentsData.filter(
      i => i.assigneeId === assignee.id && i.urgency === 'HIGH'
    ).length;

    return {
      userId: assignee.id,
      userName: assignee.name || 'Unknown',
      activeIncidents: assignee.count,
      criticalIncidents: criticalCount,
      isOnCall,
      isOverloaded: assignee.count > OVERLOAD_THRESHOLD,
    };
  });

  // Add on-call users who may not have assigned incidents
  const onCallUserIds = new Set(teamWorkload.map(w => w.userId));
  const additionalOnCallUsers: WorkloadData[] = (slaMetricsRaw.onCallLoad || [])
    .filter(oc => (oc.hoursMs ?? 0) > 0 && !onCallUserIds.has(oc.id))
    .map(oc => ({
      userId: oc.id,
      userName: oc.name || 'Unknown',
      activeIncidents: 0,
      criticalIncidents: 0,
      isOnCall: true,
      isOverloaded: false,
    }));

  const combinedWorkload = [...teamWorkload, ...additionalOnCallUsers]
    .filter(w => w.activeIncidents > 0 || w.isOnCall)
    .sort((a, b) => b.activeIncidents - a.activeIncidents);

  return {
    activeIncidents: activeIncidentsData,
    slaBreachAlerts,
    userOnCall,
    slaMetrics,
    serviceHealth,
    recentActivity,
    teamWorkload: combinedWorkload,
    lastUpdated: now,
  };
}
