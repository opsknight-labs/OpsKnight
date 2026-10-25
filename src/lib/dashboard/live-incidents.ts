import 'server-only';

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AuthorizationError, CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  incidentReadWhere,
  incidentReadWhereParts,
  scheduleReadWhere,
} from '@/lib/authorization-filters';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
import { getCachedOrFetch, getCachedWhenAcceptable } from '@/lib/realtime-cache';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import {
  addOperationalMetric,
  observeOperationalHistogram,
  setOperationalGauge,
} from '@/lib/metrics/operational/registry';
import {
  computeSlaSignal,
  deriveLiveProjection,
  toWire,
  deriveShared,
  deriveTrend,
  isActorNeutralQuery,
  personalizeDerivation,
  type SharedDerivation,
  type LiveSetRow,
  type LiveTrendRow,
} from './live-incidents-engine';
import {
  LIVE_ACTIVE_STATUSES,
  LIVE_INCIDENT_DEFAULT_LIMIT,
  LIVE_INCIDENT_MAX_LIMIT,
  compareNewestFirst,
  countActiveFacets,
  liveQueryKey,
  type LiveActivityItem,
  type LiveCoverage,
  type LiveIncident,
  type LiveIncidentQuery,
  type LiveOnCallShift,
  type LiveSnapshot,
} from './live-incidents-shared';

/** Upper bound of active incidents projected in memory per authorization partition. */
export const LIVE_SET_CAP = 2_000;
/**
 * When the newest-first window is full, older incidents that still demand attention (critical or
 * unowned) are retained beyond it, so truncation never hides the work that matters most.
 */
export const LIVE_PRIORITY_CAP = 1_000;
/** Incidents visible to one user individually (assigned or watching); small by construction. */
const PERSONAL_SET_CAP = 500;
/**
 * Reads are bounded by time, not by change count. A cached partition is served while it is
 * younger than its window, or while it already reflects the realtime generation the viewer
 * knows about. A viewer that knows of a newer generation therefore waits at most one window
 * for it, and a burst of ingestion costs at most ~1 query per partition per window however many
 * incidents change or viewers ask. `LiveSnapshot.generation` reports what was actually reflected.
 */
const LIVE_SET_WINDOW_MS = 500;
const LIVE_SET_PERSONAL_WINDOW_MS = 2_000;
const LIVE_SET_TTL_MS = 15_000;
const ACTIVITY_WINDOW_MS = 2_000;
const ACTIVITY_PERSONAL_WINDOW_MS = 10_000;
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
/** Per-metric bound (created / acknowledged / resolved) on incidents feeding trends. */
const TREND_CAP = 5_000;

/**
 * Bulk feed projection: only what a row, the filters and the Ops Pulse need. Inspector-only
 * context (routing rule, runbook, policy, dedup key) is loaded on demand for the one open
 * incident via `liveDetailSelect`.
 */
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
  currentEscalationStep: true,
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
    select: {
      id: true,
      name: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
} satisfies Prisma.IncidentSelect;

const liveDetailSelect = {
  ...liveSetSelect,
  automationDecision: {
    select: {
      incidentId: true,
      matchedRouteRuleName: true,
      escalationPolicyNameSnapshot: true,
    },
  },
  dedupKey: true,
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
} satisfies Prisma.IncidentSelect;

type LiveRow = Prisma.IncidentGetPayload<{ select: typeof liveSetSelect }>;
type LiveDetailRow = Prisma.IncidentGetPayload<{ select: typeof liveDetailSelect }>;

/** A cache partition: rows that every viewer in it is allowed to see, loaded once for all. */
type LivePartition = {
  key: string;
  where: Prisma.IncidentWhereInput;
  cap: number;
  personal: boolean;
};

type LiveScope = {
  /** Identifies one viewer's full authorization scope. */
  key: string;
  where: Prisma.IncidentWhereInput;
  sensitive: boolean;
  /**
   * Scoped viewers read the union of a partition shared by everyone with the same team set and a
   * small partition unique to them (assigned/watching). The shared part is the expensive one, so
   * it is queried and cached once per team set instead of once per user.
   */
  partitions: LivePartition[];
};

