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
export const MAX_SERVICES_PER_OBSERVATION_BUCKET = 128;
export const OBSERVE_MIN_LIFT = 1.5;
export const OBSERVE_SOURCE_PAGE_SIZE = 2000;
const OBSERVATION_CURSOR = 'dependency-observation';
const SOURCE_SAFETY_LAG_MS = 30_000;
const MAX_CONFIDENCE = 0.9;

/**
 * Proposes "B depends on A" when incidents on B repeatedly open shortly after incidents on A. This is
 * correlation, not causation, so edges are only ever created as SUGGESTED for a person to approve or
 * reject; they influence nothing until approved. Existing edges, including rejected ones, are never
 * touched, so a rejection is permanent.
 *
 * Incidents are bucketed into windows of OBSERVE_WINDOW_MINUTES, and each incident is only compared with
 * its own and the next bucket, which is an equality hash join rather than a range self-join, so the cost
 * is capped per bucket and service before joining. Lift compares co-occurrence with the independent
 * baseline, with minimum support; suggested edges never become active without human approval. Pairs that already have an edge are excluded before
 * the per-run limit, so earlier suggestions can never crowd out new ones. One replica runs it at a time.
 */
export async function suggestObservedDependencies(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  now: Date = new Date()
): Promise<number> {
  return (await observeDependencyPass(settings, now)).suggestions;
}

/** Consume one bounded page of new source incidents, then rank over retained bucket metadata.
 * The cursor and bucket upserts commit together. No raw source history is re-read on steady passes.
 */
