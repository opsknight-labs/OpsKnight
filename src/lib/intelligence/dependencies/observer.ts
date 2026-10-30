import 'server-only';
import { Prisma } from '@prisma/client';
import { withDbBudget } from '../jobs/db-budget';
import type { IntelligenceSettingsView } from '../settings/service';

export const OBSERVE_INTERVAL_MS = 60 * 60_000;
export const OBSERVE_WINDOW_MINUTES = 10;
export const OBSERVE_LOOKBACK_DAYS = 30;
export const OBSERVE_MIN_CO_OCCURRENCES = 5;
const MAX_INCIDENTS_SCANNED = 50_000;
const MAX_SUGGESTIONS_PER_RUN = 50;
const MAX_CONFIDENCE = 0.9;

/**
 * Proposes "B depends on A" when incidents on B repeatedly open shortly after incidents on A. This is
 * correlation, not causation, so edges are only ever created as SUGGESTED for a person to approve or
 * reject; they influence nothing until approved. Existing edges, including rejected ones, are never
 * touched, so a rejection is permanent.
 *
 * Incidents are bucketed into windows of OBSERVE_WINDOW_MINUTES, and each incident is only compared with
 * its own and the next bucket, which is an equality hash join rather than a range self-join, so the cost
 * grows with the number of incidents, not its square. Pairs that already have an edge are excluded before
 * the per-run limit, so earlier suggestions can never crowd out new ones. One replica runs it at a time.
 */
export async function suggestObservedDependencies(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  now: Date = new Date()
): Promise<number> {
  const since = new Date(now.getTime() - OBSERVE_LOOKBACK_DAYS * 86_400_000);
  const bucketSeconds = OBSERVE_WINDOW_MINUTES * 60;
  return withDbBudget({ maxDbMs: Math.max(settings.maxDbMs, 10_000) }, async tx => {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('intelligence-dependency-observer', 0)) AS locked`;
    if (!locked) return 0;
    return tx.$executeRaw(Prisma.sql`
      WITH recent AS (
        SELECT "id", "serviceId", "createdAt",
               floor(extract(epoch FROM "createdAt") / ${bucketSeconds}::int)::bigint AS bucket
        FROM "Incident"
        WHERE "createdAt" >= ${since}
        ORDER BY "createdAt" DESC LIMIT ${MAX_INCIDENTS_SCANNED}
      ),
      totals AS (
        SELECT "serviceId", count(*)::float AS total FROM recent GROUP BY "serviceId"
      ),
      probes AS (
        SELECT a."serviceId", a."createdAt", a.bucket + shift AS bucket
        FROM recent a CROSS JOIN (VALUES (0::bigint), (1::bigint)) AS shifts(shift)
      ),
      pairs AS (
        SELECT p."serviceId" AS up, b."serviceId" AS down, count(DISTINCT b."id")::int AS co
        FROM probes p
        JOIN recent b
          ON b.bucket = p.bucket
         AND b."serviceId" <> p."serviceId"
         AND b."createdAt" > p."createdAt"
         AND b."createdAt" <= p."createdAt" + make_interval(mins => ${OBSERVE_WINDOW_MINUTES}::int)
        GROUP BY p."serviceId", b."serviceId"
        HAVING count(DISTINCT b."id") >= ${OBSERVE_MIN_CO_OCCURRENCES}
      )
      INSERT INTO "ServiceDependency"
        ("id", "upstreamServiceId", "downstreamServiceId", "origin", "status", "confidence", "evidence", "updatedAt")
      SELECT gen_random_uuid()::text, pairs.up, pairs.down, 'OBSERVED', 'SUGGESTED',
             LEAST(${MAX_CONFIDENCE}::float, round((pairs.co / totals.total)::numeric, 3)::float),
             jsonb_build_object('type', 'co_occurrence', 'windowMinutes', ${OBSERVE_WINDOW_MINUTES}::int,
                                'coOccurrences', pairs.co, 'downstreamIncidents', totals.total::int,
                                'lookbackDays', ${OBSERVE_LOOKBACK_DAYS}::int),
             now()
      FROM pairs JOIN totals ON totals."serviceId" = pairs.down
      WHERE NOT EXISTS (
        SELECT 1 FROM "ServiceDependency" d
        WHERE d."upstreamServiceId" = pairs.up AND d."downstreamServiceId" = pairs.down)
      ORDER BY pairs.co DESC
      LIMIT ${MAX_SUGGESTIONS_PER_RUN}
      ON CONFLICT ("upstreamServiceId", "downstreamServiceId") DO NOTHING
    `);
  });
}
