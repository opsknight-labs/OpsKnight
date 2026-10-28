import 'server-only';
import { Prisma } from '@prisma/client';
import { withDbBudget } from '../jobs/db-budget';

export interface SemanticSearchOptions {
  /** Only vectors from this model are compared; vectors from another model are meaningless here. */
  model: string;
  lowerBound: Date;
  /** Neighbours returned. */
  limit: number;
  /** Most-recent vectors examined; bounds the cost of the scan independently of table size. */
  scanLimit: number;
  /** Candidates found by other means whose semantic score is also wanted. */
  alsoScore: readonly string[];
  maxDbMs: number;
}

/**
 * Cosine similarity between `incidentId` and its nearest recent neighbours, computed in the database
 * as a dot product over unit vectors (no extension required). Returns an empty map when the incident
 * has no vector for `model`. The scan is bounded by `scanLimit`, and it runs in its own statement
 * budget so a slow semantic search can only ever drop the semantic signal, never the lexical one.
 */
export async function semanticNeighbours(
  incidentId: string,
  options: SemanticSearchOptions
): Promise<Map<string, number>> {
  return withDbBudget({ maxDbMs: options.maxDbMs }, async tx => {
    const scores = new Map<string, number>();
    const source = await tx.incidentEmbedding.findUnique({
      where: { incidentId },
      select: { model: true, dims: true },
    });
    if (!source || source.model !== options.model) return scores;

    const nearest = await tx.$queryRaw<Array<{ incidentId: string; cosine: number }>>(Prisma.sql`
      WITH q AS (SELECT "vector" FROM "IncidentEmbedding" WHERE "incidentId" = ${incidentId}),
      recent AS (
        SELECT "incidentId", "vector" FROM "IncidentEmbedding"
        WHERE "model" = ${options.model} AND "dims" = ${source.dims}
          AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${options.lowerBound}
        ORDER BY "incidentCreatedAt" DESC
        LIMIT ${options.scanLimit}
      )
      SELECT r."incidentId",
             (SELECT COALESCE(SUM(x * y), 0) FROM unnest(r."vector", q."vector") AS t(x, y))::float8 AS cosine
      FROM recent r, q
      ORDER BY cosine DESC
      LIMIT ${options.limit}`);
    for (const row of nearest) scores.set(row.incidentId, Number(row.cosine));

    const missing = options.alsoScore.filter(id => id !== incidentId && !scores.has(id));
    if (missing.length > 0) {
      const extra = await tx.$queryRaw<Array<{ incidentId: string; cosine: number }>>(Prisma.sql`
        WITH q AS (SELECT "vector" FROM "IncidentEmbedding" WHERE "incidentId" = ${incidentId})
        SELECT e."incidentId",
               (SELECT COALESCE(SUM(x * y), 0) FROM unnest(e."vector", q."vector") AS t(x, y))::float8 AS cosine
        FROM "IncidentEmbedding" e, q
        WHERE e."incidentId" = ANY(${missing}) AND e."model" = ${options.model} AND e."dims" = ${source.dims}`);
      for (const row of extra) scores.set(row.incidentId, Number(row.cosine));
    }
    return scores;
  });
}
