import prisma from '@/lib/prisma';
import { calculateSLAMetrics } from '@/lib/sla-server';
import type { SLAMetricsFilter } from '@/lib/sla-server';
import type { SLAMetrics as SLAServerMetrics } from '@/lib/sla';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';

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
  mtta: number; // minutes
  mttr: number; // minutes
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

// Threshold for overload detection (configurable)
const OVERLOAD_THRESHOLD = 5;

// SLA breach alert windows (in milliseconds)
const ACK_BREACH_ALERT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RESOLVE_BREACH_ALERT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Determines trend direction based on current and previous values
 * Lower is better for response times, so 'down' is positive
 */
function determineTrend(current: number, previous: number): 'up' | 'down' | 'stable' {
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
    const slaAckDeadline =
      inc.status !== 'ACKNOWLEDGED'
        ? new Date(new Date(inc.createdAt).getTime() + inc.targetAckMinutes * 60000)
        : null;

    const slaResolveDeadline = new Date(
      new Date(inc.createdAt).getTime() + inc.targetResolveMinutes * 60000
    );

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
  const currentMtta = slaMetricsRaw.mttd ?? 0;
  const prevMtta = slaMetricsRaw.previousPeriod?.mtta ?? 0;
  const currentMttr = slaMetricsRaw.mttr ?? 0;
  const prevMttr = slaMetricsRaw.previousPeriod?.mttr ?? 0;

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
  const activityIncidentWhere = filters.serviceId
    ? {
        serviceId: Array.isArray(filters.serviceId)
          ? { in: filters.serviceId }
          : filters.serviceId,
      }
    : filters.teamId
      ? filters.useOrScope
        ? {
            OR: [
              {
                teamId: {
                  in: Array.isArray(filters.teamId) ? filters.teamId : [filters.teamId],
                },
              },
              {
                service: {
                  teamId: {
                    in: Array.isArray(filters.teamId) ? filters.teamId : [filters.teamId],
                  },
                },
              },
            ],
          }
        : {
            service: {
              teamId: {
                in: Array.isArray(filters.teamId) ? filters.teamId : [filters.teamId],
              },
            },
          }
      : undefined;
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
