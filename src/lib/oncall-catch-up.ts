import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export const CATCH_UP_DEFAULT_HOURS = 12;
export const CATCH_UP_MAX_HOURS = 168;
export const CATCH_UP_DEFAULT_LIMIT = 10;
export const CATCH_UP_MAX_LIMIT = 25;
/** Teams considered when resolving "mine"; a person in more teams than this is cut off at this many. */
const MY_TEAM_LIMIT = 200;
/** Notification rows read to work out which incidents paged the caller. */
const PAGED_ROW_LIMIT = 500;

export type CatchUpScope = 'mine' | 'all';
export type CatchUpUrgency = 'HIGH' | 'MEDIUM' | 'LOW';

const incidentSelect = {
  id: true,
  title: true,
  status: true,
  urgency: true,
  priority: true,
  serviceId: true,
  assigneeId: true,
  createdAt: true,
  acknowledgedAt: true,
  resolvedAt: true,
  service: { select: { name: true } },
} satisfies Prisma.IncidentSelect;

type Row = Prisma.IncidentGetPayload<{ select: typeof incidentSelect }>;

function shape(row: Row, userId: string, since: Date) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    urgency: row.urgency,
    priority: row.priority,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    assignedToMe: row.assigneeId === userId,
    openedSinceThen: row.createdAt >= since,
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/**
 * "What did I miss". Over the incidents the caller may read, narrowed by `scope`:
 * - `mine` (default): assigned to them, watched by them, or owned by a team they belong to;
 * - `all`: everything they may read (for an administrator, the whole organisation).
 *
 * Returns what opened and resolved since `since`, what is still active (most urgent first), what is
 * assigned to the caller, and which incidents actually paged them (from their own notification
 * history, never anyone else's). Strictly read-only: there is no stored "last seen" marker, so the
 * start is always explicit (`since`, or `hours` back from now).
 */
export async function getCatchUp(input: {
  userId: string;
  readWhere: Prisma.IncidentWhereInput;
  since: Date;
  limit: number;
  scope?: CatchUpScope;
  serviceId?: string;
  teamId?: string;
  urgency?: CatchUpUrgency;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const since = input.since;
  const scopeName = input.scope ?? 'mine';

  const teamIds =
    scopeName === 'mine'
      ? (
          await prisma.teamMember.findMany({
            where: { userId: input.userId },
            select: { teamId: true },
            take: MY_TEAM_LIMIT,
          })
        ).map(member => member.teamId)
      : [];
  const mine: Prisma.IncidentWhereInput = {
    OR: [
      { assigneeId: input.userId },
      { watchers: { some: { userId: input.userId } } },
      ...(teamIds.length
        ? [{ teamId: { in: teamIds } }, { service: { teamId: { in: teamIds } } }]
        : []),
    ],
  };
  const filters: Prisma.IncidentWhereInput[] = [
    input.readWhere,
    ...(scopeName === 'mine' ? [mine] : []),
    ...(input.serviceId ? [{ serviceId: input.serviceId }] : []),
    ...(input.teamId
      ? [{ OR: [{ teamId: input.teamId }, { service: { teamId: input.teamId } }] }]
      : []),
    ...(input.urgency ? [{ urgency: input.urgency }] : []),
  ];
  const scope = (where: Prisma.IncidentWhereInput): Prisma.IncidentWhereInput => ({
    AND: [...filters, where],
  });
  const active: Prisma.IncidentWhereInput = { status: { in: ['OPEN', 'ACKNOWLEDGED'] } };

  // Postgres orders an enum by its creation history, not by severity, so rank urgency explicitly:
  // the top `limit` of each level, most urgent level first.
  const topByUrgency = async (where: Prisma.IncidentWhereInput) => {
    const levels = await Promise.all(
      (['HIGH', 'MEDIUM', 'LOW'] as const).map(urgency =>
        prisma.incident.findMany({
          where: scope({ AND: [where, { urgency }] }),
          select: incidentSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit,
        })
      )
    );
    return levels.flat().slice(0, input.limit);
  };

  const [openedCount, resolvedCount, activeCount, activeRows, mineRows, resolvedRows, pages] =
    await Promise.all([
      prisma.incident.count({ where: scope({ createdAt: { gte: since } }) }),
      prisma.incident.count({ where: scope({ resolvedAt: { gte: since } }) }),
      prisma.incident.count({ where: scope(active) }),
      topByUrgency(active),
      topByUrgency({ ...active, assigneeId: input.userId }),
      prisma.incident.findMany({
        where: scope({ resolvedAt: { gte: since } }),
        select: incidentSelect,
        orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
      }),
      // Only the caller's own notifications, and only for incidents they may read.
      prisma.notification.findMany({
        where: {
          userId: input.userId,
          createdAt: { gte: since },
          incident: { is: scope({}) },
        },
        select: {
          incidentId: true,
          channel: true,
          status: true,
          eventType: true,
          createdAt: true,
          incident: { select: { id: true, title: true, urgency: true, status: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGED_ROW_LIMIT,
      }),
    ]);

  const paged = new Map<
    string,
    {
      incident: { id: string; title: string; urgency: string; status: string };
      lastEventType: string;
      lastAt: Date;
      channels: Set<string>;
      delivered: boolean;
    }
  >();
  for (const page of pages) {
    if (!page.incident) continue;
    const existing = paged.get(page.incident.id);
    const delivered = page.status === 'SENT' || page.status === 'DELIVERED';
    if (existing) {
      existing.channels.add(page.channel);
      existing.delivered ||= delivered;
    } else {
      paged.set(page.incident.id, {
        incident: page.incident,
        lastEventType: page.eventType,
        lastAt: page.createdAt,
        channels: new Set([page.channel]),
        delivered,
      });
    }
  }
  const rows = (list: Row[]) => list.map(row => shape(row, input.userId, since));
  return {
    userId: input.userId,
    since: since.toISOString(),
    now: now.toISOString(),
    scope: scopeName,
    filters: {
      serviceId: input.serviceId ?? null,
      teamId: input.teamId ?? null,
      urgency: input.urgency ?? null,
    },
    // Lets the assistant explain an empty "mine" result and suggest scope=all.
    myTeamCount: teamIds.length,
    counts: { opened: openedCount, resolved: resolvedCount, active: activeCount },
    active: rows(activeRows),
    assignedToMe: rows(mineRows),
    recentlyResolved: rows(resolvedRows),
    pagedMe: {
      count: paged.size,
      items: [...paged.values()].slice(0, input.limit).map(entry => ({
        incident: entry.incident,
        lastEventType: entry.lastEventType,
        lastAt: entry.lastAt.toISOString(),
        channels: [...entry.channels].sort(),
        delivered: entry.delivered,
      })),
    },
    truncated: {
      active: activeCount > activeRows.length,
      recentlyResolved: resolvedCount > resolvedRows.length,
      pagedMe: pages.length >= PAGED_ROW_LIMIT || paged.size > input.limit,
    },
  };
}
