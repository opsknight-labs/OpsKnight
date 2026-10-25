/**
 * Client/server contract for the dashboard live projection.
 *
 * The live feed is a *current-state* projection: "active" always means OPEN + ACKNOWLEDGED and
 * is independent from the dashboard's historical reporting range, so a page-load timestamp can
 * never hide new incidents.
 */

export const LIVE_INCIDENT_VIEWS = [
  'active',
  'critical',
  'mine',
  'my_teams',
  'unassigned',
  'breaching',
] as const;
export type LiveIncidentView = (typeof LIVE_INCIDENT_VIEWS)[number];

export const LIVE_VIEW_LABELS: Record<LiveIncidentView, string> = {
  active: 'All Active',
  critical: 'Critical',
  mine: 'Mine',
  my_teams: 'My Teams',
  unassigned: 'Unassigned',
  breaching: 'SLA Risk',
};

export function liveViewLabel(view: LiveIncidentView): string {
  switch (view) {
    case 'critical':
      return 'Critical';
    case 'mine':
      return 'Mine';
    case 'my_teams':
      return 'My Teams';
    case 'unassigned':
      return 'Unassigned';
    case 'breaching':
      return 'SLA Risk';
    case 'active':
    default:
      return 'All Active';
  }
}

/** Dashboard reporting period (MTTA/MTTR and trends). Live state is never range-bound. */
export const HISTORY_RANGES = ['7', '30', '90'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
export type HistoryQuery = { range: HistoryRange };

export function parseHistoryRange(value: string | null | undefined): HistoryRange {
  return value === '7' || value === '90' ? value : '30';
}

export const LIVE_SCOPES = ['all', 'teams', 'mine'] as const;
export type LiveScope = (typeof LIVE_SCOPES)[number];
export const LIVE_SORTS = ['newest', 'attention'] as const;
export type LiveSort = (typeof LIVE_SORTS)[number];
export const LIVE_MAX_PINS = 5;

export const LIVE_STATUS_OPTIONS = ['all', 'OPEN', 'ACKNOWLEDGED'] as const;
export const LIVE_URGENCY_OPTIONS = ['all', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const LIVE_ASSIGNMENT_OPTIONS = ['all', 'unassigned', 'assigned'] as const;
export type LiveStatusFilter = (typeof LIVE_STATUS_OPTIONS)[number];
export type LiveUrgencyFilter = (typeof LIVE_URGENCY_OPTIONS)[number];
export type LiveAssignmentFilter = (typeof LIVE_ASSIGNMENT_OPTIONS)[number];

export const LIVE_ACTIVE_STATUSES = ['OPEN', 'ACKNOWLEDGED'] as const;
export const LIVE_INCIDENT_DEFAULT_LIMIT = 50;
export const LIVE_INCIDENT_MAX_LIMIT = 100;
export const LIVE_INCIDENT_VISIBLE_ROWS = 10;
export const LIVE_SEARCH_MAX_LENGTH = 120;

export type LiveIncidentQuery = {
  /** Page-wide population: everything visible, my teams' incidents, or mine. */
  scope: LiveScope;
  sort: LiveSort;
  view: LiveIncidentView;
  serviceId: string | null;
  teamId: string | null;
  status: LiveStatusFilter;
  urgency: LiveUrgencyFilter;
  assignment: LiveAssignmentFilter;
  search: string;
};

export const DEFAULT_LIVE_QUERY: LiveIncidentQuery = {
  scope: 'all',
  sort: 'newest',
  view: 'active',
  serviceId: null,
  teamId: null,
  status: 'all',
  urgency: 'all',
  assignment: 'all',
  search: '',
};

/** URL parameter names; prefixed so they never collide with the history filters. */
export const LIVE_URL_PARAMS = {
  scope: 'lscope',
  sort: 'lsort',
  view: 'lview',
  serviceId: 'lservice',
  teamId: 'lteam',
  status: 'lstatus',
  urgency: 'lurgency',
  assignment: 'lassign',
  search: 'lq',
} as const;

/** API parameter names for /api/dashboard/live. */
export const LIVE_API_PARAMS = {
  scope: 'scope',
  sort: 'sort',
  view: 'view',
  serviceId: 'service',
  teamId: 'team',
  status: 'status',
  urgency: 'urgency',
  assignment: 'assignment',
  search: 'q',
} as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function pick<T extends string>(options: readonly T[], input: unknown, fallback: T): T {
  return typeof input === 'string' && (options as readonly string[]).includes(input)
    ? (input as T)
    : fallback;
}

export function normalizeSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, LIVE_SEARCH_MAX_LENGTH) : '';
}

