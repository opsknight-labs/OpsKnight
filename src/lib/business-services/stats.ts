import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  buildCursorWhere,
  decodeCursor,
  formatCursorPagination,
  MAX_PAGE_LIMIT,
} from '@/lib/api-v2/pagination';
import type {
  BusinessServiceHealth,
  BusinessServiceListPage,
  BusinessServiceListParams,
  BusinessServiceStats,
  ImpactTimelineEntry,
  TimeWindow,
} from './contract';
import { getHealthSnapshot } from './health';
import { businessServiceReadWhere } from './commands';

const MINUTE = 60_000;
const MAX_TIMELINE = 500;

/** Total length of the union of intervals clipped to the window, so overlaps count once. */
export function unionDurationMs(
  intervals: ReadonlyArray<{ start: number; end: number }>,
  window: { from: number; to: number }
): number {
  const clipped = intervals
    .map(({ start, end }) => ({ start: Math.max(start, window.from), end: Math.min(end, window.to) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of clipped) {
    if (current && interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
      continue;
    }
    if (current) total += current.end - current.start;
    current = { ...interval };
  }
  return current ? total + current.end - current.start : total;
}

async function assertVisible(businessServiceId: string, actor: AuthorizationActor) {
  const visible = await prisma.businessService.findFirst({
    where: { AND: [{ id: businessServiceId }, businessServiceReadWhere(actor)] },
    select: { id: true },
  });
  if (!visible) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
}

function validWindow(window: TimeWindow) {
  if (!(window.from < window.to)) {
    throw new AppError({ code: 'VALIDATION_FAILED', userMessage: '"from" must be before "to".' });
  }
}

function impactRowsInWindow(businessServiceId: string, window: TimeWindow) {
  return prisma.incidentBusinessServiceImpact.findMany({
    where: {
      businessServiceId,
      startedAt: { lt: window.to },
      OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
    },
    orderBy: [{ startedAt: 'desc' }, { incidentId: 'asc' }],
    take: MAX_TIMELINE,
    select: {
      incidentId: true,
      source: true,
      excluded: true,
      startedAt: true,
      endedAt: true,
      incident: {
        select: {
          title: true,
          urgency: true,
          createdAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
        },
      },
    },
  });
}

export async function getImpactTimeline(
  businessServiceId: string,
  window: TimeWindow,
  actor: AuthorizationActor
): Promise<ImpactTimelineEntry[]> {
  validWindow(window);
  await assertVisible(businessServiceId, actor);
  const rows = await impactRowsInWindow(businessServiceId, window);
  return rows.map(row => ({
    incidentId: row.incidentId,
    incidentTitle: row.incident.title,
    urgency: row.incident.urgency,
    source: row.source,
    excluded: row.excluded,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  }));
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export async function getBusinessServiceStats(
  businessServiceId: string,
  window: TimeWindow,
  actor: AuthorizationActor
): Promise<BusinessServiceStats> {
  validWindow(window);
  await assertVisible(businessServiceId, actor);
  const rows = (await impactRowsInWindow(businessServiceId, window)).filter(row => !row.excluded);
  const now = Date.now();
  const bounds = { from: window.from.getTime(), to: Math.min(window.to.getTime(), now) };
  const impactMs = unionDurationMs(
    rows.map(row => ({ start: row.startedAt.getTime(), end: (row.endedAt ?? new Date(now)).getTime() })),
    bounds
  );
  const total = Math.max(bounds.to - bounds.from, 0);
  const incidents = [...new Map(rows.map(row => [row.incidentId, row.incident])).values()];
  const minutes = (from: Date, to: Date | null) => (to ? (to.getTime() - from.getTime()) / MINUTE : null);
  return {
    window,
    impactMinutes: impactMs / MINUTE,
    uptimePercent: total > 0 ? Math.max(0, (1 - impactMs / total) * 100) : 100,
    incidentCount: incidents.length,
    mttaMinutes: average(
      incidents.flatMap(incident => minutes(incident.createdAt, incident.acknowledgedAt) ?? [])
    ),
    mttrMinutes: average(
      incidents.flatMap(incident => minutes(incident.createdAt, incident.resolvedAt) ?? [])
    ),
  };
}

/**
 * One page of the business services the actor can see, newest or by name. Status filters run
 * against the cached health snapshot, so a page costs the snapshot (usually cached) plus at most
 * two queries: the cursor row for name order and the page itself.
 */
export async function listBusinessServices(
  params: BusinessServiceListParams,
  actor: AuthorizationActor
): Promise<BusinessServiceListPage> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20), 1), MAX_PAGE_LIMIT);
  const filter = params.filter ?? {};
  const sort = params.sort ?? 'name';
  const snapshot = await getHealthSnapshot();
  const healthFilter = filter.status?.length || filter.impactedOnly;
  const statuses = new Set(filter.status ?? []);
  const matching = healthFilter
    ? [...snapshot.health.values()]
        .filter(item => !statuses.size || statuses.has(item.status))
        .filter(item => !filter.impactedOnly || item.reasons.some(r => r.kind !== 'MAINTENANCE'))
        .map(item => item.businessServiceId)
    : null;
  let cursorWhere: Prisma.BusinessServiceWhereInput = {};
  if (params.cursor && sort === 'newest') cursorWhere = buildCursorWhere(params.cursor);
  else if (params.cursor) {
    const { id } = decodeCursor(params.cursor);
    const row = await prisma.businessService.findUnique({ where: { id }, select: { name: true } });
    if (!row) throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
    cursorWhere = { OR: [{ name: { gt: row.name } }, { name: row.name, id: { gt: id } }] };
  }
  const query = filter.query?.trim();
  const rows = await prisma.businessService.findMany({
    where: {
      AND: [
        businessServiceReadWhere(actor),
        cursorWhere,
        query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {},
        filter.criticality?.length ? { criticality: { in: [...filter.criticality] } } : {},
        filter.ownerTeamId ? { ownerTeamId: filter.ownerTeamId } : {},
        matching ? { id: { in: matching } } : {},
      ],
    },
    orderBy: sort === 'newest' ? [{ createdAt: 'desc' }, { id: 'desc' }] : [{ name: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      description: true,
      criticality: true,
      createdAt: true,
      ownerTeam: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
  });
  const page = formatCursorPagination(rows, limit);
  const fresh = page.data.some(row => !snapshot.health.has(row.id))
    ? await getHealthSnapshot({ requireIds: page.data.map(row => row.id) })
    : snapshot;
  return {
    items: page.data.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      criticality: row.criticality,
      ownerTeam: row.ownerTeam,
      memberCount: row._count.members,
      health: fresh.health.get(row.id) ?? operational(row.id, row._count.members),
    })),
    nextCursor: page.pagination.nextCursor,
  };
}

function operational(businessServiceId: string, memberCount: number): BusinessServiceHealth {
  return {
    businessServiceId,
    status: 'OPERATIONAL',
    since: null,
    reasons: [],
    openIncidentCount: 0,
    memberCount,
    impactedMemberCount: 0,
    computedAt: new Date(),
  };
}

const MAX_SUPPORT_WALK = 10_000;

/**
 * Whether `childId` supporting `parentId` would close a cycle: true when the parent is already
 * reachable from the child through its own supporters. Bounded; an oversized walk counts as a
 * cycle rather than risking one.
 */
export async function wouldCreateSupportCycle(
  parentId: string,
  childId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  if (parentId === childId) return true;
  const seen = new Set([childId]);
  let frontier = [childId];
  while (frontier.length) {
    const edges = await client.businessServiceSupport.findMany({
      where: { parentId: { in: frontier } },
      select: { childId: true },
    });
    const next: string[] = [];
    for (const { childId: id } of edges) {
      if (id === parentId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    if (seen.size > MAX_SUPPORT_WALK) return true;
    frontier = next;
  }
  return false;
}
