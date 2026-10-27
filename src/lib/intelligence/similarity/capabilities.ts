import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * Similarity tiers, best first. Both always work on any PostgreSQL: full-text search is built in,
 * and trigram matching is an optimisation that is used only when pg_trgm is actually installed.
 */
export type SimilarityTier = 'TRIGRAM_FTS' | 'FTS_ONLY';

export interface IntelligenceCapabilities {
  similarityTier: SimilarityTier;
  trigramAvailable: boolean;
}

const CACHE_TTL_MS = 60_000;
let cached: { value: IntelligenceCapabilities; at: number } | null = null;

/** Detection is advisory and cached briefly; a failed probe degrades to the always-available tier. */
export async function detectCapabilities(
  client: Client = prisma,
  now: number = Date.now()
): Promise<IntelligenceCapabilities> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  let trigramAvailable = false;
  try {
    const rows = await client.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AND
             EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_incident_fingerprint_trgm') AS present`;
    trigramAvailable = rows[0]?.present === true;
  } catch {
    trigramAvailable = false;
  }
  const value: IntelligenceCapabilities = {
    trigramAvailable,
    similarityTier: trigramAvailable ? 'TRIGRAM_FTS' : 'FTS_ONLY',
  };
  cached = { value, at: now };
  return value;
}

export function resetCapabilityCacheForTests() {
  cached = null;
}