export function resolveLiveScope(actor: AuthorizationActor): LiveScope {
  const where = incidentReadWhere(actor);
  const parts = incidentReadWhereParts(actor);
  const sensitive = hasCapability(actor.role, CAPABILITIES.INCIDENT_SENSITIVE_READ);
  const flag = `s${sensitive ? 1 : 0}`;
  if (parts.global) {
    return {
      key: `global:${flag}`,
      where,
      sensitive,
      partitions: [{ key: `global:${flag}`, where: {}, cap: LIVE_SET_CAP, personal: false }],
    };
  }
  const teams = [...actor.teamIds].sort().join(',');
  return {
    key: `user:${actor.id}:${teams}:${flag}`,
    where,
    sensitive,
    partitions: [
      { key: `teams:${teams}:${flag}`, where: parts.shared, cap: LIVE_SET_CAP, personal: false },
      {
        key: `user:${actor.id}:${flag}`,
        where: { OR: parts.personal },
        cap: PERSONAL_SET_CAP,
        personal: true,
      },
    ],
  };
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const num = (value: bigint | number | null) => (value === null ? null : Number(value));

/**
 * Load rows for every partition of the scope (each cached under its own key) and merge them.
 * Concurrent viewers with the same team set share the expensive partition's single query.
 */
type PartitionResult<T> = { rows: T[]; truncated: boolean; generation: string | null };
type PartitionRead<T> = PartitionResult<T> & { version: string };

const generationAtLeast = (have: string | null, want: string | null) =>
  want === null || (have !== null && BigInt(have) >= BigInt(want));

async function loadPartitioned<T extends { id: string }>(
  scope: LiveScope,
  name: string,
  windows: { shared: number; personal: number },
  ttlMs: number,
  generation: string | null,
  fetchRows: (partition: LivePartition) => Promise<{ rows: T[]; truncated: boolean }>,
  compare: (a: T, b: T) => number,
  limit?: number
): Promise<PartitionRead<T>> {
  const reads = await Promise.all(
    scope.partitions.map(partition =>
      getCachedWhenAcceptable<PartitionResult<T>>(
        `${name}:${partition.key}`,
        async () => ({ ...(await fetchRows(partition)), generation }),
        ttlMs,
        (data, ageMs) =>
          ageMs < (partition.personal ? windows.personal : windows.shared) ||
          (generation !== null && generationAtLeast(data.generation, generation))
      )
    )
  );
  for (const read of reads) {
    addOperationalMetric('opsknight_dashboard_live_partition_reads_total', 1, {
      result: read.fromCache ? 'hit' : 'miss',
    });
  }
  const parts = reads.map(read => read.data);
  const version = reads.map(read => read.hash).join('+');
  // The merged result reflects the oldest generation among its parts.
  const reflected = parts.reduce<string | null>((oldest, part, index) => {
    if (index === 0) return part.generation;
    if (oldest === null || part.generation === null) return null;
    return BigInt(part.generation) < BigInt(oldest) ? part.generation : oldest;
  }, null);
  if (parts.length === 1) {
    const [only] = parts;
    return {
      rows: limit ? only.rows.slice(0, limit) : only.rows,
      truncated: only.truncated,
      generation: reflected,
      version,
    };
  }
  const merged = new Map<string, T>();
  for (const part of parts) for (const row of part.rows) merged.set(row.id, row);
  const rows = [...merged.values()].sort(compare);
  return {
    rows: limit ? rows.slice(0, limit) : rows,
    truncated: parts.some(part => part.truncated),
    generation: reflected,
    version,
  };
}

type RowCounts = { alerts: number; watchers: number };

function toSetRow(row: LiveRow, sensitive: boolean, counts?: RowCounts): LiveSetRow {
  const visible = visibleIncidentSource(row, sensitive);
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
    alertCount: counts?.alerts ?? 0,
    responderCount: counts?.watchers ?? 0,
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
}

const CRITICAL_OR: Prisma.IncidentWhereInput[] = [{ urgency: 'HIGH' }, { priority: 'P1' }];
const activeWhere = {
  status: { in: [...LIVE_ACTIVE_STATUSES] },
} satisfies Prisma.IncidentWhereInput;

/** SLA transition hints within this horizon are pulled into the working set (see below). */
const SLA_HINT_AHEAD_MS = 30 * 60_000;
const SLA_HINT_BEHIND_MS = 60 * 60_000;

/**
 * Alert and watcher counts for the rows of one working set, read with two indexed aggregates over
 * exactly those ids. (A per-row `_count` relation makes PostgreSQL aggregate whole tables.)
 */
async function loadRowCounts(ids: string[]): Promise<Map<string, RowCounts>> {
  const counts = new Map<string, RowCounts>();
  if (ids.length === 0) return counts;
  const [alerts, watchers] = await Promise.all([
    prisma.alert.groupBy({
      by: ['incidentId'],
      where: { incidentId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.incidentWatcher.groupBy({
      by: ['incidentId'],
      where: { incidentId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  for (const id of ids) counts.set(id, { alerts: 0, watchers: 0 });
  for (const row of alerts) {
    if (row.incidentId) counts.set(row.incidentId, { alerts: row._count._all, watchers: 0 });
  }
  for (const row of watchers) {
    const current = counts.get(row.incidentId) ?? { alerts: 0, watchers: 0 };
    counts.set(row.incidentId, { ...current, watchers: row._count._all });
  }
  return counts;
}

async function loadActiveSet(scope: LiveScope, generation: string | null) {
  const result = await loadPartitioned<LiveSetRow>(
    scope,
    'live-set',
    { shared: LIVE_SET_WINDOW_MS, personal: LIVE_SET_PERSONAL_WINDOW_MS },
    LIVE_SET_TTL_MS,
    generation,
    async partition => {
      const startedAt = Date.now();
      const rows = await prisma.incident.findMany({
        where: { AND: [partition.where, activeWhere] },
        select: liveSetSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: partition.cap + 1,
      });
      const truncated = rows.length > partition.cap;
      const window = rows.slice(0, partition.cap);
      let extra: LiveRow[] = [];
      const oldest = window.at(-1);
      if (truncated && oldest) {
        // Older incidents that must stay discoverable beyond the newest-first window: critical,
        // unowned, escalating, and those whose next SLA transition is imminent or just passed
        // (served by idx_incident_next_sla_transition). The SLA hint is advisory, so SLA
        // figures are still reported as window-based when truncated.
        const now = Date.now();
        extra = await prisma.incident.findMany({
          where: {
            AND: [
              partition.where,
              activeWhere,
              { createdAt: { lt: oldest.createdAt } },
              {
                OR: [
                  ...CRITICAL_OR,
                  { assigneeId: null },
                  { escalationStatus: 'ESCALATING' },
                  {
                    nextSlaTransitionAt: {
                      lte: new Date(now + SLA_HINT_AHEAD_MS),
                      gt: new Date(now - SLA_HINT_BEHIND_MS),
                    },
                  },
                ],
              },
            ],
          },
          select: liveSetSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: LIVE_PRIORITY_CAP,
        });
      }
      const all = [...window, ...extra];
      const counts = await loadRowCounts(all.map(row => row.id));
      observeOperationalHistogram(
        'opsknight_dashboard_live_set_duration_seconds',
        (Date.now() - startedAt) / 1000
      );
      return {
        rows: all.map(row => toSetRow(row, scope.sensitive, counts.get(row.id))),
        truncated,
      };
    },
    compareNewestFirst
  );
  return {
    set: result.rows,
    truncated: result.truncated,
    generation: result.generation,
    version: result.version,
  };
}

type ExactCounts = {
  active: number;
  triggered: number;
  critical: number;
  unassigned: number;
  unassignedCritical: number;
};

/**
 * Database-exact counters for one slice of the viewer's authorization scope (`slice` narrows it
 * to the dashboard scope switch). Only read when the working set was truncated; otherwise the
 * in-memory set is already complete and exact.
 */
async function loadExactCounts(
  scope: LiveScope,
  slice: { key: string; where: Prisma.IncidentWhereInput }
): Promise<{ data: ExactCounts; version: string }> {
  const result = await getCachedOrFetch(
    `live-exact:${scope.key}:${slice.key}:w${Math.floor(Date.now() / LIVE_SET_WINDOW_MS)}`,
    async () => {
      const base: Prisma.IncidentWhereInput = { AND: [scope.where, activeWhere, slice.where] };
      const count = (extra: Prisma.IncidentWhereInput) =>
        prisma.incident.count({ where: { AND: [base, extra] } });
      const [active, triggered, critical, unassigned, unassignedCritical] = await Promise.all([
        count({}),
        count({ status: 'OPEN' }),
        count({ OR: CRITICAL_OR }),
        count({ assigneeId: null }),
        count({ OR: CRITICAL_OR, assigneeId: null }),
      ]);
      return { active, triggered, critical, unassigned, unassignedCritical };
    },
    LIVE_SET_TTL_MS
  );
  return { data: result.data, version: result.hash };
}

/** The slice of the visible population selected by the dashboard scope switch. */
function scopeSlice(
  actor: AuthorizationActor,
  queryScope: LiveIncidentQuery['scope']
): { key: string; where: Prisma.IncidentWhereInput } {
  if (queryScope === 'mine') return { key: 'mine', where: { assigneeId: actor.id } };
  if (queryScope === 'teams') {
    const teamIds = [...actor.teamIds];
    return {
      key: `teams:${[...teamIds].sort().join(',')}:${actor.id}`,
      where:
        teamIds.length === 0
          ? { assigneeId: actor.id }
          : {
              OR: [
                { assigneeId: actor.id },
                { teamId: { in: teamIds } },
                { service: { teamId: { in: teamIds } } },
              ],
            },
    };
  }
  return { key: 'all', where: {} };
}

async function loadActivity(
  scope: LiveScope,
  generation: string | null
): Promise<{ rows: LiveActivityItem[]; version: string }> {
  const result = await loadPartitioned<LiveActivityItem>(
    scope,
    'live-activity',
    { shared: ACTIVITY_WINDOW_MS, personal: ACTIVITY_PERSONAL_WINDOW_MS },
    ACTIVITY_TTL_MS,
    generation,
    async partition => {
      const events = await prisma.incidentEvent.findMany({
        where:
          Object.keys(partition.where).length === 0 ? undefined : { incident: partition.where },
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
      return {
        rows: events.map(event => {
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
        }),
        truncated: false,
      };
    },
    (a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id < a.id ? -1 : 1,
    ACTIVITY_LIMIT
  );
  return { rows: result.rows, version: result.version };
}

/**
 * Schedule visibility changes with team membership, so cached schedule data is keyed by the
 * authorization filter itself (never by user id alone): a membership change selects a different
 * key immediately instead of serving stale visibility until the TTL expires.
 */
function scheduleScopeKey(where: Prisma.OnCallScheduleWhereInput): string {
  if (Object.keys(where).length === 0) return 'global';
  return createHash('sha1').update(JSON.stringify(where)).digest('base64url');
}

function resolveScheduleWhere(actor: AuthorizationActor): Prisma.OnCallScheduleWhereInput | null {
  try {
    return scheduleReadWhere(actor);
  } catch (err) {
    if (err instanceof AuthorizationError) return null;
    throw err;
  }
}

async function loadOnCall(
  actor: AuthorizationActor
): Promise<{ data: LiveOnCallShift[]; version: string }> {
  const scheduleWhere = resolveScheduleWhere(actor);
  if (!scheduleWhere) return { data: [], version: 'none' };
  const bucket = Math.floor(Date.now() / ONCALL_TTL_MS);
  const result = await getCachedOrFetch(
    `live-oncall:${scheduleScopeKey(scheduleWhere)}:${bucket}`,
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
  return { data: result.data, version: result.hash };
}

type LiveTrendRowWithId = LiveTrendRow & { id: string };

async function loadTrendRows(
  scope: LiveScope
): Promise<{ rows: LiveTrendRow[]; truncated: boolean; version: string }> {
  const result = await loadPartitioned<LiveTrendRowWithId>(
    scope,
    'live-trend',
    { shared: TREND_TTL_MS, personal: TREND_TTL_MS },
    TREND_TTL_MS * 2,
    null,
    async partition => {
      const since = new Date(Date.now() - TREND_WINDOW_MS);
      const select = {
        id: true,
        createdAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        urgency: true,
        priority: true,
        assigneeId: true,
        teamId: true,
        service: { select: { teamId: true } },
      } satisfies Prisma.IncidentSelect;
      // One indexed query per timestamp. A single OR across three columns scans, and a single
      // newest-first cap would drop older incidents acknowledged or resolved inside the window.
      const read = (field: 'createdAt' | 'acknowledgedAt' | 'resolvedAt') =>
        prisma.incident.findMany({
          where: { AND: [partition.where, { [field]: { gte: since } }] },
          select,
          orderBy: { [field]: 'desc' },
          take: TREND_CAP,
        });
      const [created, acknowledged, resolved] = await Promise.all([
        read('createdAt'),
        read('acknowledgedAt'),
        read('resolvedAt'),
      ]);
      const unique = new Map<string, LiveTrendRowWithId>();
      for (const row of [...created, ...acknowledged, ...resolved]) {
        unique.set(row.id, {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          acknowledgedAt: iso(row.acknowledgedAt),
          resolvedAt: iso(row.resolvedAt),
          critical: row.urgency === 'HIGH' || row.priority === 'P1',
          assigneeId: row.assigneeId,
          teamId: row.teamId,
          serviceTeamId: row.service.teamId,
        });
      }
      return {
        rows: [...unique.values()],
        truncated: [created, acknowledged, resolved].some(rows => rows.length >= TREND_CAP),
      };
    },
    compareNewestFirst
  );
  return { rows: result.rows, truncated: result.truncated, version: result.version };
}

async function loadSchedules(
  actor: AuthorizationActor
): Promise<{ data: Array<{ id: string; name: string }>; version: string }> {
  const scheduleWhere = resolveScheduleWhere(actor);
  if (!scheduleWhere) return { data: [], version: 'none' };
  const bucket = Math.floor(Date.now() / ONCALL_TTL_MS);
  const result = await getCachedOrFetch(
    `live-schedules:${scheduleScopeKey(scheduleWhere)}:${bucket}`,
    () =>
      prisma.onCallSchedule.findMany({
        where: scheduleWhere,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ONCALL_TTL_MS
  );
  return { data: result.data, version: result.hash };
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

/**
 * In-process memo for derived projections. Derivation is synchronous CPU work over the whole
 * working set (tens of milliseconds at thousands of incidents), so identical work requested by
 * many viewers inside one short window is done once. Entries are never shared across different
 * authorization scopes: the key always begins with the scope key.
 */
/**
 * Everything time-dependent in a snapshot (SLA risk, due-soon, trends) is evaluated at the start
 * of a 5-second bucket and the bucket is part of the validator, so a conditional response can
 * never hide a time-driven change for longer than one bucket.
 */
const SNAPSHOT_BUCKET_MS = 5_000;
const DERIVATION_MEMO_MS = 10_000;
const DERIVATION_MEMO_MAX = 64;
const derivationMemo = new Map<string, { expiresAt: number; value: unknown }>();

function memoized<T>(key: string, compute: () => T): T {
  const now = Date.now();
  const hit = derivationMemo.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = compute();
  derivationMemo.set(key, { expiresAt: now + DERIVATION_MEMO_MS, value });
  if (derivationMemo.size > DERIVATION_MEMO_MAX) {
    for (const [oldKey, entry] of derivationMemo) {
      if (entry.expiresAt <= now || derivationMemo.size > DERIVATION_MEMO_MAX) {
        derivationMemo.delete(oldKey);
      }
      if (derivationMemo.size <= DERIVATION_MEMO_MAX / 2) break;
    }
  }
  return value;
}

/** Test hook: forget memoized derivations. */
export function clearLiveDerivationMemo(): void {
  derivationMemo.clear();
}

type SnapshotOptions = { limit?: number; generation?: string | null; pinIds?: readonly string[] };

export type LiveSnapshotResolution = {
  /** Validator for the material response; stable while nothing the response depends on changed. */
  etag: string;
  /** Null when `ifNoneMatch` matched: nothing was derived or serialized. */
  snapshot: LiveSnapshot | null;
  /** Realtime generation the underlying data reflects, even when the body is not sent. */
  generation: string | null;
};

const FAILED_READ = 'unavailable';

/**
 * Resolve the live snapshot, or prove it unchanged before deriving it. The validator is built
 * only from what the response is a pure function of: the content digests of every dataset read
 * (active set partitions, activity, trend, on-call, schedules, exact counters), the viewer's
 * identity and team set, the query, page size, pins and the time bucket. The realtime generation
 * and read timestamp are deliberately excluded.
 */
export async function resolveLiveDashboardSnapshot(
  actor: AuthorizationActor,
  query: LiveIncidentQuery,
  options: SnapshotOptions & { ifNoneMatch?: string | null } = {}
): Promise<LiveSnapshotResolution> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? LIVE_INCIDENT_DEFAULT_LIMIT)),
    LIVE_INCIDENT_MAX_LIMIT
  );
  const generation = options.generation ?? null;
  const scope = resolveLiveScope(actor);
  const active = await loadActiveSet(scope, generation);
  const { set, truncated, generation: reflected } = active;

  const [activity, onCall, trend, schedules] = await Promise.all([
    loadActivity(scope, generation).catch(() => null),
    loadOnCall(actor).catch(() => null),
    loadTrendRows(scope).catch(() => null),
    loadSchedules(actor).catch(() => null),
  ]);

  // Exact database counters are only needed (and only read) when the working set is truncated.
  let exactScope: { data: ExactCounts; version: string } | null = null;
  let exactAll: { data: ExactCounts; version: string } | null = null;
  if (truncated) {
    [exactScope, exactAll] = await Promise.all([
      loadExactCounts(scope, scopeSlice(actor, query.scope)).catch(() => null),
      query.scope === 'all'
        ? Promise.resolve(null)
        : loadExactCounts(scope, scopeSlice(actor, 'all')).catch(() => null),
    ]);
    if (query.scope === 'all') exactAll = exactScope;
  }

  const teamKey = [...actor.teamIds].sort().join(',');
  const now = Date.now();
  const bucket = Math.floor(now / SNAPSHOT_BUCKET_MS);
  const snapshotNow = bucket * SNAPSHOT_BUCKET_MS;
  const etag = `W/"${createHash('sha1')
    .update(
      JSON.stringify([
        'live-snapshot/3',
        actor.id,
        actor.role,
        teamKey,
        scope.key,
        liveQueryKey(query),
        limit,
        options.pinIds ?? [],
        bucket,
        active.version,
        activity?.version ?? FAILED_READ,
        onCall?.version ?? FAILED_READ,
        trend?.version ?? FAILED_READ,
        schedules?.version ?? FAILED_READ,
        exactScope?.version ?? (truncated ? FAILED_READ : null),
        exactAll?.version ?? (truncated ? FAILED_READ : null),
      ])
    )
    .digest('base64url')}"`;
  const reflectedGeneration = reflected ?? generation;
  if (
    generation &&
    reflectedGeneration &&
    /^\d+$/.test(generation) &&
    /^\d+$/.test(reflectedGeneration)
  ) {
    const lag = BigInt(generation) - BigInt(reflectedGeneration);
    setOperationalGauge(
      'opsknight_dashboard_live_generation_lag',
      lag > BigInt(0) ? Number(lag) : 0
    );
  }
  if (options.ifNoneMatch && options.ifNoneMatch === etag) {
    return { etag, snapshot: null, generation: reflectedGeneration };
  }

  const ctx = { actorId: actor.id, teamIds: [...actor.teamIds], now: snapshotNow };
  const derived =
    isActorNeutralQuery(query) && scope.partitions.length === 1
      ? personalizeDerivation(
          memoized<SharedDerivation>(
            `shared|${scope.key}|${active.version}|t${bucket}|${liveQueryKey(query)}`,
            () => deriveShared(set, query, snapshotNow)
          ),
          query,
          ctx,
          limit,
          options.pinIds
        )
      : deriveLiveProjection(set, query, ctx, limit, { pinIds: options.pinIds });
  const trendRows = trend?.rows ?? [];
  const derivedTrend =
    query.scope === 'all'
      ? memoized(`trend|${scope.key}|${trend?.version ?? FAILED_READ}|t${bucket}`, () =>
          deriveTrend(trendRows, 'all', ctx)
        )
      : deriveTrend(trendRows, query.scope, ctx);

  let summary = derived.summary;
  let total = derived.total;
  let countersExact = !truncated;
  let filteredExact = !truncated;
  if (truncated && exactScope) {
    const exact = exactScope.data;
    summary = {
      ...summary,
      active: exact.active,
      triggered: exact.triggered,
      acknowledged: Math.max(0, exact.active - exact.triggered),
      critical: exact.critical,
      unassigned: exact.unassigned,
      unassignedCritical: exact.unassignedCritical,
    };
    countersExact = true;
    // A plain view with no other filter maps to one exact counter; everything else is derived
    // from the working set and says so.
    if (countActiveFacets(query) === 0) {
      const exactTotal =
        query.view === 'active'
          ? exact.active
          : query.view === 'critical'
            ? exact.critical
            : query.view === 'unassigned'
              ? exact.unassigned
              : null;
      if (exactTotal !== null) {
        total = exactTotal;
        filteredExact = true;
      }
    }
  }
  if (truncated && exactAll) summary = { ...summary, visibleActive: exactAll.data.active };

  const snapshot: LiveSnapshot = {
    query,
    incidents: derived.incidents,
    total,
    facets: derived.facets,
    summary,
    pinned: derived.pinned,
    attention: derived.attention,
    trend: derivedTrend,
    coverage: deriveCoverage(actor.id, onCall?.data ?? [], schedules?.data ?? []),
    rail: {
      myQueue: derived.myQueue,
      slaRisk: derived.slaRisk,
      servicesAtRisk: derived.servicesAtRisk,
      activity: activity?.rows ?? [],
      onCall: onCall?.data ?? [],
    },
    alerts: derived.alerts,
    truncated,
    workingSet: set.length,
    accuracy: {
      counters: countersExact ? 'exact' : 'window',
      filtered: filteredExact ? 'exact' : 'window',
      sla: truncated ? 'window' : 'exact',
      trend: trend?.truncated ? 'capped' : 'exact',
    },
    asOf: new Date().toISOString(),
    // The generation this snapshot actually reflects (never newer than the viewer's knowledge).
    generation: reflected ?? generation,
  };
  return { etag, snapshot, generation: reflectedGeneration };
}

export async function getLiveDashboardSnapshot(
  actor: AuthorizationActor,
  query: LiveIncidentQuery,
  options: SnapshotOptions = {}
): Promise<LiveSnapshot> {
  const { snapshot } = await resolveLiveDashboardSnapshot(actor, query, options);
  return snapshot as LiveSnapshot;
}

/**
 * Fetch authoritative live detail for a specific incident within the viewer's
 * authorization scope, including the inspector-only context that the bulk feed omits.
 */
export async function getLiveIncidentDetail(
  actor: AuthorizationActor,
  incidentId: string
): Promise<LiveIncident | null> {
  const scope = resolveLiveScope(actor);
  const row: LiveDetailRow | null = await prisma.incident.findFirst({
    where: { AND: [{ id: incidentId }, scope.where] },
    select: liveDetailSelect,
  });
  if (!row) return null;

  const [alertCount, responderCount] = await Promise.all([
    prisma.alert.count({ where: { incidentId } }),
    prisma.incidentWatcher.count({ where: { incidentId } }),
  ]);
  const setRow: LiveSetRow = {
    ...toSetRow(row, scope.sensitive, { alerts: alertCount, watchers: responderCount }),
    dedupKey: row.dedupKey ?? null,
    routeRuleName: row.automationDecision?.matchedRouteRuleName ?? null,
    escalationPolicyName:
      row.automationDecision?.escalationPolicyNameSnapshot ?? row.service.policy?.name ?? null,
    latestRunbook: row.runbookExecutions?.[0]
      ? {
          name: row.runbookExecutions[0].runbook.name,
          status: row.runbookExecutions[0].status,
          completedAt: iso(row.runbookExecutions[0].completedAt),
          failureCode: row.runbookExecutions[0].failureCode ?? null,
        }
      : null,
  };
  return { ...setRow, sla: computeSlaSignal(setRow, Date.now()) };
}

// ---------------------------------------------------------------------------------------------
// Keyset-paginated reads beyond the working set
// ---------------------------------------------------------------------------------------------

export const LIVE_PAGE_MAX = 50;

/** Views that map to an indexed database predicate (`breaching` is derived from SLA state). */
export const LIVE_PAGEABLE_VIEWS = [
  'active',
  'critical',
  'mine',
  'my_teams',
  'unassigned',
] as const;

type LiveCursor = { createdAt: Date; id: string };

export function encodeLiveCursor(row: { createdAt: Date | string; id: string }): string {
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  return Buffer.from(JSON.stringify([createdAt, row.id])).toString('base64url');
}

/**
 * A cursor is only a position. It is applied on top of the viewer's authorization scope, which is
 * re-derived on every request, so a forged or replayed cursor can move the position but can never
 * widen what the viewer may read.
 */
export function decodeLiveCursor(cursor: string): LiveCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed as [unknown, unknown];
    if (typeof createdAt !== 'string' || typeof id !== 'string' || id.length > 100) return null;
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) ? null : { createdAt: date, id };
  } catch {
    return null;
  }
}

/** Database predicate equivalent to the in-memory view, scope and facets of `query`. */
export function liveQueryWhere(
  actor: AuthorizationActor,
  query: LiveIncidentQuery,
  sensitive: boolean
): Prisma.IncidentWhereInput {
  const teamIds = [...actor.teamIds];
  const and: Prisma.IncidentWhereInput[] = [scopeSlice(actor, query.scope).where];
  switch (query.view) {
    case 'critical':
      and.push({ OR: CRITICAL_OR });
      break;
    case 'mine':
      and.push({ assigneeId: actor.id });
      break;
    case 'my_teams':
      and.push(
        teamIds.length === 0
          ? { id: { in: [] } }
          : { OR: [{ teamId: { in: teamIds } }, { service: { teamId: { in: teamIds } } }] }
      );
      break;
    case 'unassigned':
      and.push({ assigneeId: null });
      break;
    default:
      break;
  }
  if (query.serviceId) and.push({ serviceId: query.serviceId });
  if (query.teamId) {
    and.push({
      OR: [{ teamId: query.teamId }, { service: { teamId: query.teamId } }],
    });
  }
  if (query.status !== 'all') and.push({ status: query.status });
  if (query.urgency !== 'all') and.push({ urgency: query.urgency });
  if (query.assignment === 'unassigned') and.push({ assigneeId: null });
  if (query.assignment === 'assigned') and.push({ assigneeId: { not: null } });
  if (query.search) {
    // Search runs against what the viewer may see: titles of incidents whose source is
    // restricted are redacted for them, so they must not be matchable by title.
    const visibleTitle: Prisma.IncidentWhereInput = sensitive
      ? { title: { contains: query.search, mode: 'insensitive' } }
      : {
          title: { contains: query.search, mode: 'insensitive' },
          automationSourceRestricted: false,
          automationDecision: null,
          automationTraces: { none: {} },
        };
    and.push({
      OR: [
        visibleTitle,
        { service: { name: { contains: query.search, mode: 'insensitive' } } },
        { id: query.search },
      ],
    });
  }
  return { AND: and };
}

export type LiveIncidentPage = {
  incidents: LiveIncident[];
  /** Opaque position for the next page; null when the result set is exhausted. */
  nextCursor: string | null;
};

/**
 * Next page of active incidents matching `query`, newest first, read straight from the database
 * inside the viewer's authorization scope. This is the path for everything beyond the bounded
 * working set; it never consults (or trusts) the in-memory set.
 */
export async function getLiveIncidentPage(
  actor: AuthorizationActor,
  query: LiveIncidentQuery,
  options: { cursor?: string | null; limit?: number } = {}
): Promise<LiveIncidentPage> {
  if (!(LIVE_PAGEABLE_VIEWS as readonly string[]).includes(query.view)) {
    throw new RangeError(`View "${query.view}" cannot be paged from the database`);
  }
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 25)), LIVE_PAGE_MAX);
  const cursor = options.cursor ? decodeLiveCursor(options.cursor) : null;
  if (options.cursor && !cursor) throw new RangeError('Invalid cursor');

  const scope = resolveLiveScope(actor);
  const and: Prisma.IncidentWhereInput[] = [
    scope.where,
    activeWhere,
    liveQueryWhere(actor, query, scope.sensitive),
  ];
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    });
  }
  const rows = await prisma.incident.findMany({
    where: { AND: and },
    select: liveSetSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const counts = await loadRowCounts(page.map(row => row.id));
  const now = Date.now();
  const incidents = page.map(row => {
    const setRow = toSetRow(row, scope.sensitive, counts.get(row.id));
    return toWire(setRow, computeSlaSignal(setRow, now));
  });
  const last = page.at(-1);
  return {
    incidents,
    nextCursor: rows.length > limit && last ? encodeLiveCursor(last) : null,
  };
}
