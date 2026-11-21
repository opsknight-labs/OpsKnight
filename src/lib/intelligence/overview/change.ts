import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import {
  OVERVIEW_INCIDENT_SAMPLE_CAP,
  OVERVIEW_SECTION_BUDGET,
  serviceIdFilter,
  type OverviewScope,
} from './scope';
import type { OverviewWindow } from './window';

const TOP = 5;

export interface OverviewLinkedIncident {
  incidentId: string;
  title: string;
  createdAt: Date;
  change: { id: string; summary: string } | null;
}

export interface OverviewRiskyChange {
  id: string;
  summary: string;
  kind: string;
  source: string;
  serviceId: string | null;
  serviceName: string | null;
  occurredAt: Date;
  riskScore: number;
  url: string | null;
}

export interface OverviewChange {
  incidents: number;
  changeLinked: number;
  recentLinked: OverviewLinkedIncident[];
  changes: number;
  scoredChanges: number;
  riskiest: OverviewRiskyChange[];
  sampleTruncated: boolean;
}

/**
 * Incidents with a suggested change cause and the riskiest recent changes, for what the viewer may read.
 * Incidents come from Incident(createdAt) capped per window, joined to the finding lookup index; changes
 * come from ChangeEvent(occurredAt) restricted to readable services.
 */
export async function getOverviewChange(
  scope: OverviewScope,
  window: OverviewWindow,
  client: typeof prisma = prisma
): Promise<OverviewChange> {
  const { since, until } = window;
  return withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    async tx => {
      const linkedSql = Prisma.sql`
        WITH candidates AS MATERIALIZED (
          SELECT i.id, i.title, i."createdAt" FROM "Incident" i
          WHERE i."createdAt" >= ${since} AND i."createdAt" < ${until} ${scope.incidentSql('i')}
          ORDER BY i."createdAt" DESC LIMIT ${OVERVIEW_INCIDENT_SAMPLE_CAP + 1}
        ), inc AS (
          SELECT * FROM candidates ORDER BY "createdAt" DESC LIMIT ${OVERVIEW_INCIDENT_SAMPLE_CAP}
        ), linked AS (
          SELECT inc.id, inc.title, inc."createdAt", f."subjectRef" FROM inc
          CROSS JOIN LATERAL (
            SELECT fi."subjectRef" FROM "IntelligenceFinding" fi
            WHERE fi."incidentId" = inc.id AND fi.status = 'ACTIVE' AND fi.kind = 'CHANGE_CORRELATION'
              AND fi."subjectRef" IS NOT NULL
            ORDER BY fi.rank ASC LIMIT 1
          ) f
        )`;
      const [counts] = await tx.$queryRaw<
        Array<{ candidates: bigint; incidents: bigint; linked: bigint }>
      >(Prisma.sql`${linkedSql}
        SELECT (SELECT count(*) FROM candidates)::bigint AS candidates,
          (SELECT count(*) FROM inc)::bigint AS incidents,
          (SELECT count(*) FROM linked)::bigint AS linked`);
      const recent = await tx.$queryRaw<
        Array<{ id: string; title: string; createdAt: Date; subjectRef: string }>
      >(Prisma.sql`${linkedSql}
        SELECT id, title, "createdAt", "subjectRef" FROM linked ORDER BY "createdAt" DESC LIMIT ${TOP}`);

      const readableChanges: Prisma.ChangeEventWhereInput =
        scope.serviceIds === null ? {} : serviceIdFilter(scope);
      const inWindow: Prisma.ChangeEventWhereInput = {
        ...readableChanges,
        occurredAt: { gte: since, lt: until },
      };
      const [linkedChanges, changes, scoredChanges, riskiest] = await Promise.all([
        recent.length === 0
          ? []
          : tx.changeEvent.findMany({
              where: { ...readableChanges, id: { in: recent.map(row => row.subjectRef) } },
              select: { id: true, summary: true },
            }),
        tx.changeEvent.count({ where: inWindow }),
        tx.changeEvent.count({ where: { ...inWindow, riskScore: { not: null } } }),
        tx.changeEvent.findMany({
          where: { ...inWindow, riskScore: { not: null } },
          orderBy: [{ riskScore: 'desc' }, { occurredAt: 'desc' }],
          take: TOP,
          select: {
            id: true,
            summary: true,
            kind: true,
            source: true,
            serviceId: true,
            occurredAt: true,
            riskScore: true,
            url: true,
            service: { select: { name: true } },
          },
        }),
      ]);
      const changeById = new Map(linkedChanges.map(change => [change.id, change]));
      return {
        incidents: Number(counts?.incidents ?? 0),
        changeLinked: Number(counts?.linked ?? 0),
        recentLinked: recent.map(row => ({
          incidentId: row.id,
          title: row.title,
          createdAt: row.createdAt,
          change: changeById.get(row.subjectRef) ?? null,
        })),
        changes,
        scoredChanges,
        riskiest: riskiest.map(change => ({
          id: change.id,
          summary: change.summary,
          kind: change.kind,
          source: change.source,
          serviceId: change.serviceId,
          serviceName: change.service?.name ?? null,
          occurredAt: change.occurredAt,
          riskScore: change.riskScore ?? 0,
          url: change.url,
        })),
        sampleTruncated: Number(counts?.candidates ?? 0) > OVERVIEW_INCIDENT_SAMPLE_CAP,
      };
    },
    client
  );
}
