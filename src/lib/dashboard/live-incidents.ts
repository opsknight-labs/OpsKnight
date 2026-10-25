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
import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import {
  computeSlaSignal,
  deriveLiveProjection,
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
  _count: { select: { alerts: true, watchers: true } },
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
): Promise<PartitionResult<T>> {
  const parts = await Promise.all(
    scope.partitions.map(
      async partition =>
        (
          await getCachedWhenAcceptable<PartitionResult<T>>(
            `${name}:${partition.key}`,
            async () => ({ ...(await fetchRows(partition)), generation }),
            ttlMs,
            (data, ageMs) =>
              ageMs < (partition.personal ? windows.personal : windows.shared) ||
              (generation !== null && generationAtLeast(data.generation, generation))
          )
        ).data
    )
  );
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
    };
  }
  const merged = new Map<string, T>();
  for (const part of parts) for (const row of part.rows) merged.set(row.id, row);
  const rows = [...merged.values()].sort(compare);
  return {
    rows: limit ? rows.slice(0, limit) : rows,
    truncated: parts.some(part => part.truncated),
    generation: reflected,
  };
}

function toSetRow(row: LiveRow, sensitive: boolean): LiveSetRow {
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
  };
}

const CRITICAL_OR: Prisma.IncidentWhereInput[] = [{ urgency: 'HIGH' }, { priority: 'P1' }];
const activeWhere = {
  status: { in: [...LIVE_ACTIVE_STATUSES] },
} satisfies Prisma.IncidentWhereInput;

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
        extra = await prisma.incident.findMany({
          where: {
            AND: [
              partition.where,
              activeWhere,
              { createdAt: { lt: oldest.createdAt } },
              { OR: [...CRITICAL_OR, { assigneeId: null }] },
            ],
          },
          select: liveSetSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: LIVE_PRIORITY_CAP,
        });
      }
      observeOperationalHistogram(
        'opsknight_dashboard_live_set_duration_seconds',
        (Date.now() - startedAt) / 1000
      );
      return {
        rows: [...window, ...extra].map(row => toSetRow(row, scope.sensitive)),
        truncated,
      };
    },
    compareNewestFirst
  );
  return { set: result.rows, truncated: result.truncated, generation: result.generation };
}

type ExactCounts = {
  active: number;
  triggered: number;
  critical: number;
  unassigned: number;
  unassignedCritical: number;
};

/**
 * Database-exact counters for the viewer's full authorization scope. Only used when the working
 * set was truncated; otherwise the in-memory set is already complete and exact.
 */
async function loadExactCounts(scope: LiveScope, generation: string | null): Promise<ExactCounts> {
  const result = await getCachedOrFetch(
    `live-exact:${scope.key}:w${Math.floor(Date.now() / LIVE_SET_WINDOW_MS)}`,
    async () => {
      const base: Prisma.IncidentWhereInput = { AND: [scope.where, activeWhere] };
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
  return result.data;
}

async function loadActivity(
  scope: LiveScope,
  generation: string | null
): Promise<LiveActivityItem[]> {
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
  return result.rows;
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

async function loadOnCall(actor: AuthorizationActor): Promise<LiveOnCallShift[]> {
  const scheduleWhere = resolveScheduleWhere(actor);
  if (!scheduleWhere) return [];
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
  return result.data;
}

type LiveTrendRowWithId = LiveTrendRow & { id: string };

async function loadTrendRows(scope: LiveScope): Promise<LiveTrendRow[]> {
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
  return result.rows;
}

async function loadSchedules(
  actor: AuthorizationActor
): Promise<Array<{ id: string; name: string }>> {
  const scheduleWhere = resolveScheduleWhere(actor);
  if (!scheduleWhere) return [];
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

/**
 * In-process memo for derived projections. Derivation is synchronous CPU work over the whole
 * working set (tens of milliseconds at thousands of incidents), so identical work requested by
 * many viewers inside one short window is done once. Entries are never shared across different
 * authorization scopes: the key always begins with the scope key.
 */
const DERIVATION_MEMO_MS = 2_000;
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
  const [{ set, truncated, generation: reflected }, activity, onCall, trendRows, schedules] =
    await Promise.all([
      loadActiveSet(scope, generation),
      loadActivity(scope, generation).catch(() => [] as LiveActivityItem[]),
      loadOnCall(actor).catch(() => [] as LiveOnCallShift[]),
      loadTrendRows(scope).catch(() => [] as LiveTrendRow[]),
      loadSchedules(actor).catch(() => [] as Array<{ id: string; name: string }>),
    ]);
  const ctx = { actorId: actor.id, teamIds: [...actor.teamIds], now: Date.now() };
  // SLA signals are minute-granular, so derivations are computed against a 2s time bucket and
  // shared by every viewer of the same scope, set generation and query.
  const bucket = Math.floor(ctx.now / DERIVATION_MEMO_MS);
  const derived =
    isActorNeutralQuery(query) && scope.partitions.length === 1
      ? personalizeDerivation(
          memoized<SharedDerivation>(
            `shared|${scope.key}|g${reflected ?? 'none'}|t${bucket}|${liveQueryKey(query)}`,
            () => deriveShared(set, query, bucket * DERIVATION_MEMO_MS)
          ),
          query,
          ctx,
          limit,
          options.pinIds
        )
      : deriveLiveProjection(set, query, ctx, limit, { pinIds: options.pinIds });
  const trend =
    query.scope === 'all'
      ? memoized(`trend|${scope.key}|t${bucket}|${trendRows.length}`, () =>
          deriveTrend(trendRows, 'all', ctx)
        )
      : deriveTrend(trendRows, query.scope, ctx);

  let summary = derived.summary;
  let total = derived.total;
  let countsExact = !truncated;
  if (truncated && query.scope === 'all') {
    // The working set is a bounded window. Headline counters over the whole visible population
    // come from the database so they stay exact; SLA signals remain window-based.
    try {
      const exact = await loadExactCounts(scope, generation);
      summary = {
        ...summary,
        active: exact.active,
        triggered: exact.triggered,
        acknowledged: Math.max(0, exact.active - exact.triggered),
        critical: exact.critical,
        unassigned: exact.unassigned,
        unassignedCritical: exact.unassignedCritical,
      };
      if (query.view === 'active' && countActiveFacets(query) === 0) total = exact.active;
      countsExact = true;
    } catch {
      countsExact = false;
    }
  }

  return {
    query,
    incidents: derived.incidents,
    total,
    facets: derived.facets,
    summary,
    pinned: derived.pinned,
    attention: derived.attention,
    trend,
    coverage: deriveCoverage(actor.id, onCall, schedules),
    rail: {
      myQueue: derived.myQueue,
      slaRisk: derived.slaRisk,
      servicesAtRisk: derived.servicesAtRisk,
      activity,
      onCall,
    },
    truncated,
    workingSet: set.length,
    countsExact,
    asOf: new Date().toISOString(),
    // The generation this snapshot actually reflects (never newer than the viewer's knowledge).
    generation: reflected ?? generation,
  };
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

  const setRow: LiveSetRow = {
    ...toSetRow(row, scope.sensitive),
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
