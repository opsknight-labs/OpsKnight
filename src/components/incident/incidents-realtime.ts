import type { IncidentListItem } from '@/types/incident-list';

/** The list filter a realtime incident must match to appear (mirrors the server query). */
export type IncidentRealtimeFilter = {
  filter?: string;
  actorId?: string;
  status?: string;
  serviceId?: string;
  assignee?: string;
  urgency?: string;
  priority?: string;
  teamId?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  sort?: string;
};

export function parseRealtimeIncident(raw: Record<string, unknown>): IncidentListItem {
  const rawService =
    raw.service && typeof raw.service === 'object'
      ? (raw.service as Record<string, unknown>)
      : null;
  const rawTeam =
    raw.team && typeof raw.team === 'object' ? (raw.team as Record<string, unknown>) : null;
  const rawAssignee =
    raw.assignee && typeof raw.assignee === 'object'
      ? (raw.assignee as Record<string, unknown>)
      : null;

  return {
    id: String(raw.id),
    title: String(raw.title || 'Untitled Incident'),
    status: (raw.status as IncidentListItem['status']) || 'OPEN',
    escalationStatus: typeof raw.escalationStatus === 'string' ? raw.escalationStatus : null,
    currentEscalationStep:
      typeof raw.currentEscalationStep === 'number' ? raw.currentEscalationStep : null,
    nextEscalationAt: raw.nextEscalationAt
      ? new Date(raw.nextEscalationAt as string | number | Date)
      : null,
    priority: typeof raw.priority === 'string' ? raw.priority : null,
    urgency: (raw.urgency as IncidentListItem['urgency']) || 'HIGH',
    createdAt: raw.createdAt ? new Date(raw.createdAt as string | number | Date) : new Date(),
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt as string | number | Date) : undefined,
    acknowledgedAt: raw.acknowledgedAt
      ? new Date(raw.acknowledgedAt as string | number | Date)
      : null,
    resolvedAt: raw.resolvedAt ? new Date(raw.resolvedAt as string | number | Date) : null,
    assigneeId: typeof raw.assigneeId === 'string' ? raw.assigneeId : null,
    teamId: typeof raw.teamId === 'string' ? raw.teamId : null,
    slaAckTargetMs: typeof raw.slaAckTargetMs === 'number' ? raw.slaAckTargetMs : null,
    slaResolveTargetMs: typeof raw.slaResolveTargetMs === 'number' ? raw.slaResolveTargetMs : null,
    slaTargetSource: typeof raw.slaTargetSource === 'string' ? raw.slaTargetSource : null,
    slaTargetCapturedAt: raw.slaTargetCapturedAt
      ? new Date(raw.slaTargetCapturedAt as string)
      : null,
    slaPausedMs: typeof raw.slaPausedMs === 'number' ? raw.slaPausedMs : 0,
    slaPauseStartedAt: raw.slaPauseStartedAt ? new Date(raw.slaPauseStartedAt as string) : null,
    slaAckElapsedMs: typeof raw.slaAckElapsedMs === 'number' ? raw.slaAckElapsedMs : null,
    slaResolveElapsedMs:
      typeof raw.slaResolveElapsedMs === 'number' ? raw.slaResolveElapsedMs : null,
    service: {
      id: typeof rawService?.id === 'string' ? rawService.id : 'unknown',
      name: typeof rawService?.name === 'string' ? rawService.name : 'Unknown Service',
    },
    team: rawTeam
      ? {
          id: String(rawTeam.id),
          name: String(rawTeam.name || 'Team'),
        }
      : null,
    assignee: rawAssignee
      ? {
          id: String(rawAssignee.id),
          name: String(rawAssignee.name || 'Unassigned'),
          email: String(rawAssignee.email || ''),
          avatarUrl: typeof rawAssignee.avatarUrl === 'string' ? rawAssignee.avatarUrl : null,
        }
      : null,
  };
}

const STATUS_SORT_WEIGHT: Record<string, number> = {
  OPEN: 1,
  ACKNOWLEDGED: 2,
  SNOOZED: 3,
  SUPPRESSED: 4,
  RESOLVED: 5,
};

