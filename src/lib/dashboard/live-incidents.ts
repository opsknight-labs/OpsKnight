import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AuthorizationError, CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere, scheduleReadWhere } from '@/lib/authorization-filters';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
import { getCachedOrFetch } from '@/lib/realtime-cache';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import {
  computeSlaSignal,
  deriveLiveProjection,
  deriveTrend,
  type LiveSetRow,
  type LiveTrendRow,
} from './live-incidents-engine';
import {
  LIVE_ACTIVE_STATUSES,
  LIVE_INCIDENT_DEFAULT_LIMIT,
  LIVE_INCIDENT_MAX_LIMIT,
  type LiveActivityItem,
  type LiveCoverage,
  type LiveIncident,
  type LiveIncidentQuery,
  type LiveOnCallShift,
  type LiveSnapshot,
} from './live-incidents-shared';

/** Upper bound of active incidents projected in memory per authorization scope. */
export const LIVE_SET_CAP = 2_000;
/** Generation keys invalidate on every incident/service change; TTL bounds user/team renames. */
const LIVE_SET_TTL_MS = 15_000;
const ACTIVITY_TTL_MS = 15_000;
const ONCALL_TTL_MS = 60_000;
const ACTIVITY_LIMIT = 12;
/**
 * Trends refresh on a fixed cadence rather than per realtime generation, so a burst of
 * incident changes costs at most one 24h aggregate read per scope per window.
 */
const TREND_TTL_MS = 15_000;
/** Fixed rolling window for hero trends; never driven by the history range picker. */
const TREND_WINDOW_MS = 24 * 60 * 60_000;
/** Bound on incidents touched in 24h that feed trends; larger windows truncate gracefully. */
const TREND_CAP = 5_000;

const liveSetSelect = {
  id: true,
  title: true,
  automationSourceRestricted: true,
  automationDecision: {
    select: {
      incidentId: true,
      matchedRouteRuleName: true,
      escalationPolicyNameSnapshot: true,
    },
  },
  automationTraces: { select: { incidentId: true }, take: 1 },
  status: true,
  urgency: true,
  priority: true,
  escalationStatus: true,
  currentEscalationStep: true,
  dedupKey: true,
  createdAt: true,
  updatedAt: true,
  acknowledgedAt: true,
  slaFirstAcknowledgedAt: true,
  slaAckTargetMs: true,
  slaResolveTargetMs: true,
  slaTargetSource: true,
  slaTargetCapturedAt: true,
  slaPausedMs: true,
  slaPauseStartedAt: true,
  slaAckElapsedMs: true,
  slaResolveElapsedMs: true,
  runbookExecutions: {
    select: {
      id: true,
      status: true,
      runbook: { select: { name: true } },
      completedAt: true,
      failureCode: true,
    },
    take: 1,
    orderBy: { createdAt: 'desc' },
  },
  service: {
    select: {
      id: true,
      name: true,
      teamId: true,
      team: { select: { id: true, name: true } },
      policy: { select: { id: true, name: true } },
    },
  },
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
  _count: { select: { alerts: true, watchers: true } },
} satisfies Prisma.IncidentSelect;

type LiveScope = { key: string; where: Prisma.IncidentWhereInput; sensitive: boolean };

/**
 * Viewers with identical authorization share one cache entry: every global reader shares
 * `global`; scoped readers are keyed by user (assignee/watcher visibility) and team set.
 */
