import 'server-only';
import type { IntelligenceFindingKind, Prisma } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import type { SimilarIncident } from '../similarity/retrieval';
import type { SimilarityTier } from '../similarity/capabilities';

export interface FindingRow {
  confidence: number;
  subjectRef: string | null;
  evidence: Prisma.InputJsonObject;
}

/**
 * Replaces one incident's ACTIVE findings of a single kind. Writes are fenced by generation: if a
 * newer analysis already wrote, a late-arriving result from an older run is dropped instead of
 * overwriting it. Replaced findings are marked SUPERSEDED, never deleted, so the history stays
 * auditable. Evidence holds only numeric/enum components, never text from another incident or
 * change, which the eventual viewer may not be allowed to see.
 */
export async function replaceFindings(
  tx: Prisma.TransactionClient,
  input: {
    incidentId: string;
    kind: IntelligenceFindingKind;
    generation: number;
    policyVersion: number | null;
    policyHash?: string;
    sourceUpdatedAt?: Date;
    fingerprintUpdatedAt?: Date;
    rows: FindingRow[];
  }
): Promise<'written' | 'stale'> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-finding:${input.kind}:${input.incidentId}`}, 0))`;

  const newest = await tx.intelligenceFinding.aggregate({
    where: { incidentId: input.incidentId, kind: input.kind },
    _max: { generation: true },
  });
  const snapshot = await tx.intelligenceAnalysisSnapshot.findUnique({
    where: { incidentId_kind: { incidentId: input.incidentId, kind: input.kind } },
    select: { generation: true },
  });
  if (Math.max(newest._max.generation ?? 0, snapshot?.generation ?? 0) > input.generation)
    return 'stale';

  await tx.intelligenceFinding.updateMany({
    where: { incidentId: input.incidentId, kind: input.kind, status: 'ACTIVE' },
    data: { status: 'SUPERSEDED', supersededAt: new Date() },
  });
  if (input.rows.length > 0) {
    await tx.intelligenceFinding.createMany({
      data: input.rows.map((row, index) => ({
        incidentId: input.incidentId,
        kind: input.kind,
        rank: index + 1,
        confidence: row.confidence,
        subjectRef: row.subjectRef,
        evidence: row.evidence,
        generation: input.generation,
        engineVersion: INTELLIGENCE_ENGINE_VERSION,
        policyVersion: input.policyVersion,
      })),
    });
  }
  const success = {
    generation: input.generation,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    fingerprintUpdatedAt: input.fingerprintUpdatedAt ?? null,
    completedAt: new Date(),
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    rowCount: input.rows.length,
  };
  await tx.intelligenceAnalysisSnapshot.upsert({
    where: { incidentId_kind: { incidentId: input.incidentId, kind: input.kind } },
    create: { incidentId: input.incidentId, kind: input.kind, ...success },
    update: success,
  });
  return 'written';
}

/** Similar-incident findings. The score is a ranking signal, not a calibrated probability. */
export async function replaceSimilarFindings(
  tx: Prisma.TransactionClient,
  input: {
    incidentId: string;
    generation: number;
    policyVersion: number | null;
    policyHash?: string;
    sourceUpdatedAt?: Date;
    fingerprintUpdatedAt?: Date;
    tier: SimilarityTier;
    results: SimilarIncident[];
  }
): Promise<'written' | 'stale'> {
  return replaceFindings(tx, {
    incidentId: input.incidentId,
    kind: 'SIMILAR_INCIDENT',
    generation: input.generation,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    sourceUpdatedAt: input.sourceUpdatedAt,
    fingerprintUpdatedAt: input.fingerprintUpdatedAt,
    rows: input.results.map(result => ({
      confidence: result.score,
      subjectRef: result.incidentId,
      evidence: {
        type: 'similarity',
        calibrated: false,
        tier: input.tier,
        components: { ...result.components },
        matchedTokenCount: result.matchedTokenCount,
      },
    })),
  });
}
