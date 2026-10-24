import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
import { getCachedOrFetch } from '@/lib/realtime-cache';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import { deriveLiveProjection, type LiveSetRow } from './live-incidents-engine';
import {
  LIVE_ACTIVE_STATUSES,
  LIVE_INCIDENT_DEFAULT_LIMIT,
  LIVE_INCIDENT_MAX_LIMIT,
  type LiveActivityItem,
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

const liveSetSelect = {
  id: true,
  title: true,
  automationSourceRestricted: true,
  automationDecision: { select: { incidentId: true } },
  automationTraces: { select: { incidentId: true }, take: 1 },
  status: true,
  urgency: true,
  priority: true,
  escalationStatus: true,
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
  service: {
    select: { id: true, name: true, teamId: true, team: { select: { id: true, name: true } } },
  },
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
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

async function loadOnCall(): Promise<LiveOnCallShift[]> {
  // On-call coverage is time-based and identical for every viewer: one shared minute bucket.
  const bucket = Math.floor(Date.now() / ONCALL_TTL_MS);
  const result = await getCachedOrFetch(
    `live-oncall:${bucket}`,
    async () =>
      (await getActiveOnCallShifts(new Date())).map(shift => ({
        id: shift.id,
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

export async function getLiveDashboardSnapshot(
  actor: AuthorizationActor,
  query: LiveIncidentQuery,
  options: { limit?: number; generation?: string | null } = {}
): Promise<LiveSnapshot> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? LIVE_INCIDENT_DEFAULT_LIMIT)),
    LIVE_INCIDENT_MAX_LIMIT
  );
  const generation = options.generation ?? null;
  const scope = resolveLiveScope(actor);
  const [{ set, truncated }, activity, onCall] = await Promise.all([
    loadActiveSet(scope, generation),
    loadActivity(scope, generation).catch(() => [] as LiveActivityItem[]),
    loadOnCall().catch(() => [] as LiveOnCallShift[]),
  ]);
  const derived = deriveLiveProjection(
    set,
    query,
    { actorId: actor.id, teamIds: [...actor.teamIds], now: Date.now() },
    limit
  );
  return {
    query,
    incidents: derived.incidents,
    total: derived.total,
    facets: derived.facets,
    summary: derived.summary,
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
