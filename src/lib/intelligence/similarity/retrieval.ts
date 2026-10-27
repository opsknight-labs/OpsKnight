import 'server-only';
import { Prisma } from '@prisma/client';
import { withDbBudget } from '../jobs/db-budget';
import { detectCapabilities, type SimilarityTier } from './capabilities';
import { scoreSimilarity, type SimilarityComponents, type SimilarityFingerprint } from './scoring';

export interface SimilarityOptions {
  /** Candidates fetched per source; the total examined is at most 3x this. */
  candidateCap: number;
  lookbackDays: number;
  minScore: number;
  limit: number;
  maxDbMs: number;
  now?: Date;
}

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

const MAX_QUERY_TOKENS = 16;
const TRIGRAM_THRESHOLD = '0.3';

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
  const labels = row.labels && typeof row.labels === 'object' && !Array.isArray(row.labels) ? row.labels : {};
  return {
    template: row.template,
    tokens: row.tokens,
    labels: Object.fromEntries(
      Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
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
  const capabilities = await detectCapabilities();

  return withDbBudget({ maxDbMs: options.maxDbMs }, async tx => {
    const source = await tx.incidentFingerprint.findUnique({ where: { incidentId } });
    if (!source) return null;
    const query = toFingerprint({ ...source, incidentId });
    const cap = options.candidateCap;
    const candidateIds = new Set<string>();
    const collect = (rows: Array<{ incidentId: string }>) => {
      for (const row of rows) candidateIds.add(row.incidentId);
    };

    collect(
      await tx.$queryRaw<Array<{ incidentId: string }>>(Prisma.sql`
        SELECT "incidentId" FROM "IncidentFingerprint"
        WHERE "serviceId" = ${source.serviceId} AND "incidentId" <> ${incidentId}
          AND "incidentCreatedAt" > ${lowerBound}
        ORDER BY "incidentCreatedAt" DESC
        LIMIT ${cap}`)
    );

    const tokens = source.tokens.slice(0, MAX_QUERY_TOKENS);
    if (tokens.length > 0) {
      // Tokens are restricted to [a-z]{2,32} by normalization, so the OR query is always valid.
      const tsQuery = tokens.join(' | ');
      collect(
        await tx.$queryRaw<Array<{ incidentId: string }>>(Prisma.sql`
          SELECT "incidentId" FROM "IncidentFingerprint"
          WHERE to_tsvector('simple', "template") @@ to_tsquery('simple', ${tsQuery})
            AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${lowerBound}
          ORDER BY ts_rank_cd(to_tsvector('simple', "template"), to_tsquery('simple', ${tsQuery})) DESC
          LIMIT ${cap}`)
      );
    }

    if (capabilities.trigramAvailable && source.template.length > 0) {
      await tx.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', ${TRIGRAM_THRESHOLD}, true)`;
      collect(
        await tx.$queryRaw<Array<{ incidentId: string }>>(Prisma.sql`
          SELECT "incidentId" FROM "IncidentFingerprint"
          WHERE "template" % ${source.template}
            AND "incidentId" <> ${incidentId} AND "incidentCreatedAt" > ${lowerBound}
          ORDER BY similarity("template", ${source.template}) DESC
          LIMIT ${cap}`)
      );
    }

    if (candidateIds.size === 0) {
      return { tier: capabilities.similarityTier, candidatesEvaluated: 0, results: [] };
    }
    const candidates = await tx.incidentFingerprint.findMany({
      where: { incidentId: { in: [...candidateIds] } },
    });

    const results = candidates
      .map(candidate => ({
        incidentId: candidate.incidentId,
        createdAt: candidate.incidentCreatedAt,
        ...scoreSimilarity(query, toFingerprint(candidate), now),
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
