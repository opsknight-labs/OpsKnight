import { projectIncidentSlaState } from '@/lib/incident-sla/state';
import {
  compareNewestFirst,
  isCriticalIncident,
  LIVE_INCIDENT_VIEWS,
  LIVE_MAX_PINS,
  type LiveAttentionItem,
  type LiveFacetOption,
  type LiveFacets,
  type LiveIncident,
  type LiveIncidentQuery,
  type LiveIncidentView,
  type LiveScope,
  type LiveSlaSignal,
  type LiveSummary,
  type LiveTrend,
} from './live-incidents-shared';

/**
 * Pure, in-memory derivation of every live dashboard projection from one authorized active set.
 * The database is queried once per scope per change; scope, views, facets, summary, attention and
 * rail widgets are all computed here, so filter changes and additional viewers cost no queries.
 */

export type LiveSetRow = Omit<LiveIncident, 'sla'>;

export type LiveEngineContext = { actorId: string; teamIds: readonly string[]; now: number };

/** Timestamps of incidents touched in the last 24h, used for trends and tile deltas. */
export type LiveTrendRow = {
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  critical: boolean;
  assigneeId: string | null;
  teamId: string | null;
  serviceTeamId: string | null;
};

const RAIL_LIMIT = 5;
const ATTENTION_LIMIT = 6;
const SERVICES_AT_RISK_LIMIT = 8;
const MINUTE = 60_000;
const SLA_AT_RISK_WINDOW_MS = 30 * MINUTE;
const SLA_RECENT_BREACH_MS = 60 * MINUTE;
const SLA_DUE_SOON_MS = 10 * MINUTE;

const toDate = (value: string | null) => (value === null ? null : new Date(value));

export function computeSlaSignal(row: LiveSetRow, now: number): LiveSlaSignal {
  const state = projectIncidentSlaState(
    {
      status: row.status,
      createdAt: new Date(row.createdAt),
      acknowledgedAt: toDate(row.acknowledgedAt),
      slaFirstAcknowledgedAt: toDate(row.slaFirstAcknowledgedAt),
      resolvedAt: null,
      slaAckTargetMs: row.slaAckTargetMs,
      slaResolveTargetMs: row.slaResolveTargetMs,
      slaTargetSource: row.slaTargetSource,
      slaTargetCapturedAt: toDate(row.slaTargetCapturedAt),
      slaPausedMs: row.slaPausedMs,
      slaPauseStartedAt: toDate(row.slaPauseStartedAt),
      slaAckElapsedMs: row.slaAckElapsedMs,
      slaResolveElapsedMs: row.slaResolveElapsedMs,
    },
    { now: new Date(now) }
  );
  if (!state.valid) return { warning: 'NONE', phase: null, deadline: null };
  const rank = { NONE: 0, APPROACHING: 1, BREACHED: 2 } as const;
  const ack = state.ack.applicability === 'REQUIRED' ? state.ack : null;
  const resolve = state.resolve.applicability === 'REQUIRED' ? state.resolve : null;
  const ackRank = ack ? rank[ack.warning] : 0;
  const resolveRank = resolve ? rank[resolve.warning] : 0;
  if (ackRank === 0 && resolveRank === 0) {
    // Not yet in the warning window: still expose the next deadline for "due soon" logic.
    const pending =
      ack?.status === 'PENDING' ? ack : resolve?.status === 'PENDING' ? resolve : null;
    return {
      warning: 'NONE',
      phase: pending === ack && pending ? 'ack' : pending ? 'resolve' : null,
      deadline: pending?.breachAt ? pending.breachAt.toISOString() : null,
    };
  }
  const phase = ackRank >= resolveRank ? ack! : resolve!;
  return {
    warning: phase.warning,
    phase: ackRank >= resolveRank ? 'ack' : 'resolve',
    deadline: phase.breachAt ? phase.breachAt.toISOString() : null,
  };
}

/** Due within 30 minutes, or breached within the last hour: actionable, not historical. */
export function isSlaAtRisk(incident: Pick<LiveIncident, 'sla'>, now: number): boolean {
  if (!incident.sla.deadline) return false;
  const delta = Date.parse(incident.sla.deadline) - now;
  return delta <= SLA_AT_RISK_WINDOW_MS && delta > -SLA_RECENT_BREACH_MS;
}

function isSlaDueSoon(incident: Pick<LiveIncident, 'sla'>, now: number): boolean {
  if (!incident.sla.deadline) return false;
  const delta = Date.parse(incident.sla.deadline) - now;
  return delta >= 0 && delta <= SLA_DUE_SOON_MS;
}

