import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import {
  buildCursorWhere,
  decodeCursor,
  encodeCursor,
  formatCursorPagination,
  MAX_PAGE_LIMIT,
} from '@/lib/api-v2/pagination';
import type {
  BsStatus,
  BusinessServiceDerivedSort,
  BusinessServiceHealth,
  BusinessServiceListPage,
  BusinessServiceListParams,
  BusinessServiceStats,
  ImpactTimelineEntry,
  TimeWindow,
} from './contract';
import { getHealthSnapshot } from './health';
import { businessServiceReadWhere } from './commands';
import { needsWhere } from './scorecard';
import {
  computeErrorBudget,
  URGENCY_DOWNTIME_WEIGHT,
  weightedDowntime,
  type ErrorBudget,
} from './slo';
import { attributeFilterValues, type AttributeFilter } from './attributes';

const MINUTE = 60_000;
const MAX_TIMELINE = 500;

/** Total length of the union of intervals clipped to the window, so overlaps count once. */
export function unionDurationMs(
  intervals: ReadonlyArray<{ start: number; end: number }>,
  window: { from: number; to: number }
): number {
  const clipped = intervals
    .map(({ start, end }) => ({
      start: Math.max(start, window.from),
      end: Math.min(end, window.to),
    }))
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

const inWindow = (businessServiceId: string, window: TimeWindow) =>
  ({
    businessServiceId,
    startedAt: { lt: window.to },
    OR: [{ endedAt: null }, { endedAt: { gt: window.from } }],
  }) satisfies Prisma.IncidentBusinessServiceImpactWhereInput;

/**
 * Incidents (of `ids`) whose metadata the actor may see: none without incident read access,
 * otherwise those inside their incident read scope. Impact intervals themselves are business
 * service data; only incident identity, titles and urgency need incident access.
 */
export async function readableIncidentIds(
  actor: AuthorizationActor,
  ids: readonly string[]
): Promise<Set<string>> {
  if (!ids.length || !authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ }).allowed)
    return new Set();
  const rows = await prisma.incident.findMany({
    where: { AND: [{ id: { in: [...new Set(ids)] } }, incidentReadWhere(actor)] },
    select: { id: true },
  });
  return new Set(rows.map(row => row.id));
}

/** Technical services among `ids` the actor may see (null when they see all of them). */
export async function readableServiceIds(
  actor: AuthorizationActor,
  ids: readonly string[]
): Promise<Set<string> | undefined> {
  const where = serviceReadWhere(actor);
  if (Object.keys(where).length === 0) return undefined;
  if (!ids.length) return new Set();
  const rows = await prisma.service.findMany({
    where: { AND: [{ id: { in: [...new Set(ids)] } }, where] },
    select: { id: true },
  });
  return new Set(rows.map(row => row.id));
}

/**
 * The newest impact intervals in the window (at most 500, for display). Incident id, title and
 * urgency are null on intervals of incidents the actor cannot read.
 */
export async function getImpactTimeline(
  businessServiceId: string,
  window: TimeWindow,
  actor: AuthorizationActor
): Promise<ImpactTimelineEntry[]> {
  validWindow(window);
  await assertVisible(businessServiceId, actor);
  const rows = await prisma.incidentBusinessServiceImpact.findMany({
    where: inWindow(businessServiceId, window),
    orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    take: MAX_TIMELINE,
    select: {
      incidentId: true,
      source: true,
      excluded: true,
      startedAt: true,
      endedAt: true,
      incident: { select: { title: true, urgency: true } },
    },
  });
  const readable = await readableIncidentIds(
    actor,
    rows.map(row => row.incidentId)
  );
  return rows.map(row => {
    const visible = readable.has(row.incidentId);
    return {
      incidentId: visible ? row.incidentId : null,
      incidentTitle: visible ? row.incident.title : null,
      urgency: visible ? row.incident.urgency : null,
      source: row.source,
      excluded: row.excluded,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    };
  });
}

const STATS_BATCH = 5000;

/**
 * Numbers over every non-excluded interval in the window (not the bounded display timeline):
 * intervals are read in keyset batches and unioned; incident counts, MTTA and MTTR are one SQL
 * aggregate over the distinct incidents. Counts only, so no incident access is needed.
 */