const PRIORITY_SORT_WEIGHT: Record<string, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  P5: 5,
};

export function sortIncidents(
  items: IncidentListItem[],
  sort: string = 'newest'
): IncidentListItem[] {
  return [...items].sort((a, b) => {
    if (sort === 'oldest') {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    }
    if (sort === 'updated') {
      const timeA = a.updatedAt
        ? new Date(a.updatedAt).getTime()
        : a.createdAt
          ? new Date(a.createdAt).getTime()
          : 0;
      const timeB = b.updatedAt
        ? new Date(b.updatedAt).getTime()
        : b.createdAt
          ? new Date(b.createdAt).getTime()
          : 0;
      return timeB - timeA;
    }
    if (sort === 'status') {
      const sA = STATUS_SORT_WEIGHT[a.status] ?? 99;
      const sB = STATUS_SORT_WEIGHT[b.status] ?? 99;
      if (sA !== sB) return sA - sB;
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    }
    if (sort === 'priority') {
      const pA = a.priority ? (PRIORITY_SORT_WEIGHT[a.priority] ?? 99) : 999;
      const pB = b.priority ? (PRIORITY_SORT_WEIGHT[b.priority] ?? 99) : 999;
      if (pA !== pB) return pA - pB;
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    }
    // Default: 'newest' (createdAt desc)
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
}

export function matchesRealtimeFilter(
  raw: Record<string, unknown>,
  filter: IncidentRealtimeFilter
): boolean {
  const status = typeof raw.status === 'string' ? raw.status : '';
  const assigneeId = typeof raw.assigneeId === 'string' ? raw.assigneeId : null;
  const serviceId =
    raw.service &&
    typeof raw.service === 'object' &&
    typeof (raw.service as Record<string, unknown>).id === 'string'
      ? String((raw.service as Record<string, unknown>).id)
      : '';
  const filterName = filter.filter?.toLowerCase();
  if (
    filterName === 'mine' &&
    (assigneeId !== filter.actorId || !['OPEN', 'ACKNOWLEDGED'].includes(status))
  )
    return false;
  if (
    (filterName === 'all_open' || filterName === 'critical_focus') &&
    filter.status === undefined &&
    !['OPEN', 'ACKNOWLEDGED'].includes(status)
  )
    return false;
  if (filterName === 'critical_focus' && raw.urgency !== 'HIGH' && raw.priority !== 'P1')
    return false;
  if (filterName === 'muted' && !['SNOOZED', 'SUPPRESSED'].includes(status)) return false;
  // Mirrors the server: the default view leaves out alerts held by a maintenance window.
  if (
    (!filterName || filterName === 'all') &&
    !filter.status &&
    status === 'SUPPRESSED' &&
    typeof raw.maintenanceWindowId === 'string'
  )
    return false;
  const namedStatus =
    filterName === 'open'
      ? 'OPEN'
      : filterName === 'acknowledged'
        ? 'ACKNOWLEDGED'
        : filterName === 'resolved'
          ? 'RESOLVED'
          : filterName === 'snoozed'
            ? 'SNOOZED'
            : filterName === 'suppressed'
              ? 'SUPPRESSED'
              : null;
  if (namedStatus && status !== namedStatus) return false;
  // ACTIVE is a dashboard pseudo-status (OPEN + ACKNOWLEDGED), never a stored value.
  if (filter.status === 'ACTIVE') {
    if (!['OPEN', 'ACKNOWLEDGED'].includes(status)) return false;
  } else if (filter.status && status !== filter.status) return false;
  if (filter.serviceId && serviceId !== filter.serviceId) return false;
  if (
    filter.assignee !== undefined &&
    assigneeId !== (filter.assignee.toLowerCase() === 'unassigned' ? null : filter.assignee)
  )
    return false;
  if (filter.urgency && filter.urgency !== 'all' && raw.urgency !== filter.urgency.toUpperCase())
    return false;
  if (filter.priority && filter.priority !== 'all' && raw.priority !== filter.priority)
    return false;
  if (
    filter.teamId &&
    filter.teamId !== 'all' &&
    filter.teamId !== 'mine' &&
    raw.teamId !== filter.teamId
  )
    return false;
  const createdAt = raw.createdAt
    ? new Date(raw.createdAt as string | number | Date).getTime()
    : Number.NaN;
  if (
    filter.createdAfter &&
    (!Number.isFinite(createdAt) || createdAt < new Date(filter.createdAfter).getTime())
  )
    return false;
  if (
    filter.createdBefore &&
    (!Number.isFinite(createdAt) || createdAt > new Date(filter.createdBefore).getTime())
  )
    return false;
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const searchable = `${raw.id ?? ''} ${raw.title ?? ''} ${raw.description ?? ''}`.toLowerCase();
    if (!searchable.includes(needle)) return false;
  }
  return true;
}

export type RealtimeMergeOptions = {
  filter: IncidentRealtimeFilter;
  /** New incidents are only inserted in place on page 1; later pages report them instead. */
  isPageOne: boolean;
  /** Rows kept on screen (the page size). */
  maxItems: number;
  /** Incidents created at or after this instant (ms) count as new arrivals. */
  newSince: number;
};

export type RealtimeMergeResult = {
  list: IncidentListItem[];
  /** New incidents that were inserted into the visible list. */
  insertedIds: string[];
  /**
   * New incidents that match the filter but are not visible: the user is past page 1, or
   * the active sort placed them outside the page window. These drive the "N new" pill.
   */
  offscreenIds: string[];
};

function createdAtMs(value: unknown): number {
  if (!value) return Number.NaN;
  return new Date(value as string | number | Date).getTime();
}

/**
 * Applies one realtime batch to the rows on screen: patches or drops rows that changed,
 * inserts matching new incidents on page 1 in sort order, and reports matching new
 * incidents that could not be shown.
 */
export function mergeRealtimeIncidents(
  displayed: IncidentListItem[],
  incoming: Record<string, unknown>[],
  { filter, isPageOne, maxItems, newSince }: RealtimeMergeOptions
): RealtimeMergeResult {
  const displayedIds = new Set(displayed.map(item => item.id));
  const updates = new Map<string, Record<string, unknown>>();
  const candidates: IncidentListItem[] = [];
  const freshIds = new Set<string>();

  for (const raw of incoming) {
    const id = typeof raw.id === 'string' ? raw.id : null;
    if (!id) continue;
    if (displayedIds.has(id)) {
      updates.set(id, raw);
      continue;
    }
    if (!matchesRealtimeFilter(raw, filter)) continue;
    if (createdAtMs(raw.createdAt) >= newSince) freshIds.add(id);
    if (isPageOne) candidates.push(parseRealtimeIncident(raw));
  }

  let list = displayed
    .map(item => {
      const update = updates.get(item.id);
      if (!update) return item;
      return matchesRealtimeFilter(update, filter) ? parseRealtimeIncident(update) : null;
    })
    .filter((item): item is IncidentListItem => item !== null);

  if (candidates.length > 0) {
    const present = new Set(list.map(item => item.id));
    list = [...list, ...candidates.filter(item => !present.has(item.id))];
  }

  list = sortIncidents(list, filter.sort || 'newest');
  if (list.length > maxItems) list = list.slice(0, maxItems);

  const visible = new Set(list.map(item => item.id));
  const insertedIds: string[] = [];
  const offscreenIds: string[] = [];
  for (const id of freshIds) {
    if (visible.has(id)) insertedIds.push(id);
    else offscreenIds.push(id);
  }

  if (list.length === displayed.length && list.every((item, idx) => item === displayed.at(idx))) {
    return { list: displayed, insertedIds, offscreenIds };
  }
  return { list, insertedIds, offscreenIds };
}

/** Label for the new-incidents pill and its live announcement. */
export function newIncidentsLabel(count: number): string {
  return count === 1 ? '1 new incident' : `${count} new incidents`;
}
