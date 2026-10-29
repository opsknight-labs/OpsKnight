import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { withDbBudget } from '../jobs/db-budget';
import { detectCapabilities } from '../similarity/capabilities';
import { MAX_DIMENSIONS, MIN_DIMENSIONS } from './vector';

export interface SemanticSearchOptions {
  /** Only vectors from this model are compared; vectors from another model are meaningless here. */
  model: string;
  lowerBound: Date;
  /** Neighbours returned. */
  limit: number;
  /** Vectors examined by the exact scan when no nearest-neighbour index is available. */
  scanLimit: number;
  /** Candidates found by other means whose semantic score is also wanted. */
  alsoScore: readonly string[];
  maxDbMs: number;
}

/** Candidates the HNSW index walks per query; higher trades latency for recall. */
const ANN_EF_SEARCH = 200;

const validDims = (dims: number) =>
  Number.isInteger(dims) && dims >= MIN_DIMENSIONS && dims <= MAX_DIMENSIONS;
const annIndexName = (dims: number) => `idx_incident_embedding_hnsw_${dims}`;

const readyIndexes = new Set<number>();
const building = new Set<number>();

/** True when a valid HNSW index for `dims` exists. Positive answers are cached for the process. */
async function annIndexReady(dims: number): Promise<boolean> {
  if (readyIndexes.has(dims)) return true;
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = ${annIndexName(dims)} AND i.indisvalid) AS ready`;
  if (rows[0]?.ready) readyIndexes.add(dims);
  return rows[0]?.ready === true;
}

/**
 * Makes sure an approximate nearest-neighbour index exists for vectors of `dims` dimensions when pgvector
 * is installed. The index is an expression index over the existing REAL[] column (cast to vector), partial
 * on the dimension count, so models of different sizes each get their own and no column changes. It is
 * built CONCURRENTLY in the background so writes are never blocked; a failed build leaves an invalid index
 * that is dropped and retried on a later pass. Without pgvector this does nothing.
 */
export async function ensureAnnIndex(dims: number): Promise<void> {
  if (!validDims(dims) || building.has(dims)) return;
  if (!(await detectCapabilities()).vectorAvailable) return;
  if (await annIndexReady(dims)) return;
  building.add(dims);
  const name = Prisma.raw(`"${annIndexName(dims)}"`);
  const size = Prisma.raw(String(dims));
  try {
    await prisma.$executeRaw`DROP INDEX CONCURRENTLY IF EXISTS ${name}`;
    await prisma.$executeRaw`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON "IncidentEmbedding"
      USING hnsw ((("vector")::vector(${size})) vector_cosine_ops)
      WHERE "dims" = ${size} AND "vector" IS NOT NULL`;
    readyIndexes.add(dims);
  } catch (error) {
    logger.warn(
      '[Intelligence] Could not build the semantic search index; exact search stays in use',
      {
        dims,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  } finally {
    building.delete(dims);
  }
}

/**
 * Cosine similarity between `incidentId` and its nearest neighbours (vectors are unit length, so cosine is a
 * dot product). With pgvector and a ready index this is an approximate nearest-neighbour search over the
 * whole lookback window. Otherwise it is an exact scan over the most recent vectors of the same service and
 * the most recent vectors overall, each bounded by `scanLimit`. Returns an empty map when the incident has no
 * vector for `model`. It runs in its own statement budget, so a slow semantic search can only ever drop the
 * semantic signal, never the lexical one.
 */
export async function semanticNeighbours(
  incidentId: string,
  options: SemanticSearchOptions
): Promise<Map<string, number>> {
  const source = await prisma.incidentEmbedding.findUnique({
    where: { incidentId },
    select: { model: true, dims: true, serviceId: true, vector: true },
  });
  const scores = new Map<string, number>();
  // A vector-less row marks text the provider could not embed; it has no neighbours.
  if (
    !source ||
    source.model !== options.model ||
    source.vector.length !== source.dims ||
    !validDims(source.dims)
  ) {
    return scores;
  }
  const useIndex =
    (await detectCapabilities()).vectorAvailable && (await annIndexReady(source.dims));

  return withDbBudget({ maxDbMs: options.maxDbMs }, async tx => {
    const size = Prisma.raw(String(source.dims));
    const nearest = useIndex
      ? await (async () => {
          // Iterative scans (pgvector 0.8+) keep walking the graph when the model or time filter rejects
          // candidates, so filtering cannot starve the result; older versions ignore the unknown setting.
          await tx.$executeRaw`SELECT set_config('hnsw.ef_search', ${String(ANN_EF_SEARCH)}, true),
                                      set_config('hnsw.iterative_scan', 'relaxed_order', true)`;
          const query = `[${source.vector.join(',')}]`;
          return tx.$queryRaw<Array<{ incidentId: string; cosine: number }>>(Prisma.sql`
            SELECT "incidentId", (1 - (("vector")::vector(${size}) <=> ${query}::vector(${size})))::float8 AS cosine
            FROM "IncidentEmbedding"
            WHERE "dims" = ${size} AND "vector" IS NOT NULL AND "model" = ${options.model}
              AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${options.lowerBound}
            ORDER BY ("vector")::vector(${size}) <=> ${query}::vector(${size})
            LIMIT ${options.limit}`);
        })()
      : await tx.$queryRaw<Array<{ incidentId: string; cosine: number }>>(Prisma.sql`
          WITH q AS (SELECT "vector" FROM "IncidentEmbedding" WHERE "incidentId" = ${incidentId}),
          same_service AS (
            SELECT "incidentId", "vector" FROM "IncidentEmbedding"
            WHERE "serviceId" = ${source.serviceId} AND "model" = ${options.model} AND "dims" = ${source.dims}
              AND "vector" IS NOT NULL AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${options.lowerBound}
            ORDER BY "incidentCreatedAt" DESC
            LIMIT ${options.scanLimit}
          ),
          recent AS (
            SELECT "incidentId", "vector" FROM "IncidentEmbedding"
            WHERE "model" = ${options.model} AND "dims" = ${source.dims}
              AND "vector" IS NOT NULL AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${options.lowerBound}
            ORDER BY "incidentCreatedAt" DESC
            LIMIT ${options.scanLimit}
          ),
          scanned AS (SELECT * FROM same_service UNION SELECT * FROM recent)
          SELECT s."incidentId",
                 (SELECT COALESCE(SUM(x * y), 0) FROM unnest(s."vector", q."vector") AS t(x, y))::float8 AS cosine
          FROM scanned s, q
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
        WHERE e."incidentId" = ANY(${missing}) AND e."model" = ${options.model} AND e."dims" = ${source.dims}
          AND e."vector" IS NOT NULL`);
      for (const row of extra) scores.set(row.incidentId, Number(row.cosine));
    }
    return scores;
  });
}