function isSlaRecentlyBreached(incident: Pick<LiveIncident, 'sla'>, now: number): boolean {
  if (!incident.sla.deadline) return false;
  const delta = Date.parse(incident.sla.deadline) - now;
  return delta < 0 && delta > -SLA_RECENT_BREACH_MS;
}

function inTeams(
  row: { team: { id: string } | null; service: { teamId: string | null } },
  teamIds: readonly string[]
): boolean {
  if (teamIds.length === 0) return false;
  return (
    (row.team !== null && teamIds.includes(row.team.id)) ||
    (row.service.teamId !== null && teamIds.includes(row.service.teamId))
  );
}

export function matchesScope(
  row: LiveIncident,
  scope: LiveScope,
  ctx: Pick<LiveEngineContext, 'actorId' | 'teamIds'>
): boolean {
  if (scope === 'mine') return row.assignee?.id === ctx.actorId;
  if (scope === 'teams') return inTeams(row, ctx.teamIds) || row.assignee?.id === ctx.actorId;
  return true;
}

export function matchesView(
  row: LiveIncident,
  view: LiveIncidentView,
  ctx: Pick<LiveEngineContext, 'actorId' | 'teamIds' | 'now'>
): boolean {
  switch (view) {
    case 'critical':
      return isCriticalIncident(row);
    case 'mine':
      return row.assignee?.id === ctx.actorId;
    case 'my_teams':
      return inTeams(row, ctx.teamIds);
    case 'unassigned':
      return row.assignee === null;
    case 'breaching':
      return isSlaAtRisk(row, ctx.now);
    case 'active':
    default:
      return true;
  }
}

type FacetKey = 'serviceId' | 'teamId' | 'status' | 'urgency' | 'assignment' | 'search';

function matchesFacet(row: LiveIncident, query: LiveIncidentQuery, key: FacetKey): boolean {
  switch (key) {
    case 'serviceId':
      return !query.serviceId || row.service.id === query.serviceId;
    case 'teamId':
      return !query.teamId || inTeams(row, [query.teamId]);
    case 'status':
      return query.status === 'all' || row.status === query.status;
    case 'urgency':
      return query.urgency === 'all' || row.urgency === query.urgency;
    case 'assignment':
      return (
        query.assignment === 'all' ||
        (query.assignment === 'unassigned' ? row.assignee === null : row.assignee !== null)
      );
    case 'search': {
      if (!query.search) return true;
      const needle = query.search.toLowerCase();
      return (
        row.title.toLowerCase().includes(needle) ||
        row.service.name.toLowerCase().includes(needle) ||
        row.id.toLowerCase() === needle
      );
    }
  }
}

const FACET_KEYS: FacetKey[] = ['serviceId', 'teamId', 'status', 'urgency', 'assignment', 'search'];

function matchesFacetsExcept(row: LiveIncident, query: LiveIncidentQuery, skip?: FacetKey) {
  for (const key of FACET_KEYS) {
    if (key !== skip && !matchesFacet(row, query, key)) return false;
  }
  return true;
}

function groupOptions(
  rows: LiveIncident[],
  keyOf: (row: LiveIncident) => { id: string; name: string } | null
): LiveFacetOption[] {
  const groups = new Map<string, LiveFacetOption>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = groups.get(key.id) ?? { id: key.id, name: key.name, count: 0, critical: 0 };
    group.count += 1;
    if (isCriticalIncident(row)) group.critical += 1;
    groups.set(key.id, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.critical - a.critical || b.count - a.count || a.name.localeCompare(b.name)
  );
}

const deadlineOf = (row: LiveIncident) =>
  row.sla.deadline ? Date.parse(row.sla.deadline) : Number.POSITIVE_INFINITY;

/**
 * "Needs attention" ordering: critical first, then the soonest SLA deadline (overdue first),
 * then unowned work, triggered before acknowledged, then newest.
 */
export function compareAttention(now: number) {
  return (a: LiveIncident, b: LiveIncident): number => {
    const critical = Number(isCriticalIncident(b)) - Number(isCriticalIncident(a));
    if (critical !== 0) return critical;
    const risk = Number(isSlaAtRisk(b, now)) - Number(isSlaAtRisk(a, now));
    if (risk !== 0) return risk;
    const deadline = deadlineOf(a) - deadlineOf(b);
    if (deadline !== 0 && Number.isFinite(deadline)) return deadline;
    const unowned = Number(b.assignee === null) - Number(a.assignee === null);
    if (unowned !== 0) return unowned;
    const triggered = Number(b.status === 'OPEN') - Number(a.status === 'OPEN');
    if (triggered !== 0) return triggered;
    return compareNewestFirst(a, b);
  };
}