/** Lenient parse for persisted preferences / URLs; invalid fields fall back to defaults. */
export function coerceLiveQuery(raw: Partial<Record<keyof LiveIncidentQuery, unknown>>) {
  return {
    scope: pick(LIVE_SCOPES, raw.scope, 'all'),
    sort: pick(LIVE_SORTS, raw.sort, 'newest'),
    view: pick(LIVE_INCIDENT_VIEWS, raw.view, 'active'),
    serviceId: isValidId(raw.serviceId) ? raw.serviceId : null,
    teamId: isValidId(raw.teamId) ? raw.teamId : null,
    status: pick(LIVE_STATUS_OPTIONS, raw.status, 'all'),
    urgency: pick(LIVE_URGENCY_OPTIONS, raw.urgency, 'all'),
    assignment: pick(LIVE_ASSIGNMENT_OPTIONS, raw.assignment, 'all'),
    search: normalizeSearch(raw.search),
  } satisfies LiveIncidentQuery;
}

export function liveQueryFromParams(
  params: URLSearchParams | { get(name: string): string | null },
  names: Record<keyof LiveIncidentQuery, string> = LIVE_URL_PARAMS
): LiveIncidentQuery {
  return coerceLiveQuery({
    scope: params.get(names.scope),
    sort: params.get(names.sort),
    view: params.get(names.view),
    serviceId: params.get(names.serviceId),
    teamId: params.get(names.teamId),
    status: params.get(names.status),
    urgency: params.get(names.urgency),
    assignment: params.get(names.assignment),
    search: params.get(names.search),
  });
}

/** Canonical, stable encoding. Default values are omitted. */
export function liveQueryToParams(
  query: LiveIncidentQuery,
  names: Record<keyof LiveIncidentQuery, string> = LIVE_API_PARAMS
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.scope !== 'all') params.set(names.scope, query.scope);
  if (query.sort !== 'newest') params.set(names.sort, query.sort);
  if (query.view !== 'active') params.set(names.view, query.view);
  if (query.serviceId) params.set(names.serviceId, query.serviceId);
  if (query.teamId) params.set(names.teamId, query.teamId);
  if (query.status !== 'all') params.set(names.status, query.status);
  if (query.urgency !== 'all') params.set(names.urgency, query.urgency);
  if (query.assignment !== 'all') params.set(names.assignment, query.assignment);
  if (query.search) params.set(names.search, query.search);
  return params;
}

export function liveQueryKey(query: LiveIncidentQuery): string {
  return liveQueryToParams(query).toString();
}

export function countActiveFacets(query: LiveIncidentQuery): number {
  return (
    (query.serviceId ? 1 : 0) +
    (query.teamId ? 1 : 0) +
    (query.status !== 'all' ? 1 : 0) +
    (query.urgency !== 'all' ? 1 : 0) +
    (query.assignment !== 'all' ? 1 : 0) +
    (query.search ? 1 : 0)
  );
}

export type LiveSlaFields = {
  acknowledgedAt: string | null;
  slaFirstAcknowledgedAt: string | null;
  slaAckTargetMs: number | null;
  slaResolveTargetMs: number | null;
  slaTargetSource: string | null;
  slaTargetCapturedAt: string | null;
  slaPausedMs: number;
  slaPauseStartedAt: string | null;
  slaAckElapsedMs: number | null;
  slaResolveElapsedMs: number | null;
};

