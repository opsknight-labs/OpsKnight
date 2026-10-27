import 'server-only';
import type { Prisma } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import type { SimilarIncident } from '../similarity/retrieval';
import type { SimilarityTier } from '../similarity/capabilities';

/**
 * Replaces an incident's ACTIVE similar-incident findings. Writes are fenced by generation: if a
 * newer analysis already wrote, a late-arriving result from an older run is dropped instead of
 * overwriting it. Replaced findings are marked SUPERSEDED, never deleted, so the history stays
 * auditable. Evidence holds only numeric components — never text from the other incident, which the
 * eventual viewer may not be allowed to see.
 */
export async function replaceSimilarFindings(
  tx: Prisma.TransactionClient,
  input: {
    incidentId: string;
    generation: number;
    policyVersion: number | null;
    tier: SimilarityTier;
    results: SimilarIncident[];
  }
): Promise<'written' | 'stale'> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-finding:${input.incidentId}`}, 0))`;

  const newest = await tx.intelligenceFinding.aggregate({
    where: { incidentId: input.incidentId, kind: 'SIMILAR_INCIDENT' },
    _max: { generation: true },
  });
  if ((newest._max.generation ?? 0) > input.generation) return 'stale';

  await tx.intelligenceFinding.updateMany({
    where: { incidentId: input.incidentId, kind: 'SIMILAR_INCIDENT', status: 'ACTIVE' },
    data: { status: 'SUPERSEDED', supersededAt: new Date() },
  });
  if (input.results.length > 0) {
    await tx.intelligenceFinding.createMany({
      data: input.results.map((result, index) => ({
        incidentId: input.incidentId,
        kind: 'SIMILAR_INCIDENT' as const,
        rank: index + 1,
        // The score is a ranking signal, not yet a calibrated probability; evidence says so.
        confidence: result.score,
        subjectRef: result.incidentId,
        evidence: {
          type: 'similarity',
          calibrated: false,
          tier: input.tier,
          components: { ...result.components },
          matchedTokenCount: result.matchedTokenCount,
        },
        generation: input.generation,
        engineVersion: INTELLIGENCE_ENGINE_VERSION,
        policyVersion: input.policyVersion,
      })),
    });
  }
  return 'written';
}