function formatShort(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}`;
}

export function deriveAttention(rows: LiveIncident[], now: number): LiveAttentionItem[] {
  const items: Array<LiveAttentionItem & { rank: number }> = [];
  for (const incident of rows) {
    if (isSlaAtRisk(incident, now)) {
      const delta = deadlineOf(incident) - now;
      const phase = incident.sla.phase === 'resolve' ? 'Resolve' : 'Ack';
      items.push({
        incident,
        reason: 'sla',
        label:
          delta >= 0 ? `${phase} in ${formatShort(delta)}` : `${phase} ${formatShort(delta)} late`,
        tone: delta >= 0 ? 'amber' : 'rose',
        rank: delta,
      });
    } else if (incident.assignee === null && isCriticalIncident(incident)) {
      items.push({
        incident,
        reason: 'unowned',
        label: `No owner · ${incident.priority ?? 'High'}`,
        tone: 'rose',
        rank: SLA_AT_RISK_WINDOW_MS + 1,
      });
    } else if ((incident.escalationLevel ?? 0) >= 2) {
      items.push({
        incident,
        reason: 'escalated',
        label: `Escalated L${incident.escalationLevel}`,
        tone: 'violet',
        rank: SLA_AT_RISK_WINDOW_MS + 2 - (incident.escalationLevel ?? 0) / 100,
      });
    }
  }
  return items
    .sort((a, b) => a.rank - b.rank || compareNewestFirst(a.incident, b.incident))
    .slice(0, ATTENTION_LIMIT)
    .map(({ rank: _rank, ...item }) => item);
}

const HOUR = 60 * MINUTE;

export function deriveTrend(
  rows: LiveTrendRow[],
  scope: LiveScope,
  ctx: LiveEngineContext
): LiveTrend {
  const start = ctx.now - 24 * HOUR;
  const bucket = (iso: string | null) => {
    if (!iso) return -1;
    const time = Date.parse(iso);
    if (time < start || time > ctx.now) return -1;
    return Math.min(23, Math.floor((time - start) / HOUR));
  };
  const empty = () => Array.from({ length: 24 }, () => 0);
  const trend: LiveTrend = {
    created: empty(),
    createdCritical: empty(),
    acknowledged: empty(),
    resolved: empty(),
    createdLastHour: 0,
    createdCriticalLastHour: 0,
    acknowledgedLastHour: 0,
    resolved24h: 0,
    mtta24h: null,
    mttr24h: null,
  };
  let ackTotal = 0;
  let ackSamples = 0;
  let resolveTotal = 0;
  let resolveSamples = 0;
  const lastHour = ctx.now - HOUR;
  for (const row of rows) {
    const inScope =
      scope === 'all' ||
      row.assigneeId === ctx.actorId ||
      (scope === 'teams' &&
        ((row.teamId !== null && ctx.teamIds.includes(row.teamId)) ||
          (row.serviceTeamId !== null && ctx.teamIds.includes(row.serviceTeamId))));
    if (!inScope) continue;
    const created = bucket(row.createdAt);
    if (created >= 0) {
      trend.created.splice(created, 1, (trend.created.at(created) ?? 0) + 1);
      if (row.critical) {
        trend.createdCritical.splice(created, 1, (trend.createdCritical.at(created) ?? 0) + 1);
      }
      if (Date.parse(row.createdAt) >= lastHour) {
        trend.createdLastHour += 1;
        if (row.critical) trend.createdCriticalLastHour += 1;
      }
    }
    const acked = bucket(row.acknowledgedAt);
    if (acked >= 0 && row.acknowledgedAt) {
      trend.acknowledged.splice(acked, 1, (trend.acknowledged.at(acked) ?? 0) + 1);
      if (Date.parse(row.acknowledgedAt) >= lastHour) trend.acknowledgedLastHour += 1;
      ackTotal += Date.parse(row.acknowledgedAt) - Date.parse(row.createdAt);
      ackSamples += 1;
    }
    const resolved = bucket(row.resolvedAt);
    if (resolved >= 0 && row.resolvedAt) {
      trend.resolved.splice(resolved, 1, (trend.resolved.at(resolved) ?? 0) + 1);
      trend.resolved24h += 1;
      resolveTotal += Date.parse(row.resolvedAt) - Date.parse(row.createdAt);
      resolveSamples += 1;
    }
  }
  trend.mtta24h = ackSamples ? Math.max(0, ackTotal / ackSamples / MINUTE) : null;
  trend.mttr24h = resolveSamples ? Math.max(0, resolveTotal / resolveSamples / MINUTE) : null;
  return trend;
}

export type LiveDerivation = {
  incidents: LiveIncident[];
  total: number;
  facets: LiveFacets;
  summary: LiveSummary;
  pinned: LiveIncident[];
  attention: LiveAttentionItem[];
  myQueue: LiveIncident[];
  slaRisk: LiveIncident[];
  servicesAtRisk: LiveFacetOption[];
};

export function deriveLiveProjection(
  set: LiveSetRow[],
  query: LiveIncidentQuery,
  ctx: LiveEngineContext,
  limit: number,
  options: { pinIds?: readonly string[] } = {}
): LiveDerivation {
  const all: LiveIncident[] = set
    .map(row => ({ ...row, sla: computeSlaSignal(row, ctx.now) }))
    .sort(compareNewestFirst);
  const rows = all.filter(row => matchesScope(row, query.scope, ctx));

  const inView = rows.filter(row => matchesView(row, query.view, ctx));
  const matching = inView.filter(row => matchesFacetsExcept(row, query));
  if (query.sort === 'attention') matching.sort(compareAttention(ctx.now));

  const viewCounts = new Map<LiveIncidentView, number>(LIVE_INCIDENT_VIEWS.map(view => [view, 0]));
  const status = { OPEN: 0, ACKNOWLEDGED: 0 };
  const urgency = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const assignment = { assigned: 0, unassigned: 0 };
  for (const row of rows) {
    if (matchesFacetsExcept(row, query)) {
      for (const view of LIVE_INCIDENT_VIEWS) {
        if (matchesView(row, view, ctx)) viewCounts.set(view, (viewCounts.get(view) ?? 0) + 1);
      }
    }
  }
  const views = Object.fromEntries(viewCounts) as LiveFacets['views'];
  for (const row of inView) {
    if (matchesFacetsExcept(row, query, 'status')) status[row.status] += 1;
    if (matchesFacetsExcept(row, query, 'urgency')) urgency[row.urgency] += 1;
    if (matchesFacetsExcept(row, query, 'assignment')) {
      assignment[row.assignee ? 'assigned' : 'unassigned'] += 1;
    }
  }
  const services = groupOptions(
    inView.filter(row => matchesFacetsExcept(row, query, 'serviceId')),
    row => row.service
  );
  const teams = groupOptions(
    inView.filter(row => matchesFacetsExcept(row, query, 'teamId')),
    row => row.team
  );

  const summary: LiveSummary = {
    active: rows.length,
    triggered: 0,
    acknowledged: 0,
    critical: 0,
    unassigned: 0,
    unassignedCritical: 0,
    slaBreached: 0,
    slaAtRisk: 0,
    slaDueSoon: 0,
    slaRecentlyBreached: 0,
    mine: 0,
  };
  for (const row of rows) {
    if (row.status === 'OPEN') summary.triggered += 1;
    else summary.acknowledged += 1;
    const critical = isCriticalIncident(row);
    if (critical) summary.critical += 1;
    if (!row.assignee) {
      summary.unassigned += 1;
      if (critical) summary.unassignedCritical += 1;
    }
    if (row.sla.warning === 'BREACHED') summary.slaBreached += 1;
    if (isSlaAtRisk(row, ctx.now)) summary.slaAtRisk += 1;
    if (isSlaDueSoon(row, ctx.now)) summary.slaDueSoon += 1;
    if (isSlaRecentlyBreached(row, ctx.now)) summary.slaRecentlyBreached += 1;
  }
  // "Mine" is always counted across the full visible set, independent of scope.
  summary.mine = all.filter(row => row.assignee?.id === ctx.actorId).length;

  const severity = (row: LiveIncident) => (isCriticalIncident(row) ? 0 : 1);
  const myQueue = all
    .filter(row => row.assignee?.id === ctx.actorId)
    .sort((a, b) => severity(a) - severity(b) || compareNewestFirst(a, b))
    .slice(0, RAIL_LIMIT);
  const slaRisk = rows
    .filter(row => isSlaAtRisk(row, ctx.now))
    .sort((a, b) => deadlineOf(a) - deadlineOf(b) || compareNewestFirst(a, b))
    .slice(0, RAIL_LIMIT);
  const servicesAtRisk = groupOptions(rows, row => row.service).slice(0, SERVICES_AT_RISK_LIMIT);
  // Pins keep the order the user pinned them in so the strip never reshuffles.
  const byId = new Map(all.map(row => [row.id, row]));
  const pinned = (options.pinIds ?? []).slice(0, LIVE_MAX_PINS).flatMap(id => byId.get(id) ?? []);

  return {
    incidents: matching.slice(0, limit),
    total: matching.length,
    facets: { views, services, teams, status, urgency, assignment },
    summary,
    pinned,
    attention: deriveAttention(rows, ctx.now),
    myQueue,
    slaRisk,
    servicesAtRisk,
  };
}