export type LiveSlaSignal = {
  /** NONE when no actionable SLA signal (met, paused, not applicable or invalid). */
  warning: 'NONE' | 'APPROACHING' | 'BREACHED';
  phase: 'ack' | 'resolve' | null;
  /** Deadline of the phase that drives the signal (ISO), null when unavailable. */
  deadline: string | null;
};

/** Row content shared by the server working set and the wire format. */
export type LiveIncidentCore = {
  id: string;
  /** Escalation step (1-based) while escalating, otherwise null. */
  escalationLevel: number | null;
  alertCount: number;
  responderCount: number;
  title: string;
  status: 'OPEN' | 'ACKNOWLEDGED';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  priority: string | null;
  escalationStatus: string | null;
  createdAt: string;
  updatedAt: string;
  service: { id: string; name: string; teamId: string | null };
  team: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  /** Dedup key if assigned by inbound alert grouping, otherwise null. */
  dedupKey?: string | null;
  /** Service escalation policy name if configured. */
  escalationPolicyName?: string | null;
  /** Service automation routing rule matched at incident creation if any. */
  routeRuleName?: string | null;
  /** Most recent automated runbook execution status for this incident. */
  latestRunbook?: {
    name: string;
    status: string;
    completedAt: string | null;
    failureCode: string | null;
  } | null;
};

/**
 * What the server holds per active incident: the row plus the raw SLA inputs needed to derive
 * the signal at request time. These inputs never leave the server.
 */
export type LiveSetRow = LiveIncidentCore & LiveSlaFields;

/** Wire format: the row plus the server-derived SLA signal (no raw SLA inputs). */
export type LiveIncident = LiveIncidentCore & { sla: LiveSlaSignal };

export type LiveFacetOption = { id: string; name: string; count: number; critical: number };

export type LiveFacets = {
  views: Record<LiveIncidentView, number>;
  services: LiveFacetOption[];
  teams: LiveFacetOption[];
  status: Record<'OPEN' | 'ACKNOWLEDGED', number>;
  urgency: Record<'HIGH' | 'MEDIUM' | 'LOW', number>;
  assignment: Record<'assigned' | 'unassigned', number>;
};

export type LiveSummary = {
  /** Incidents whose next SLA deadline is still ahead but within 10 minutes. */
  slaDueSoon: number;
  /** Incidents that breached their SLA within the last hour (still recoverable signal). */
  slaRecentlyBreached: number;
  /** Unassigned incidents that are critical. */
  unassignedCritical: number;
  active: number;
  triggered: number;
  acknowledged: number;
  critical: number;
  unassigned: number;
  slaBreached: number;
  slaAtRisk: number;
  mine: number;
};

export type LiveActivityItem = {
  id: string;
  incidentId: string;
  incidentTitle: string;
  message: string;
  type: string | null;
  createdAt: string;
};

export type LiveAttentionReason = 'sla' | 'unowned' | 'escalated';
export type LiveAttentionItem = {
  incident: LiveIncident;
  reason: LiveAttentionReason;
  label: string;
  tone: 'rose' | 'amber' | 'violet';
};

/** Last-24h activity in the viewer's scope (hourly buckets, oldest first). */
export type LiveTrend = {
  created: number[];
  createdCritical: number[];
  acknowledged: number[];
  resolved: number[];
  createdLastHour: number;
  createdCriticalLastHour: number;
  acknowledgedLastHour: number;
  resolved24h: number;
  /** Minutes; null when there is no sample. */
  mtta24h: number | null;
  mttr24h: number | null;
};

export type LiveCoverage = {
  me: { onCall: boolean; schedules: string[]; until: string | null };
  gaps: Array<{ id: string; name: string }>;
  scheduleCount: number;
};

export type LiveOnCallShift = {
  id: string;
  scheduleId: string;
  end: string;
  scheduleName: string;
  user: { id: string | null; name: string; avatarUrl: string | null; gender: string | null };
};

