/**
 * Client/server contract for the dashboard Live Incidents feed.
 *
 * The feed is a *current-state* projection: it always means "active now"
 * (OPEN + ACKNOWLEDGED) and is intentionally independent from the dashboard's
 * historical reporting range so a page-load timestamp can never hide new incidents.
 */

export const LIVE_INCIDENT_FILTERS = ['active', 'critical', 'mine', 'my_teams'] as const;
export type LiveIncidentFilter = (typeof LIVE_INCIDENT_FILTERS)[number];

export const LIVE_ACTIVE_STATUSES = ['OPEN', 'ACKNOWLEDGED'] as const;
export const LIVE_INCIDENT_DEFAULT_LIMIT = 50;
export const LIVE_INCIDENT_MAX_LIMIT = 100;
export const LIVE_INCIDENT_VISIBLE_ROWS = 10;

export const LIVE_INCIDENT_FILTER_LABELS: Record<LiveIncidentFilter, string> = {
  active: 'All Active',
  critical: 'Critical',
  mine: 'Mine',
  my_teams: 'My Teams',
};

export type LiveIncident = {
  id: string;
  title: string;
  status: 'OPEN' | 'ACKNOWLEDGED';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  service: { id: string; name: string };
  team: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
};

export const LIVE_STATUS_FILTERS = ['all', 'OPEN', 'ACKNOWLEDGED'] as const;
export const LIVE_URGENCY_FILTERS = ['all', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const LIVE_ASSIGNMENT_FILTERS = ['all', 'unassigned', 'assigned'] as const;
export type LiveStatusFilter = (typeof LIVE_STATUS_FILTERS)[number];
export type LiveUrgencyFilter = (typeof LIVE_URGENCY_FILTERS)[number];
export type LiveAssignmentFilter = (typeof LIVE_ASSIGNMENT_FILTERS)[number];

/** Full live-feed query: a quick view plus optional narrowing facets. */
export type LiveIncidentQuery = {
  filter: LiveIncidentFilter;
  serviceId: string | null;
  status: LiveStatusFilter;
  urgency: LiveUrgencyFilter;
  assignment: LiveAssignmentFilter;
};

export const DEFAULT_LIVE_INCIDENT_QUERY: LiveIncidentQuery = {
  filter: 'active',
  serviceId: null,
  status: 'all',
  urgency: 'all',
  assignment: 'all',
};

const SERVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function isValidServiceId(value: unknown): value is string {
  return typeof value === 'string' && SERVICE_ID_PATTERN.test(value);
}

export function countActiveFacets(query: LiveIncidentQuery): number {
  return (
    (query.serviceId ? 1 : 0) +
    (query.status !== 'all' ? 1 : 0) +
    (query.urgency !== 'all' ? 1 : 0) +
    (query.assignment !== 'all' ? 1 : 0)
  );
}

/** Stable, canonical query string (also used as the server cache key). */
export function liveIncidentQueryString(query: LiveIncidentQuery): string {
  const params = new URLSearchParams();
  params.set('filter', query.filter);
  if (query.serviceId) params.set('service', query.serviceId);
  if (query.status !== 'all') params.set('status', query.status);
  if (query.urgency !== 'all') params.set('urgency', query.urgency);
  if (query.assignment !== 'all') params.set('assignment', query.assignment);
  return params.toString();
}

/** Lenient parse for persisted client preferences; invalid fields fall back to defaults. */
export function coerceLiveIncidentQuery(value: unknown): LiveIncidentQuery {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const pick = <T extends string>(options: readonly T[], input: unknown, fallback: T): T =>
    typeof input === 'string' && (options as readonly string[]).includes(input)
      ? (input as T)
      : fallback;
  return {
    filter: pick(LIVE_INCIDENT_FILTERS, raw.filter, 'active'),
    serviceId: isValidServiceId(raw.serviceId) ? raw.serviceId : null,
    status: pick(LIVE_STATUS_FILTERS, raw.status, 'all'),
    urgency: pick(LIVE_URGENCY_FILTERS, raw.urgency, 'all'),
    assignment: pick(LIVE_ASSIGNMENT_FILTERS, raw.assignment, 'all'),
  };
}

export function sameLiveIncidentQuery(a: LiveIncidentQuery, b: LiveIncidentQuery): boolean {
  return liveIncidentQueryString(a) === liveIncidentQueryString(b);
}

export type LiveIncidentFeed = {
  query: LiveIncidentQuery;
  filter: LiveIncidentFilter;
  incidents: LiveIncident[];
  total: number;
  asOf: string;
  generation: string | null;
};

export function parseLiveIncidentFilter(value: unknown): LiveIncidentFilter | null {
  if (value === undefined || value === null || value === '') return 'active';
  return typeof value === 'string' && (LIVE_INCIDENT_FILTERS as readonly string[]).includes(value)
    ? (value as LiveIncidentFilter)
    : null;
}

/** Mirrors the dashboard "ACTIVE" pseudo-status: never a literal database status. */
export function isActiveStatus(status: unknown): status is 'OPEN' | 'ACKNOWLEDGED' {
  return status === 'OPEN' || status === 'ACKNOWLEDGED';
}

export function isCriticalIncident(incident: Pick<LiveIncident, 'urgency' | 'priority'>): boolean {
  return incident.urgency === 'HIGH' || incident.priority === 'P1';
}

/** Newest first; ties broken by id so ordering is stable across refetches. */
export function sortLiveIncidents(items: LiveIncident[]): LiveIncident[] {
  return [...items].sort((a, b) => {
    const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return delta !== 0 ? delta : b.id.localeCompare(a.id);
  });
}

export type LiveFeedDiff = {
  added: string[];
  updated: string[];
  removed: string[];
};

/**
 * Compares the displayed snapshot to a canonical snapshot. Used to highlight
 * genuinely new rows and to count pending changes while live updates are paused.
 */
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
