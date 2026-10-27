import 'server-only';
import { Prisma } from '@prisma/client';
import { withDbBudget } from '../jobs/db-budget';
import type { IntelligenceSettingsView } from '../settings/service';

export const OBSERVE_INTERVAL_MS = 60 * 60_000;
export const OBSERVE_WINDOW_MINUTES = 10;
export const OBSERVE_LOOKBACK_DAYS = 30;
export const OBSERVE_MIN_CO_OCCURRENCES = 5;
const MAX_INCIDENTS_SCANNED = 20_000;
const MAX_SUGGESTIONS_PER_RUN = 50;
const MAX_CONFIDENCE = 0.9;

/**
 * Proposes "B depends on A" when incidents on B repeatedly open shortly after incidents on A. This is
 * correlation, not causation, so edges are only ever created as SUGGESTED for a person to approve or
 * reject; they influence nothing until approved. Existing edges, including rejected ones, are never
 * touched, so a rejection is permanent. The scan is bounded by lookback, row cap and statement timeout.
 */
export async function suggestObservedDependencies(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  now: Date = new Date()
): Promise<number> {
  const since = new Date(now.getTime() - OBSERVE_LOOKBACK_DAYS * 86_400_000);
  return withDbBudget({ maxDbMs: Math.max(settings.maxDbMs, 10_000) }, tx =>
    tx.$executeRaw(Prisma.sql`
      WITH recent AS (
        SELECT "id", "serviceId", "createdAt" FROM "Incident"
        WHERE "createdAt" >= ${since}
        ORDER BY "createdAt" DESC LIMIT ${MAX_INCIDENTS_SCANNED}
      ),
      totals AS (
        SELECT "serviceId", count(*)::float AS total FROM recent GROUP BY "serviceId"
      ),
      pairs AS (
        SELECT a."serviceId" AS up, b."serviceId" AS down, count(DISTINCT b."id")::int AS co
        FROM recent a
        JOIN recent b
          ON b."serviceId" <> a."serviceId"
         AND b."createdAt" > a."createdAt"
         AND b."createdAt" <= a."createdAt" + make_interval(mins => ${OBSERVE_WINDOW_MINUTES}::int)
        GROUP BY a."serviceId", b."serviceId"
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
      ORDER BY pairs.co DESC
      LIMIT ${MAX_SUGGESTIONS_PER_RUN}
      ON CONFLICT ("upstreamServiceId", "downstreamServiceId") DO NOTHING
    `)
  );
}