export async function getBusinessServiceStats(
  businessServiceId: string,
  window: TimeWindow,
  actor: AuthorizationActor
): Promise<BusinessServiceStats> {
  validWindow(window);
  await assertVisible(businessServiceId, actor);
  const now = new Date();
  const intervals: Array<{ start: number; end: number }> = [];
  const weighted: Array<{ start: number; end: number; weight: number }> = [];
  let after: string | undefined;
  for (;;) {
    const batch = await prisma.incidentBusinessServiceImpact.findMany({
      where: {
        AND: [
          inWindow(businessServiceId, window),
          { excluded: false },
          after ? { id: { gt: after } } : {},
        ],
      },
      orderBy: { id: 'asc' },
      take: STATS_BATCH,
      select: { id: true, startedAt: true, endedAt: true, incident: { select: { urgency: true } } },
    });
    for (const row of batch) {
      const interval = { start: row.startedAt.getTime(), end: (row.endedAt ?? now).getTime() };
      intervals.push(interval);
      // shortcut: weight is the incident's urgency, not the status this business service had
      // during the interval (intervals do not store one); upgrade if intervals gain a severity.
      weighted.push({ ...interval, weight: URGENCY_DOWNTIME_WEIGHT[row.incident.urgency] });
    }
    if (batch.length < STATS_BATCH) break;
    after = batch.at(-1)!.id;
  }
  const bounds = {
    from: window.from.getTime(),
    to: Math.min(window.to.getTime(), now.getTime()),
  };
  const impactMs = unionDurationMs(intervals, bounds);
  const total = Math.max(bounds.to - bounds.from, 0);
  const planned = await prisma.maintenanceWindow.findMany({
    where: {
      businessServices: { some: { businessServiceId } },
      startsAt: { lt: window.to },
      endsAt: { gt: window.from },
    },
    take: 1000,
    select: { startsAt: true, endsAt: true },
  });
  const slo = weightedDowntime(
    weighted,
    planned.map(w => ({ start: w.startsAt.getTime(), end: w.endsAt.getTime() })),
    bounds
  );
  const [aggregate] = await prisma.$queryRaw<
    Array<{ incidents: number; mtta: number | null; mttr: number | null }>
  >`
    SELECT COUNT(*)::int AS "incidents",
      (AVG(EXTRACT(EPOCH FROM (i."acknowledgedAt" - i."createdAt")))
        FILTER (WHERE i."acknowledgedAt" IS NOT NULL))::float8 AS "mtta",
      (AVG(EXTRACT(EPOCH FROM (i."resolvedAt" - i."createdAt")))
        FILTER (WHERE i."resolvedAt" IS NOT NULL))::float8 AS "mttr"
    FROM "Incident" i
    WHERE i."id" IN (
      SELECT DISTINCT r."incidentId" FROM "IncidentBusinessServiceImpact" r
      WHERE r."businessServiceId" = ${businessServiceId}
        AND NOT r."excluded"
        AND r."startedAt" < ${window.to}
        AND (r."endedAt" IS NULL OR r."endedAt" > ${window.from})
    )`;
  const minutes = (seconds: number | null | undefined) =>
    seconds === null || seconds === undefined ? null : seconds / 60;
  return {
    window,
    impactMinutes: impactMs / MINUTE,
    uptimePercent: total > 0 ? Math.max(0, (1 - impactMs / total) * 100) : 100,
    weightedUptimePercent:
      slo.windowMs > 0 ? Math.max(0, (1 - slo.downtimeMs / slo.windowMs) * 100) : 100,
    weightedDowntimeMinutes: slo.downtimeMs / MINUTE,
    weightedWindowMinutes: slo.windowMs / MINUTE,
    incidentCount: aggregate?.incidents ?? 0,
    mttaMinutes: minutes(aggregate?.mtta),
    mttrMinutes: minutes(aggregate?.mttr),
  };
}

/** Prisma filter for one custom attribute: the text value or its typed (number/boolean) reading. */
export function attributeWhere(filter: AttributeFilter): Prisma.BusinessServiceWhereInput {
  return {
    OR: attributeFilterValues(filter.value).map(value => ({
      customAttributes: { path: [filter.key], equals: value },
    })),
  };
}

