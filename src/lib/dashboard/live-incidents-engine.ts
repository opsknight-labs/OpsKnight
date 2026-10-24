import { projectIncidentSlaState } from '@/lib/incident-sla/state';
import {
  compareNewestFirst,
  isCriticalIncident,
  type LiveFacetOption,
  type LiveFacets,
  type LiveIncident,
  type LiveIncidentQuery,
  type LiveIncidentView,
  type LiveSlaSignal,
  type LiveSummary,
  LIVE_INCIDENT_VIEWS,
} from './live-incidents-shared';

/**
 * Pure, in-memory derivation of every live dashboard projection from one authorized active set.
 * The database is queried once per scope per change; views, facets, summary and rail widgets
 * are all computed here, so filter changes and additional viewers cost no extra queries.
 */

export type LiveSetRow = Omit<LiveIncident, 'sla'>;

export type LiveEngineContext = { actorId: string; teamIds: readonly string[]; now: number };

const RAIL_LIMIT = 5;
const SERVICES_AT_RISK_LIMIT = 8;

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
  if (ackRank === 0 && resolveRank === 0) return { warning: 'NONE', phase: null, deadline: null };
  const phase = ackRank >= resolveRank ? ack! : resolve!;
  return {
    warning: phase.warning,
    phase: ackRank >= resolveRank ? 'ack' : 'resolve',
    deadline: phase.breachAt ? phase.breachAt.toISOString() : null,
  };
}

function inTeams(row: LiveSetRow, teamIds: readonly string[]): boolean {
  if (teamIds.length === 0) return false;
  return (
    (row.team !== null && teamIds.includes(row.team.id)) ||
    (row.service.teamId !== null && teamIds.includes(row.service.teamId))
  );
}

export function matchesView(
  row: LiveIncident,
  view: LiveIncidentView,
  ctx: Pick<LiveEngineContext, 'actorId' | 'teamIds'>
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
      return row.sla.warning !== 'NONE';
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

export type LiveDerivation = {
  incidents: LiveIncident[];
  total: number;
  facets: LiveFacets;
  summary: LiveSummary;
  myQueue: LiveIncident[];
  slaRisk: LiveIncident[];
  servicesAtRisk: LiveFacetOption[];
};

export function deriveLiveProjection(
  set: LiveSetRow[],
  query: LiveIncidentQuery,
  ctx: LiveEngineContext,
  limit: number
): LiveDerivation {
  const rows: LiveIncident[] = set
    .map(row => ({ ...row, sla: computeSlaSignal(row, ctx.now) }))
    .sort(compareNewestFirst);

  const inView = rows.filter(row => matchesView(row, query.view, ctx));
  const matching = inView.filter(row => matchesFacetsExcept(row, query));

  const views = Object.fromEntries(
    LIVE_INCIDENT_VIEWS.map(view => [view, 0])
  ) as LiveFacets['views'];
  const status = { OPEN: 0, ACKNOWLEDGED: 0 };
  const urgency = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const assignment = { assigned: 0, unassigned: 0 };
  for (const row of rows) {
    if (matchesFacetsExcept(row, query)) {
      for (const view of LIVE_INCIDENT_VIEWS) if (matchesView(row, view, ctx)) views[view] += 1;
    }
  }
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
    slaBreached: 0,
    slaAtRisk: 0,
    mine: 0,
  };
  for (const row of rows) {
    if (row.status === 'OPEN') summary.triggered += 1;
    else summary.acknowledged += 1;
    if (isCriticalIncident(row)) summary.critical += 1;
    if (!row.assignee) summary.unassigned += 1;
    if (row.sla.warning === 'BREACHED') summary.slaBreached += 1;
    if (row.sla.warning !== 'NONE') summary.slaAtRisk += 1;
    if (row.assignee?.id === ctx.actorId) summary.mine += 1;
  }

  const severity = (row: LiveIncident) => (isCriticalIncident(row) ? 0 : 1);
  const myQueue = rows
    .filter(row => row.assignee?.id === ctx.actorId)
    .sort((a, b) => severity(a) - severity(b) || compareNewestFirst(a, b))
    .slice(0, RAIL_LIMIT);
  const deadline = (row: LiveIncident) =>
    row.sla.deadline ? Date.parse(row.sla.deadline) : Number.POSITIVE_INFINITY;
  const slaRisk = rows
    .filter(row => row.sla.warning !== 'NONE')
    .sort((a, b) => deadline(a) - deadline(b) || compareNewestFirst(a, b))
    .slice(0, RAIL_LIMIT);
  const servicesAtRisk = groupOptions(rows, row => row.service).slice(0, SERVICES_AT_RISK_LIMIT);

  return {
    incidents: matching.slice(0, limit),
    total: matching.length,
    facets: { views, services, teams, status, urgency, assignment },
    summary,
    myQueue,
    slaRisk,
    servicesAtRisk,
  };
}