export function resolveLiveScope(actor: AuthorizationActor): LiveScope {
  const where = incidentReadWhere(actor);
  const sensitive = hasCapability(actor.role, CAPABILITIES.INCIDENT_SENSITIVE_READ);
  const scope =
    Object.keys(where).length === 0
      ? 'global'
      : `user:${actor.id}:${[...actor.teamIds].sort().join(',')}`;
  return { key: `${scope}:s${sensitive ? 1 : 0}`, where, sensitive };
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const num = (value: bigint | number | null) => (value === null ? null : Number(value));

async function loadActiveSet(scope: LiveScope, generation: string | null) {
  const key = `live-set:${scope.key}:g:${generation ?? 'none'}`;
  const result = await getCachedOrFetch(
    key,
    async () => {
      const startedAt = Date.now();
      const rows = await prisma.incident.findMany({
        where: { AND: [scope.where, { status: { in: [...LIVE_ACTIVE_STATUSES] } }] },
        select: liveSetSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIVE_SET_CAP + 1,
      });
      observeOperationalHistogram(
        'opsknight_dashboard_live_set_duration_seconds',
        (Date.now() - startedAt) / 1000
      );
      const truncated = rows.length > LIVE_SET_CAP;
      const set: LiveSetRow[] = rows.slice(0, LIVE_SET_CAP).map(row => {
        const visible = visibleIncidentSource(row, scope.sensitive);
        const owner = visible.team ?? visible.service.team;
        return {
          id: visible.id,
          title: visible.title,
          status: visible.status as LiveSetRow['status'],
          urgency: visible.urgency,
          priority: visible.priority,
          escalationStatus: visible.escalationStatus,
          escalationLevel:
            visible.escalationStatus === 'ESCALATING' && visible.currentEscalationStep !== null
              ? visible.currentEscalationStep + 1
              : null,
          alertCount: row._count.alerts,
          responderCount: row._count.watchers,
          createdAt: visible.createdAt.toISOString(),
          updatedAt: visible.updatedAt.toISOString(),
          acknowledgedAt: iso(visible.acknowledgedAt),
          slaFirstAcknowledgedAt: iso(visible.slaFirstAcknowledgedAt),
          slaAckTargetMs: visible.slaAckTargetMs,
          slaResolveTargetMs: visible.slaResolveTargetMs,
          slaTargetSource: visible.slaTargetSource,
          slaTargetCapturedAt: iso(visible.slaTargetCapturedAt),
          slaPausedMs: Number(visible.slaPausedMs ?? 0),
          slaPauseStartedAt: iso(visible.slaPauseStartedAt),
          slaAckElapsedMs: num(visible.slaAckElapsedMs),
          slaResolveElapsedMs: num(visible.slaResolveElapsedMs),
          service: {
            id: visible.service.id,
            name: visible.service.name,
            teamId: visible.service.teamId,
          },
          team: owner ? { id: owner.id, name: owner.name } : null,
          assignee: visible.assignee
            ? { id: visible.assignee.id, name: visible.assignee.name || visible.assignee.email }
            : null,
          dedupKey: row.dedupKey ?? null,
          routeRuleName: row.automationDecision?.matchedRouteRuleName ?? null,
          escalationPolicyName:
            row.automationDecision?.escalationPolicyNameSnapshot ??
            row.service.policy?.name ??
            null,
          latestRunbook: row.runbookExecutions?.[0]
            ? {
                name: row.runbookExecutions[0].runbook.name,
                status: row.runbookExecutions[0].status,
                completedAt: iso(row.runbookExecutions[0].completedAt),
                failureCode: row.runbookExecutions[0].failureCode ?? null,
              }
            : null,
        };
      });
      return { set, truncated };
    },
    LIVE_SET_TTL_MS
  );
  return result.data;
}

async function loadActivity(
  scope: LiveScope,
  generation: string | null
): Promise<LiveActivityItem[]> {
  const key = `live-activity:${scope.key}:g:${generation ?? 'none'}`;
  const result = await getCachedOrFetch(
    key,
    async () => {
      const events = await prisma.incidentEvent.findMany({
        where: Object.keys(scope.where).length === 0 ? undefined : { incident: scope.where },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACTIVITY_LIMIT,
        select: {
          id: true,
          message: true,
          type: true,
          createdAt: true,
          incidentId: true,
          incident: {
            select: {
              title: true,
              automationSourceRestricted: true,
              automationDecision: { select: { incidentId: true } },
              automationTraces: { select: { incidentId: true }, take: 1 },
            },
          },
        },
      });
      return events.map(event => {
        const visible = visibleIncidentSource(
          { ...event.incident, events: [{ message: event.message }] },
          scope.sensitive
        );
        return {
          id: event.id,
          incidentId: event.incidentId,
          incidentTitle: visible.title,
          message: visible.events[0].message,
          type: event.type,
          createdAt: event.createdAt.toISOString(),
        };
      });
    },
    ACTIVITY_TTL_MS
  );
  return result.data;
}

async function loadOnCall(actor: AuthorizationActor): Promise<LiveOnCallShift[]> {
  let scheduleWhere: Prisma.OnCallScheduleWhereInput;
  try {
    scheduleWhere = scheduleReadWhere(actor);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return [];
    }
    throw err;
  }

  const isGlobal = Object.keys(scheduleWhere).length === 0;
  const bucket = Math.floor(Date.now() / ONCALL_TTL_MS);
  const cacheKey = isGlobal
    ? `live-oncall:global:${bucket}`
    : `live-oncall:${actor.id}:${bucket}`;

  const result = await getCachedOrFetch(
    cacheKey,
    async () =>
      (await getActiveOnCallShifts(new Date(), { where: scheduleWhere })).map(shift => ({
        id: shift.id,
        scheduleId: shift.scheduleId,
        end: shift.end.toISOString(),
        scheduleName: shift.schedule.name,
        user: {
          id: shift.user.id ?? null,
          name: shift.user.name || 'Unknown user',
          avatarUrl: shift.user.avatarUrl ?? null,
          gender: shift.user.gender ?? null,
        },
      })),
    ONCALL_TTL_MS
  );
  return result.data;
}