const STATUS_RANK: Readonly<Record<BsStatus, number>> = {
  OPERATIONAL: 0,
  UNKNOWN: 1,
  MAINTENANCE: 2,
  DEGRADED: 3,
  PARTIAL_OUTAGE: 4,
  MAJOR_OUTAGE: 5,
};
const TIER_RANK = { TIER_0: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 } as const;
const DERIVED: ReadonlySet<string> = new Set(['health', 'tier', 'owner', 'incidents', 'budget']);

type SortRow = {
  id: string;
  name: string;
  criticality: keyof typeof TIER_RANK | null;
  ownerTeam: { id: string; name: string } | null;
};
type Key = Array<string | number>;

/**
 * Sort key (compare left to right, every part ascending) for a derived sort. Missing values (no tier,
 * no owner, no SLO) sort last in both directions; name and id break ties so the order is total.
 */
export function derivedSortKey(
  row: SortRow,
  sort: BusinessServiceDerivedSort | 'name',
  direction: 'asc' | 'desc',
  facts: { status: BsStatus; openIncidents: number; budgetLeft: number | null }
): Key {
  const flip = (n: number) => (direction === 'desc' ? -n : n);
  // Strings cannot be negated: desc flips every code unit, and the high terminator puts a longer
  // name before its own prefix ("abc" before "ab").
  const flipText = (text: string) =>
    direction === 'desc'
      ? `${text
          .split('')
          .map(ch => String.fromCharCode(0xffff - ch.charCodeAt(0)))
          .join('')}\uffff`
      : text;
  const tier = row.criticality ? TIER_RANK[row.criticality] : 9;
  const tail: Key = [row.name.toLowerCase(), row.id];
  switch (sort) {
    case 'health':
      return [flip(STATUS_RANK[facts.status]), tier, ...tail];
    case 'tier':
      return [row.criticality ? 0 : 1, flip(tier), -STATUS_RANK[facts.status], ...tail];
    case 'incidents':
      return [flip(facts.openIncidents), -STATUS_RANK[facts.status], ...tail];
    case 'budget':
      return [facts.budgetLeft === null ? 1 : 0, flip(facts.budgetLeft ?? 0), ...tail];
    case 'name':
      return [flipText(row.name.toLowerCase()), row.id];
    case 'owner': {
      const owner = row.ownerTeam?.name.toLowerCase() ?? '';
      return [owner ? 0 : 1, flipText(owner), ...tail];
    }
  }
}

export function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a.at(i);
    const y = b.at(i);
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Error budget left (percent, may go negative) over each service's own SLO window, for every id
 * with an SLO target. One impact read and one maintenance read for the whole set.
 * shortcut: impacts are capped at 50,000 rows across the set; batch by service if a catalog outgrows it.
 */
export async function getErrorBudgets(
  ids: readonly string[],
  now = new Date()
): Promise<Map<string, ErrorBudget>> {
  const services = ids.length
    ? await prisma.businessService.findMany({
        where: { id: { in: [...ids] }, sloTarget: { not: null } },
        select: { id: true, sloTarget: true, sloWindowDays: true },
      })
    : [];
  if (!services.length) return new Map();
  const maxDays = Math.max(...services.map(row => row.sloWindowDays));
  const from = new Date(now.getTime() - maxDays * 86_400_000);
  const sloIds = services.map(row => row.id);
  const [impacts, maintenance] = await Promise.all([
    prisma.incidentBusinessServiceImpact.findMany({
      where: {
        businessServiceId: { in: sloIds },
        excluded: false,
        startedAt: { lt: now },
        OR: [{ endedAt: null }, { endedAt: { gt: from } }],
      },
      take: 50_000,
      select: {
        businessServiceId: true,
        startedAt: true,
        endedAt: true,
        incident: { select: { urgency: true } },
      },
    }),
    prisma.maintenanceWindowBusinessService.findMany({
      where: {
        businessServiceId: { in: sloIds },
        maintenanceWindow: { startsAt: { lt: now }, endsAt: { gt: from } },
      },
      take: 10_000,
      select: {
        businessServiceId: true,
        maintenanceWindow: { select: { startsAt: true, endsAt: true } },
      },
    }),
  ]);
  const budgets = new Map<string, ErrorBudget>();
  for (const service of services) {
    const bounds = { from: now.getTime() - service.sloWindowDays * 86_400_000, to: now.getTime() };
    const slo = weightedDowntime(
      impacts
        .filter(row => row.businessServiceId === service.id)
        .map(row => ({
          start: row.startedAt.getTime(),
          end: (row.endedAt ?? now).getTime(),
          weight: URGENCY_DOWNTIME_WEIGHT[row.incident.urgency],
        })),
      maintenance
        .filter(row => row.businessServiceId === service.id)
        .map(({ maintenanceWindow: w }) => ({
          start: w.startsAt.getTime(),
          end: w.endsAt.getTime(),
        })),
      bounds
    );
    budgets.set(
      service.id,
      computeErrorBudget({
        targetPercent: service.sloTarget!,
        windowDays: service.sloWindowDays,
        downtimeMinutes: slo.downtimeMs / MINUTE,
        windowMinutes: slo.windowMs / MINUTE,
      })
    );
  }
  return budgets;
}

const LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  criticality: true,
  createdAt: true,
  ownerTeam: { select: { id: true, name: true } },
  _count: { select: { members: true } },
} satisfies Prisma.BusinessServiceSelect;

/**
 * One page of the business services the actor can see, by name, newest, or a derived sort. Status
 * filters run against the cached health snapshot, so a name/newest page costs the snapshot (usually
 * cached) plus at most two queries. A derived sort reads the whole matching set (lean columns) and
 * sorts it in memory, like the catalog counts already do.
 */
export async function listBusinessServices(
  params: BusinessServiceListParams,
  actor: AuthorizationActor
): Promise<BusinessServiceListPage> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20), 1), MAX_PAGE_LIMIT);
  const filter = params.filter ?? {};
  const sort = params.sort ?? 'name';
  // Name descending has no keyset order, so it takes the in-memory path too.
  const derived =
    DERIVED.has(sort) || (sort === 'name' && params.direction === 'desc')
      ? (sort as BusinessServiceDerivedSort | 'name')
      : null;
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
  else if (params.cursor && !derived) {
    const { id } = decodeCursor(params.cursor);
    const row = await prisma.businessService.findUnique({ where: { id }, select: { name: true } });
    if (!row) throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
    cursorWhere = { OR: [{ name: { gt: row.name } }, { name: row.name, id: { gt: id } }] };
  }
  const query = filter.query?.trim();
  const where: Prisma.BusinessServiceWhereInput = {
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
      filter.needs ? needsWhere(filter.needs) : {},
      filter.attribute ? attributeWhere(filter.attribute) : {},
      matching ? { id: { in: matching } } : {},
    ],
  };
  let page: {
    data: Prisma.BusinessServiceGetPayload<{ select: typeof LIST_SELECT }>[];
    nextCursor: string | null;
  };
  if (derived) {
    const direction = params.direction ?? (derived === 'health' ? 'desc' : 'asc');
    const all = await prisma.businessService.findMany({ where, select: LIST_SELECT });
    const budgets = derived === 'budget' ? await getErrorBudgets(all.map(row => row.id)) : null;
    const keyed = all
      .map(row => {
        const health = snapshot.health.get(row.id);
        return {
          row,
          key: derivedSortKey(row, derived, direction, {
            status: health?.status ?? 'OPERATIONAL',
            openIncidents: health?.openIncidentCount ?? 0,
            budgetLeft: budgets?.get(row.id)?.remainingPercent ?? null,
          }),
        };
      })
      .sort((a, b) => compareKeys(a.key, b.key));
    let start = 0;
    if (params.cursor) {
      // shortcut: the cursor names the last row and the next page starts after its current place,
      // so a row whose health changed between pages can move; store the key in the cursor if that bites.
      const { id } = decodeCursor(params.cursor);
      const at = keyed.findIndex(entry => entry.row.id === id);
      if (at < 0) throw new AppError({ code: 'INVALID_PAGINATION_CURSOR' });
      start = at + 1;
    }
    const slice = keyed.slice(start, start + limit).map(entry => entry.row);
    const last = slice.at(-1);
    page = {
      data: slice,
      nextCursor:
        last && start + limit < keyed.length
          ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() })
          : null,
    };
  } else {
    const rows = await prisma.businessService.findMany({
      where,
      orderBy:
        sort === 'newest'
          ? [{ createdAt: 'desc' }, { id: 'desc' }]
          : [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: LIST_SELECT,
    });
    const formatted = formatCursorPagination(rows, limit);
    page = { data: formatted.data, nextCursor: formatted.pagination.nextCursor };
  }
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
    nextCursor: page.nextCursor,
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
