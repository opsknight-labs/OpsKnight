import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { incidentRef } from '../incident-ux/explain';
import { incidentReadableSql } from '../incident-ux/readable-sql';
import { getWorkBacklog } from '../jobs/work-queue';

/**
 * Small, bounded reads behind two glanceable surfaces: the "AIOps pulse" tile on the home dashboard and
 * the "largest open group" tile on the wallboard. Both are gated on INTELLIGENCE_READ, scoped to what the
 * actor may read, and fail soft: a broken probe contributes nothing and never breaks the dashboard.
 */

export const PULSE_LIMITS = {
  windowHours: 24,
  /** Triage findings older than this are not "awaiting review" any more; they are stale. */
  triageWindowDays: 7,
  /** Counts stop here; the tile then shows "999+". */
  maxCount: 1000,
  maxScopedServices: 2000,
} as const;

const OPEN = ['OPEN', 'ACKNOWLEDGED'] as const;
const AVOIDING = ['SUPPRESS', 'DROP', 'APPEND', 'GROUP_CHILD'] as const;
/** Triage chips a person can act on (the time-to-resolve estimate is information only). */
const REVIEWABLE_TRIAGE = ['TRIAGE_URGENCY', 'TRIAGE_ASSIGNMENT', 'TRIAGE_DUPLICATE'] as const;

export interface AiopsPulse {
  windowHours: number;
  pagesAvoided: number;
  openGroups: number;
  triageAwaitingReview: number;
  /** Poisoned intelligence work items; null for anyone who cannot manage intelligence. */
  quarantinedWork: number | null;
}

const failed = (label: string) => (error: unknown) => {
  logger.warn(`[Intelligence] Dashboard probe failed: ${label}`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return 0;
};

/**
 * Numbers for the home dashboard's AIOps tile, or null when the viewer may not read intelligence or
 * every number is zero (the tile is then not rendered at all).
 */
export async function getAiopsPulse(
  actor: AuthorizationActor,
  options: { now?: Date } = {},
  client: typeof prisma = prisma
): Promise<AiopsPulse | null> {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ))
    return null;
  let services: Prisma.ServiceWhereInput;
  let incidents: Prisma.IncidentWhereInput;
  let readable: Prisma.Sql;
  try {
    services = serviceReadWhere(actor);
    incidents = incidentReadWhere(actor);
    readable = incidentReadableSql('i', actor);
  } catch {
    return null;
  }
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - PULSE_LIMITS.windowHours * 3_600_000);
  const triageSince = new Date(now.getTime() - PULSE_LIMITS.triageWindowDays * 86_400_000);
  const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);

  const pagesAvoided = async () => {
    // Decisions carry no incident for a suppressed alert, so they are scoped by service.
    let serviceFilter: { serviceId?: { in: string[] } } = {};
    if (Object.keys(services).length > 0) {
      const rows = await client.service.findMany({
        where: services,
        orderBy: { id: 'asc' },
        take: PULSE_LIMITS.maxScopedServices,
        select: { id: true },
      });
      if (!rows.length) return 0;
      serviceFilter = { serviceId: { in: rows.map(row => row.id) } };
    }
    return client.prePagingDecision.count({
      where: {
        ...serviceFilter,
        createdAt: { gte: since, lte: now },
        mode: 'ON',
        applied: true,
        reversedAt: null,
        action: { in: [...AVOIDING] },
      },
    });
  };

  const [avoided, openGroups, triage, quarantined] = await Promise.all([
    pagesAvoided().catch(failed('pages avoided')),
    client.incident
      .count({
        where: {
          AND: [
            incidents,
            {
              status: { in: [...OPEN] },
              relationshipsAsTarget: { some: { type: 'PARENT_CHILD', decision: 'ACCEPTED' } },
            },
          ],
        },
      })
      .catch(failed('open groups')),
    client
      .$queryRaw<Array<{ total: number }>>(
        Prisma.sql`
        SELECT count(*)::int AS total FROM (
          SELECT 1
          FROM "IntelligenceFinding" f
          JOIN "Incident" i ON i."id" = f."incidentId"
          WHERE f."createdAt" >= ${triageSince}
            AND f."status"::text = 'ACTIVE'
            AND f."kind"::text IN (${Prisma.join([...REVIEWABLE_TRIAGE])})
            AND i."status"::text IN (${Prisma.join([...OPEN])})
            AND ${readable}
            AND NOT EXISTS (
              SELECT 1 FROM "IntelligenceFeedback" fb
              WHERE fb."subjectType"::text = 'FINDING' AND fb."subjectId" = f."id"
            )
          LIMIT ${PULSE_LIMITS.maxCount}
        ) pending`
      )
      .then(rows => rows[0]?.total ?? 0)
      .catch(failed('triage awaiting review')),
    canManage
      ? getWorkBacklog(undefined, client, { maxAgeMs: 10_000 })
          .then(backlog => backlog.quarantined)
          .catch(failed('quarantined work'))
      : Promise.resolve(null),
  ]);

  const pulse: AiopsPulse = {
    windowHours: PULSE_LIMITS.windowHours,
    pagesAvoided: avoided,
    openGroups,
    triageAwaitingReview: triage,
    quarantinedWork: quarantined,
  };
  const silent =
    pulse.pagesAvoided === 0 &&
    pulse.openGroups === 0 &&
    pulse.triageAwaitingReview === 0 &&
    !pulse.quarantinedWork;
  return silent ? null : pulse;
}

export interface WallboardLargestGroup {
  parentId: string;
  parentRef: string;
  parentTitle: string;
  serviceName: string | null;
  /** Incidents grouped under the parent by an accepted link (the parent itself is not counted). */
  childCount: number;
}

/**
 * The open parent incident with the most grouped children, for the wallboard. Null when the viewer may
 * not read intelligence or no open group exists, so the wallboard shows no empty tile.
 */
export async function getWallboardLargestGroup(
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<WallboardLargestGroup | null> {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ))
    return null;
  try {
    const readable = incidentReadWhere(actor);
    const [top] = await client.incidentRelationship.groupBy({
      by: ['targetIncidentId'],
      where: {
        type: 'PARENT_CHILD',
        decision: 'ACCEPTED',
        target: { AND: [readable, { status: { in: [...OPEN] } }] },
      },
      _count: { sourceIncidentId: true },
      orderBy: [{ _count: { sourceIncidentId: 'desc' } }, { targetIncidentId: 'asc' }],
      take: 1,
    });
    if (!top) return null;
    const parent = await client.incident.findFirst({
      where: { AND: [{ id: top.targetIncidentId }, readable] },
      select: { id: true, title: true, service: { select: { name: true } } },
    });
    if (!parent) return null;
    return {
      parentId: parent.id,
      parentRef: incidentRef(parent.id),
      parentTitle: parent.title,
      serviceName: parent.service?.name ?? null,
      childCount: top._count.sourceIncidentId,
    };
  } catch (error) {
    logger.warn('[Intelligence] Wallboard largest group unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