async function loadTrendRows(scope: LiveScope): Promise<LiveTrendRow[]> {
  const bucket = Math.floor(Date.now() / TREND_TTL_MS);
  const result = await getCachedOrFetch(
    `live-trend:${scope.key}:t:${bucket}`,
    async () => {
      const since = new Date(Date.now() - TREND_WINDOW_MS);
      const rows = await prisma.incident.findMany({
        where: {
          AND: [
            scope.where,
            {
              OR: [
                { createdAt: { gte: since } },
                { acknowledgedAt: { gte: since } },
                { resolvedAt: { gte: since } },
              ],
            },
          ],
        },
        select: {
          createdAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
          urgency: true,
          priority: true,
          assigneeId: true,
          teamId: true,
          service: { select: { teamId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: TREND_CAP,
      });
      return rows.map((row): LiveTrendRow => ({
        createdAt: row.createdAt.toISOString(),
        acknowledgedAt: iso(row.acknowledgedAt),
        resolvedAt: iso(row.resolvedAt),
        critical: row.urgency === 'HIGH' || row.priority === 'P1',
        assigneeId: row.assigneeId,
        teamId: row.teamId,
        serviceTeamId: row.service.teamId,
      }));
    },
    TREND_TTL_MS
  );
  return result.data;
}

async function loadSchedules(actor: AuthorizationActor): Promise<Array<{ id: string; name: string }>> {
  let scheduleWhere: Prisma.OnCallScheduleWhereInput;
  try {
    scheduleWhere = scheduleReadWhere(actor);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return [];
    }
    throw err;
  }

  const isGlobal = Object.keys(scheduleWhere).length === 0;
  const bucket = Math.floor(Date.now() / ONCALL_TTL_MS);
  const cacheKey = isGlobal
    ? `live-schedules:global:${bucket}`
    : `live-schedules:${actor.id}:${bucket}`;

  const result = await getCachedOrFetch(
    cacheKey,
    () =>
      prisma.onCallSchedule.findMany({
        where: scheduleWhere,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ONCALL_TTL_MS
  );
  return result.data;
}

function deriveCoverage(
  actorId: string,
  shifts: LiveOnCallShift[],
  schedules: Array<{ id: string; name: string }>
): LiveCoverage {
  const mine = shifts.filter(shift => shift.user.id === actorId);
  const covered = new Set(shifts.map(shift => shift.scheduleId));
  const until = mine.reduce<string | null>(
    (latest, shift) => (latest === null || shift.end > latest ? shift.end : latest),
    null
  );
  return {
    me: { onCall: mine.length > 0, schedules: [...new Set(mine.map(s => s.scheduleName))], until },
    gaps: schedules.filter(schedule => !covered.has(schedule.id)),
    scheduleCount: schedules.length,
  };
}

export async function getLiveDashboardSnapshot(
  actor: AuthorizationActor,
  query: LiveIncidentQuery,
  options: { limit?: number; generation?: string | null; pinIds?: readonly string[] } = {}
): Promise<LiveSnapshot> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? LIVE_INCIDENT_DEFAULT_LIMIT)),
    LIVE_INCIDENT_MAX_LIMIT
  );
  const generation = options.generation ?? null;
  const scope = resolveLiveScope(actor);
  const [{ set, truncated }, activity, onCall, trendRows, schedules] = await Promise.all([
    loadActiveSet(scope, generation),
    loadActivity(scope, generation).catch(() => [] as LiveActivityItem[]),
    loadOnCall(actor).catch(() => [] as LiveOnCallShift[]),
    loadTrendRows(scope).catch(() => [] as LiveTrendRow[]),
    loadSchedules(actor).catch(() => [] as Array<{ id: string; name: string }>),
  ]);
  const ctx = { actorId: actor.id, teamIds: [...actor.teamIds], now: Date.now() };
  const derived = deriveLiveProjection(set, query, ctx, limit, { pinIds: options.pinIds });
  return {
    query,
    incidents: derived.incidents,
    total: derived.total,
    facets: derived.facets,
    summary: derived.summary,
    pinned: derived.pinned,
    attention: derived.attention,
    trend: deriveTrend(trendRows, query.scope, ctx),
    coverage: deriveCoverage(actor.id, onCall, schedules),
    rail: {
      myQueue: derived.myQueue,
      slaRisk: derived.slaRisk,
      servicesAtRisk: derived.servicesAtRisk,
      activity,
      onCall,
    },
    truncated,
    asOf: new Date().toISOString(),
    generation,
  };
}

