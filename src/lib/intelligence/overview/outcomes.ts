import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import { OVERVIEW_SECTION_BUDGET, type OverviewScope } from './scope';
import type { OverviewWindow } from './window';

export interface OutcomeTotals {
  incidents: number;
  acknowledged: number;
  resolved: number;
  /** Mean seconds from creation to first acknowledgement, over acknowledged incidents. */
  mttaSeconds: number | null;
  /** Mean seconds from creation to resolution, over resolved incidents. */
  mttrSeconds: number | null;
}

export interface OutcomeBucket {
  /** Offset of the bucket from the start of its window, 0-based. */
  index: number;
  current: { mttaSeconds: number | null; mttrSeconds: number | null; incidents: number };
  previous: { mttaSeconds: number | null; mttrSeconds: number | null; incidents: number };
}

export interface OverviewOutcomes {
  current: OutcomeTotals;
  previous: OutcomeTotals;
  series: OutcomeBucket[];
}

interface Row {
  current: boolean;
  bucket: number;
  incidents: number;
  acked: number;
  resolved: number;
  ack_seconds: number | null;
  resolve_seconds: number | null;
}

function totals(rows: Row[]): OutcomeTotals {
  const sum = (pick: (row: Row) => number | null) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const acknowledged = sum(row => row.acked);
  const resolved = sum(row => row.resolved);
  return {
    incidents: sum(row => row.incidents),
    acknowledged,
    resolved,
    mttaSeconds: acknowledged > 0 ? sum(row => row.ack_seconds) / acknowledged : null,
    mttrSeconds: resolved > 0 ? sum(row => row.resolve_seconds) / resolved : null,
  };
}

/**
 * MTTA and MTTR for incidents created in the window and in the equally long window before it, with a
 * per-bucket series aligned by offset so the two periods overlay. One aggregate over the
 * Incident(createdAt, acknowledgedAt) range for both windows; at most 2 × 30 groups come back.
 */
export async function getOverviewOutcomes(
  scope: OverviewScope,
  window: OverviewWindow,
  client: typeof prisma = prisma
): Promise<OverviewOutcomes> {
  const { since, until, previousSince, bucketMs, buckets } = window;
  const bucketSeconds = bucketMs / 1000;
  const rows = await withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    tx =>
      tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT (i."createdAt" >= ${since}) AS current,
          LEAST(${buckets - 1}::int, floor(EXTRACT(EPOCH FROM (i."createdAt" -
            CASE WHEN i."createdAt" >= ${since} THEN ${since}::timestamp ELSE ${previousSince}::timestamp END
          )) / ${bucketSeconds}::float8))::int AS bucket,
          count(*)::int AS incidents,
          count(i."acknowledgedAt")::int AS acked,
          count(i."resolvedAt")::int AS resolved,
          sum(GREATEST(0, EXTRACT(EPOCH FROM (i."acknowledgedAt" - i."createdAt"))))::float8 AS ack_seconds,
          sum(GREATEST(0, EXTRACT(EPOCH FROM (i."resolvedAt" - i."createdAt"))))::float8 AS resolve_seconds
        FROM "Incident" i
        WHERE i."createdAt" >= ${previousSince} AND i."createdAt" < ${until} ${scope.incidentSql('i')}
        GROUP BY 1, 2`),
    client
  );
  const current = rows.filter(row => row.current);
  const previous = rows.filter(row => !row.current);
  const point = (row: Row | undefined) => ({
    incidents: row?.incidents ?? 0,
    mttaSeconds: row && row.acked > 0 ? (row.ack_seconds ?? 0) / row.acked : null,
    mttrSeconds: row && row.resolved > 0 ? (row.resolve_seconds ?? 0) / row.resolved : null,
  });
  return {
    current: totals(current),
    previous: totals(previous),
    series: Array.from({ length: buckets }, (_, index) => ({
      index,
      current: point(current.find(row => row.bucket === index)),
      previous: point(previous.find(row => row.bucket === index)),
    })),
  };
}