export type LiveSnapshot = {
  query: LiveIncidentQuery;
  /** Rows matching the query, newest first, bounded by the request limit. */
  incidents: LiveIncident[];
  /** Total rows matching the query. */
  total: number;
  facets: LiveFacets;
  summary: LiveSummary;
  pinned: LiveIncident[];
  attention: LiveAttentionItem[];
  trend: LiveTrend;
  coverage: LiveCoverage;
  rail: {
    myQueue: LiveIncident[];
    slaRisk: LiveIncident[];
    servicesAtRisk: LiveFacetOption[];
    activity: LiveActivityItem[];
    onCall: LiveOnCallShift[];
  };
  /** True when the scoped active set exceeded the in-memory working-set window. */
  truncated: boolean;
  /** Incidents held in the in-memory working set this snapshot was derived from. */
  workingSet: number;
  /**
   * True when the headline counters and total are exact for the viewer's visible population:
   * either the working set is complete or the counters were read from the database.
   */
  countsExact: boolean;
  asOf: string;
  generation: string | null;
};

export function isActiveStatus(status: unknown): status is 'OPEN' | 'ACKNOWLEDGED' {
  return status === 'OPEN' || status === 'ACKNOWLEDGED';
}

export function isCriticalIncident(incident: Pick<LiveIncident, 'urgency' | 'priority'>): boolean {
  return incident.urgency === 'HIGH' || incident.priority === 'P1';
}

/** Newest first; ties broken by id so ordering is stable across refetches. */
export function compareNewestFirst(
  a: Pick<LiveIncident, 'createdAt' | 'id'>,
  b: Pick<LiveIncident, 'createdAt' | 'id'>
): number {
  const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return delta !== 0 ? delta : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export function sortLiveIncidents<T extends Pick<LiveIncident, 'createdAt' | 'id'>>(
  items: T[]
): T[] {
  return [...items].sort(compareNewestFirst);
}

export type LiveFeedDiff = { added: string[]; updated: string[]; removed: string[] };

export function diffLiveIncidents(previous: LiveIncident[], next: LiveIncident[]): LiveFeedDiff {
  const before = new Map(previous.map(item => [item.id, item]));
  const after = new Set(next.map(item => item.id));
  const added: string[] = [];
  const updated: string[] = [];
  for (const item of next) {
    const prior = before.get(item.id);
    if (!prior) added.push(item.id);
    else if (
      prior.updatedAt !== item.updatedAt ||
      prior.status !== item.status ||
      prior.assignee?.id !== item.assignee?.id ||
      prior.priority !== item.priority ||
      prior.urgency !== item.urgency ||
      prior.title !== item.title
    )
      updated.push(item.id);
  }
  const removed = previous.filter(item => !after.has(item.id)).map(item => item.id);
  return { added, updated, removed };
}

export function countLiveFeedChanges(diff: LiveFeedDiff): number {
  return diff.added.length + diff.updated.length + diff.removed.length;
}

export function formatIncidentAge(createdAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return 'Now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatCountdown(deadline: string, now: number): string {
  const deltaSeconds = Math.round((Date.parse(deadline) - now) / 1000);
  const overdue = deltaSeconds < 0;
  const seconds = Math.abs(deltaSeconds);
  const label =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m`
        : seconds < 86_400
          ? `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
          : `${Math.floor(seconds / 86_400)}d`;
  return overdue ? `${label} over` : `${label} left`;
}

export type LiveConnectionHealth = 'connecting' | 'live' | 'stale' | 'offline' | 'revoked';

/** Heartbeats arrive every 15s; two missed heartbeats means the stream is stale. */
export const LIVE_STALE_AFTER_MS = 45_000;

export function resolveConnectionHealth(input: {
  isConnected: boolean;
  revoked: boolean;
  online: boolean;
  lastMessageAt: number | null;
  now: number;
  everConnected: boolean;
}): LiveConnectionHealth {
  if (input.revoked) return 'revoked';
  if (!input.online) return 'offline';
  if (!input.isConnected) return input.everConnected ? 'offline' : 'connecting';
  if (input.lastMessageAt !== null && input.now - input.lastMessageAt > LIVE_STALE_AFTER_MS) {
    return 'stale';
  }
  return 'live';
}