/**
 * Fetch authoritative live detail for a specific incident within the viewer's
 * authorization scope, ensuring selection stability even when an incident
 * is filtered out of the current page projection.
 */
export async function getLiveIncidentDetail(
  actor: AuthorizationActor,
  incidentId: string
): Promise<LiveIncident | null> {
  const scope = resolveLiveScope(actor);
  const row = await prisma.incident.findFirst({
    where: { AND: [{ id: incidentId }, scope.where] },
    select: liveSetSelect,
  });
  if (!row) return null;

  const visible = visibleIncidentSource(row, scope.sensitive);
  const owner = visible.team ?? visible.service.team;
  const setRow: LiveSetRow = {
    id: visible.id,
    title: visible.title,
    status: visible.status as LiveSetRow['status'],
    urgency: visible.urgency,
    priority: visible.priority,
    escalationStatus: visible.escalationStatus,
    escalationLevel:
      visible.escalationStatus === 'ESCALATING' && visible.currentEscalationStep !== null
        ? visible.currentEscalationStep + 1
        : null,
    alertCount: row._count.alerts,
    responderCount: row._count.watchers,
    createdAt: visible.createdAt.toISOString(),
    updatedAt: visible.updatedAt.toISOString(),
    acknowledgedAt: iso(visible.acknowledgedAt),
    slaFirstAcknowledgedAt: iso(visible.slaFirstAcknowledgedAt),
    slaAckTargetMs: visible.slaAckTargetMs,
    slaResolveTargetMs: visible.slaResolveTargetMs,
    slaTargetSource: visible.slaTargetSource,
    slaTargetCapturedAt: iso(visible.slaTargetCapturedAt),
    slaPausedMs: Number(visible.slaPausedMs ?? 0),
    slaPauseStartedAt: iso(visible.slaPauseStartedAt),
    slaAckElapsedMs: num(visible.slaAckElapsedMs),
    slaResolveElapsedMs: num(visible.slaResolveElapsedMs),
    service: {
      id: visible.service.id,
      name: visible.service.name,
      teamId: visible.service.teamId,
    },
    team: owner ? { id: owner.id, name: owner.name } : null,
    assignee: visible.assignee
      ? { id: visible.assignee.id, name: visible.assignee.name || visible.assignee.email }
      : null,
    dedupKey: row.dedupKey ?? null,
    routeRuleName: row.automationDecision?.matchedRouteRuleName ?? null,
    escalationPolicyName:
      row.automationDecision?.escalationPolicyNameSnapshot ??
      row.service.policy?.name ??
      null,
    latestRunbook: row.runbookExecutions?.[0]
      ? {
          name: row.runbookExecutions[0].runbook.name,
          status: row.runbookExecutions[0].status,
          completedAt: iso(row.runbookExecutions[0].completedAt),
          failureCode: row.runbookExecutions[0].failureCode ?? null,
        }
      : null,
  };

  const sla = computeSlaSignal(setRow, Date.now());
  return { ...setRow, sla };
}