export async function observeDependencyPass(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  now: Date = new Date()
): Promise<{ suggestions: number; more: boolean }> {
  const since = new Date(now.getTime() - OBSERVE_LOOKBACK_DAYS * 86_400_000);
  const upper = new Date(+now - SOURCE_SAFETY_LAG_MS);
  const bucketSeconds = OBSERVE_WINDOW_MINUTES * 60;
  return withDbBudget(settings, async tx => {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('intelligence-dependency-observer', 0)) AS locked`;
    if (!locked) return { suggestions: 0, more: true };
    const cursor = await tx.intelligenceCursor.findUnique({ where: { name: OBSERVATION_CURSOR } });
    const after =
      cursor && cursor.watermarkAt >= since && cursor.watermarkAt <= upper
        ? cursor
        : { watermarkAt: since, lastId: '' };
    const source = await tx.incident.findMany({
      where: {
        createdAt: { gte: since, lte: upper },
        OR: [
          { createdAt: { gt: after.watermarkAt } },
          { createdAt: after.watermarkAt, id: { gt: after.lastId } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: OBSERVE_SOURCE_PAGE_SIZE,
      select: { id: true, serviceId: true, createdAt: true },
    });
    const buckets = new Map<string, { serviceId: string; bucket: Date; first: Date }>();
    for (const row of source) {
      const bucket = new Date(
        Math.floor(+row.createdAt / (bucketSeconds * 1000)) * bucketSeconds * 1000
      );
      const key = `${row.serviceId}:${+bucket}`;
      const existing = buckets.get(key);
      if (!existing || row.createdAt < existing.first)
        buckets.set(key, { serviceId: row.serviceId, bucket, first: row.createdAt });
    }
    if (buckets.size)
      await tx.$executeRaw(Prisma.sql`
      INSERT INTO "DependencyObservationBucket" (bucket, "serviceId", "firstIncidentAt")
      VALUES ${Prisma.join([...buckets.values()].map(row => Prisma.sql`(${row.bucket}, ${row.serviceId}, ${row.first})`))}
      ON CONFLICT (bucket, "serviceId") DO UPDATE SET
        "firstIncidentAt" = LEAST("DependencyObservationBucket"."firstIncidentAt", EXCLUDED."firstIncidentAt"),
        "updatedAt" = now()`);
    const last = source[source.length - 1];
    const next = last
      ? { watermarkAt: last.createdAt, lastId: last.id }
      : { watermarkAt: upper, lastId: '' };
    await tx.intelligenceCursor.upsert({
      where: { name: OBSERVATION_CURSOR },
      create: { name: OBSERVATION_CURSOR, ...next },
      update: next,
    });
    // Wait for complete source coverage before scoring; an unfinished bootstrap is not evidence.
    if (source.length === OBSERVE_SOURCE_PAGE_SIZE) return { suggestions: 0, more: true };
    const suggestions = await tx.$executeRaw(Prisma.sql`
      WITH raw_recent AS (
        SELECT "serviceId" || ':' || bucket::text AS id, "serviceId", "firstIncidentAt" AS "createdAt",
               floor(extract(epoch FROM bucket) / ${bucketSeconds}::int)::bigint AS bucket
        FROM "DependencyObservationBucket"
        WHERE bucket >= ${new Date(Math.floor(+since / (bucketSeconds * 1000)) * bucketSeconds * 1000)}
          AND "firstIncidentAt" >= ${since} AND "firstIncidentAt" <= ${upper}
        ORDER BY bucket DESC, "serviceId" LIMIT ${MAX_INCIDENTS_SCANNED}
      ),
      service_buckets AS (
        SELECT DISTINCT ON ("serviceId", bucket) "id", "serviceId", "createdAt", bucket
        FROM raw_recent ORDER BY "serviceId", bucket, "createdAt" ASC, "id" ASC
      ),
      ranked_buckets AS (
        SELECT *, row_number() OVER (PARTITION BY bucket ORDER BY "createdAt", "serviceId") AS position
        FROM service_buckets
      ),
      recent AS (
        SELECT "id", "serviceId", "createdAt", bucket FROM ranked_buckets
        WHERE position <= ${MAX_SERVICES_PER_OBSERVATION_BUCKET}
      ),
      observation AS (
        SELECT GREATEST(1, floor(extract(epoch FROM ${now}::timestamptz) / ${bucketSeconds}::int) - min(bucket) + 1)::float AS slots
        FROM recent
      ),
      totals AS (
        SELECT "serviceId", count(*)::float AS total FROM recent GROUP BY "serviceId"
      ),
      probes AS (
        SELECT a."serviceId", a."createdAt", a.bucket + shift AS bucket
        FROM recent a CROSS JOIN (VALUES (0::bigint), (1::bigint)) AS shifts(shift)
      ),
      probe_totals AS (
        SELECT "serviceId", count(DISTINCT bucket)::float AS total FROM probes
        WHERE bucket <= floor(extract(epoch FROM ${now}::timestamptz) / ${bucketSeconds}::int)
        GROUP BY "serviceId"
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
             LEAST(${MAX_CONFIDENCE}::float, 1 - 1 / (pairs.co * observation.slots / (totals.total * up_totals.total))),
             jsonb_build_object('type', 'co_occurrence', 'windowMinutes', ${OBSERVE_WINDOW_MINUTES}::int,
                                'coOccurrences', pairs.co, 'downstreamIncidents', totals.total::int,
                                'lookbackDays', ${OBSERVE_LOOKBACK_DAYS}::int,
                                'lift', pairs.co * observation.slots / (totals.total * up_totals.total),
                                'upstreamBuckets', up_totals.total::int,
                                'observedBuckets', observation.slots::int,
                                'sampleCapped', (SELECT count(*) >= ${MAX_INCIDENTS_SCANNED} FROM raw_recent),
                                'bucketCapped', EXISTS (SELECT 1 FROM ranked_buckets WHERE position > ${MAX_SERVICES_PER_OBSERVATION_BUCKET})),
             now()
      FROM pairs JOIN totals ON totals."serviceId" = pairs.down
      CROSS JOIN observation
      JOIN probe_totals up_totals ON up_totals."serviceId" = pairs.up
      WHERE pairs.co * observation.slots / (totals.total * up_totals.total) >= ${OBSERVE_MIN_LIFT}
      AND NOT EXISTS (
        SELECT 1 FROM "ServiceDependency" d
        WHERE d."upstreamServiceId" = pairs.up AND d."downstreamServiceId" = pairs.down)
      ORDER BY pairs.co DESC
      LIMIT ${MAX_SUGGESTIONS_PER_RUN}
      ON CONFLICT ("upstreamServiceId", "downstreamServiceId") DO NOTHING
    `);
    return { suggestions, more: false };
  });
}
