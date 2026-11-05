import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const HOUR_MS = 60 * 60 * 1000;
export const CATCH_UP_DEFAULT_HOURS = 12;
export const CATCH_UP_MAX_HOURS = 168;
export const CATCH_UP_DEFAULT_LIMIT = 10;
export const CATCH_UP_MAX_LIMIT = 25;

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
 * "What did I miss": what opened and resolved since a point in time, what is still active (most
 * urgent first) and what is assigned to the caller, over the incidents they are allowed to read.
 * Bounded by `hours` of history and `limit` rows per list.
 */
export async function getCatchUp(input: {
  userId: string;
  readWhere: Prisma.IncidentWhereInput;
  hours: number;
  limit: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - input.hours * HOUR_MS);
  const active: Prisma.IncidentWhereInput = { status: { in: ['OPEN', 'ACKNOWLEDGED'] } };
  const scope = (where: Prisma.IncidentWhereInput): Prisma.IncidentWhereInput => ({
    AND: [input.readWhere, where],
  });
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
  const [openedCount, resolvedCount, activeCount, activeRows, mineRows, resolvedRows] =
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
    ]);
  const rows = (list: Row[]) => list.map(row => shape(row, input.userId, since));
  return {
    userId: input.userId,
    since: since.toISOString(),
    now: now.toISOString(),
    counts: { opened: openedCount, resolved: resolvedCount, active: activeCount },
    active: rows(activeRows),
    assignedToMe: rows(mineRows),
    recentlyResolved: rows(resolvedRows),
    truncated: {
      active: activeCount > activeRows.length,
      recentlyResolved: resolvedCount > resolvedRows.length,
    },
  };
}
