import 'server-only';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { withDbBudget } from '../jobs/db-budget';
import { semanticNeighbours } from '../semantic/search';
import { detectCapabilities, type SimilarityTier } from './capabilities';
import { scoreSimilarity, type SimilarityComponents, type SimilarityFingerprint } from './scoring';
import { selectQueryTerms, termFrequencies } from './term-stats';

export interface SimilarityOptions {
  /** Candidates fetched per source; the total examined is at most 3x this. */
  candidateCap: number;
  lookbackDays: number;
  minScore: number;
  limit: number;
  maxDbMs: number;
  now?: Date;
  /** The current embedding model; when set, semantic neighbours are added and scored. */
  semanticModel?: string | null;
}

/** Most-recent vectors compared per search, as a multiple of the per-source candidate cap. */
const SEMANTIC_SCAN_MULTIPLIER = 10;
const MAX_SEMANTIC_SCAN = 2000;

export interface SimilarIncident {
  incidentId: string;
  score: number;
  components: SimilarityComponents;
  matchedTokenCount: number;
}

export interface SimilarityResult {
  tier: SimilarityTier;
  candidatesEvaluated: number;
  results: SimilarIncident[];
}

const TRIGRAM_THRESHOLD = '0.3';

/**
 * Runs one candidate source inside a savepoint. A source that hits its statement timeout (or fails for any
 * other reason) is skipped and the others still count, so one slow index can never fail the analysis.
 */
async function tolerant<T>(
  tx: Prisma.TransactionClient,
  name: string,
  work: () => Promise<T[]>
): Promise<T[]> {
  await tx.$executeRawUnsafe(`SAVEPOINT intelligence_${name}`);
  try {
    const rows = await work();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT intelligence_${name}`);
    return rows;
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT intelligence_${name}`);
    logger.warn('[Intelligence] A similarity source failed; continuing with the others', {
      source: name,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

type StoredFingerprint = {
  incidentId: string;
  serviceId: string;
  template: string;
  tokens: string[];
  labels: Prisma.JsonValue;
  incidentCreatedAt: Date;
  resolvedAt: Date | null;
};

function toFingerprint(row: StoredFingerprint): SimilarityFingerprint {
  const labels =
    row.labels && typeof row.labels === 'object' && !Array.isArray(row.labels) ? row.labels : {};
  return {
    template: row.template,
    tokens: row.tokens,
    labels: Object.fromEntries(
      Object.entries(labels).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ),
    serviceId: row.serviceId,
    incidentCreatedAt: row.incidentCreatedAt,
    resolvedAt: row.resolvedAt,
  };
}

/**
 * Finds incidents similar to `incidentId` using bounded retrieval followed by explainable re-ranking.
 * Returns `null` when the incident has no fingerprint yet (the indexer has not run).
 */
export async function findSimilarIncidents(
  incidentId: string,
  options: SimilarityOptions
): Promise<SimilarityResult | null> {
  const now = options.now ?? new Date();
  const lowerBound = new Date(now.getTime() - options.lookbackDays * 86_400_000);
  const [capabilities, frequencies] = await Promise.all([detectCapabilities(), termFrequencies()]);

  const lexical = await withDbBudget({ maxDbMs: options.maxDbMs }, async tx => {
    const source = await tx.incidentFingerprint.findUnique({ where: { incidentId } });
    if (!source) return null;
    const query = toFingerprint({ ...source, incidentId });
    const cap = options.candidateCap;
    const candidateIds = new Set<string>();
    const collect = (rows: Array<{ incidentId: string }>) => {
      for (const row of rows) candidateIds.add(row.incidentId);
    };

    collect(
      await tolerant(tx, 'service', () =>
        tx.$queryRaw<Array<{ incidentId: string }>>(Prisma.sql`
          SELECT "incidentId" FROM "IncidentFingerprint"
          WHERE "serviceId" = ${source.serviceId} AND "incidentId" <> ${incidentId}
            AND "incidentCreatedAt" > ${lowerBound} AND "template" <> ''
          ORDER BY "incidentCreatedAt" DESC
          LIMIT ${cap}`)
      )
    );

    // Rare words first and very common ones dropped, using the column's own statistics: "error" or
    // "service" would otherwise match a large share of history and make this the most expensive query.
    // ts_rank over the stored vector is enough to pick candidates (they are re-scored below); cover
    // density ranking cost ~30x more per matching row.
    const terms = selectQueryTerms(source.tokens, frequencies);
    if (terms.length > 0) {
      // Tokens are restricted to [a-z]{2,32} by normalization, so the OR query is always valid.
      const tsQuery = terms.join(' | ');
      collect(
        await tolerant(tx, 'fulltext', () =>
          tx.$queryRaw<Array<{ incidentId: string }>>(Prisma.sql`
            SELECT "incidentId" FROM "IncidentFingerprint"
            WHERE "searchVector" @@ to_tsquery('simple', ${tsQuery})
              AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${lowerBound}
            ORDER BY ts_rank("searchVector", to_tsquery('simple', ${tsQuery})) DESC, "incidentCreatedAt" DESC
            LIMIT ${cap}`)
        )
      );
    }

    if (capabilities.trigramAvailable && source.template.length > 0) {
      collect(
        await tolerant(tx, 'trigram', async () => {
          await tx.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', ${TRIGRAM_THRESHOLD}, true)`;
          return tx.$queryRaw<Array<{ incidentId: string }>>(Prisma.sql`
            SELECT "incidentId" FROM "IncidentFingerprint"
            WHERE "template" % ${source.template}
              AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${lowerBound}
            ORDER BY "template" <-> ${source.template}
            LIMIT ${cap}`);
        })
      );
    }

    return { query, candidateIds };
  });
  if (!lexical) return null;
  const { query, candidateIds } = lexical;

  const cosines = options.semanticModel
    ? await semanticNeighbours(incidentId, {
        model: options.semanticModel,
        lowerBound,
        limit: options.candidateCap,
        scanLimit: Math.min(MAX_SEMANTIC_SCAN, options.candidateCap * SEMANTIC_SCAN_MULTIPLIER),
        alsoScore: [...candidateIds],
        maxDbMs: options.maxDbMs,
      }).catch(error => {
        // Semantic search is an enhancement: on any failure the lexical results stand alone.
        logger.warn('[Intelligence] Semantic search failed; using lexical similarity only', {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Map<string, number>();
      })
    : new Map<string, number>();
  for (const id of cosines.keys()) candidateIds.add(id);

  if (candidateIds.size === 0) {
    return { tier: capabilities.similarityTier, candidatesEvaluated: 0, results: [] };
  }
  return withDbBudget({ maxDbMs: options.maxDbMs }, async tx => {
    const candidates = await tx.incidentFingerprint.findMany({
      where: { incidentId: { in: [...candidateIds] } },
    });

    const results = candidates
      .map(candidate => ({
        incidentId: candidate.incidentId,
        createdAt: candidate.incidentCreatedAt,
        ...scoreSimilarity(query, toFingerprint(candidate), now, cosines.get(candidate.incidentId)),
      }))
      .filter(result => result.score >= options.minScore)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.incidentId < b.incidentId ? -1 : 1)
      )
      .slice(0, options.limit)
      .map(({ incidentId: id, score, components, matchedTokenCount }) => ({
        incidentId: id,
        score,
        components,
        matchedTokenCount,
      }));

    return { tier: capabilities.similarityTier, candidatesEvaluated: candidates.length, results };
  });
}
